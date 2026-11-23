import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const infra = path.join(repoRoot, "infra");
const planFile = path.join(os.tmpdir(), `dd-tf-${process.pid}.tfplan`);

type Change = {
  type: string;
  name: string;
  change: { after: Record<string, unknown> | null; after_unknown?: unknown };
};

let plan: { resource_changes?: Change[] };

beforeAll(() => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AWS_ACCESS_KEY_ID: "testing",
    AWS_SECRET_ACCESS_KEY: "testing",
    AWS_REGION: "us-east-2",
    AWS_DEFAULT_REGION: "us-east-2",
    AWS_EC2_METADATA_DISABLED: "true",
    TF_IN_AUTOMATION: "1",
  };
  delete env.AWS_SESSION_TOKEN;
  delete env.AWS_PROFILE;
  execFileSync("terraform", ["init", "-backend=false", "-input=false", "-no-color"], {
    cwd: infra,
    env,
    stdio: "pipe",
  });
  execFileSync(
    "terraform",
    [
      "plan",
      "-refresh=false",
      "-input=false",
      "-no-color",
      `-out=${planFile}`,
      "-var=bucket_name=dd-recovery-plan-test",
      "-var=upload_origin=https://detention-demurage.vercel.app",
      "-var=vpc_id=vpc-0123456789abcdef0",
      "-var=subnet_id=subnet-0123456789abcdef0",
      "-var=ami_id=ami-0123456789abcdef0",
      "-var=portal_host=portal.example.com",
      "-var=portal_email_from=codes@example.com",
    ],
    { cwd: infra, env, stdio: "pipe" },
  );
  const shown = execFileSync("terraform", ["show", "-json", planFile], { cwd: infra, env, encoding: "utf8" });
  plan = JSON.parse(shown) as { resource_changes?: Change[] };
}, 180_000);

describe("terraform plan", () => {
  it("expires incoming objects, their noncurrent versions, and incomplete multipart uploads", () => {
    const lifecycle = resource("aws_s3_bucket_lifecycle_configuration", "documents");
    const rule = first(lifecycle.rule);
    expect(rule.id).toBe("incoming-expire");
    expect(rule.status).toBe("Enabled");
    expect(block(rule, "filter").prefix).toBe("incoming/");
    expect(block(rule, "expiration").days).toBe(1);
    expect(block(rule, "noncurrent_version_expiration").noncurrent_days).toBe(1);
    expect(block(rule, "abort_incomplete_multipart_upload").days_after_initiation).toBe(1);
  });

  it("allows one exact origin to PUT with the signed headers", () => {
    const cors = resource("aws_s3_bucket_cors_configuration", "documents");
    const rule = first(cors.cors_rule);
    expect(rule.allowed_origins).toEqual(["https://detention-demurage.vercel.app"]);
    expect(rule.allowed_methods).toEqual(["PUT"]);
    expect(rule.allowed_headers).toEqual(["content-length", "content-type", "x-amz-checksum-sha256"]);
    expect(rule.max_age_seconds).toBe(3000);
    expect(rule.expose_headers ?? []).toEqual([]);
    const text = JSON.stringify(rule);
    expect(text).not.toContain("*");
    expect(text).not.toContain("GET");
    expect(text).not.toContain("POST");
    expect(text).not.toContain("DELETE");
  });

  it("keeps the bucket private, encrypted, versioned, and TLS-only", () => {
    const access = resource("aws_s3_bucket_public_access_block", "documents");
    expect(access.block_public_acls).toBe(true);
    expect(access.block_public_policy).toBe(true);
    expect(access.ignore_public_acls).toBe(true);
    expect(access.restrict_public_buckets).toBe(true);
    const versioning = resource("aws_s3_bucket_versioning", "documents");
    expect(block(versioning, "versioning_configuration").status).toBe("Enabled");
    const encryption = JSON.stringify(resource("aws_s3_bucket_server_side_encryption_configuration", "documents"));
    expect(encryption).toContain("AES256");
    const policy = String(resource("aws_s3_bucket_policy", "documents").policy);
    expect(policy).toContain("aws:SecureTransport");
  });

  it("matches the copy flow and does not grant delete", () => {
    const types = (plan.resource_changes ?? []).map((change) => change.type);
    expect(types).not.toContain("aws_ssm_parameter");
    const worker = statements(String(resource("aws_iam_role_policy", "worker").policy));
    expect(actions(worker, "s3:GetObject").sort()).toEqual([
      "arn:aws:s3:::dd-recovery-plan-test/deploy/*",
      "arn:aws:s3:::dd-recovery-plan-test/documents/*",
      "arn:aws:s3:::dd-recovery-plan-test/reports/*",
    ]);
    expect(actions(worker, "s3:PutObject")).toEqual(["arn:aws:s3:::dd-recovery-plan-test/reports/*"]);
    expect(actions(worker, "ssm:GetParameter").some((arn) => arn.endsWith("parameter/dd/worker/database-url"))).toBe(true);
    expect(actions(worker, "ssm:GetParameter").some((arn) => arn.endsWith("parameter/dd/worker/anthropic-api-key"))).toBe(true);
    const all = JSON.stringify(plan);
    expect(all).not.toContain("s3:DeleteObject");
    expect(all).not.toContain("oidc.vercel.com");
    expect(all).not.toContain("AssumeRoleWithWebIdentity");
    expect((plan.resource_changes ?? []).some((change) => change.type === "aws_iam_role" && change.name === "web")).toBe(false);
  });

  it("gives dd-web the copy actions and a read of stored documents, with no other policy and no login", () => {
    const types = (plan.resource_changes ?? []).map((change) => change.type);
    expect(types).not.toContain("aws_iam_access_key");
    expect(types).not.toContain("aws_iam_user_login_profile");
    expect(types).not.toContain("aws_iam_user_policy_attachment");
    expect(types).not.toContain("aws_iam_user_group_membership");
    expect(types).not.toContain("aws_iam_openid_connect_provider");
    expect(types.filter((type) => type === "aws_iam_user")).toEqual(["aws_iam_user"]);
    expect(types.filter((type) => type === "aws_iam_user_policy")).toEqual(["aws_iam_user_policy"]);

    const user = resource("aws_iam_user", "dd_web");
    expect(user.name).toBe("dd-web");
    expect(user.permissions_boundary ?? null).toBeNull();
    const policyResource = resource("aws_iam_user_policy", "dd_web");
    expect(policyResource.user).toBe("dd-web");
    expect(policyResource.name).toBe("dd-web-documents");
    const web = statements(String(policyResource.policy));
    expect(web.flatMap((statement) => statement.actions).sort()).toEqual([
      "s3:GetObject",
      "s3:GetObject",
      "s3:GetObject",
      "s3:PutObject",
    ]);
    expect(actions(web, "s3:GetObject").sort()).toEqual([
      "arn:aws:s3:::dd-recovery-plan-test/documents/*",
      "arn:aws:s3:::dd-recovery-plan-test/incoming/*",
      "arn:aws:s3:::dd-recovery-plan-test/reports/*",
    ]);
    expect(actions(web, "s3:PutObject").sort()).toEqual([
      "arn:aws:s3:::dd-recovery-plan-test/documents/*",
      "arn:aws:s3:::dd-recovery-plan-test/incoming/*",
    ]);
  });

  it("gives the worker a public address, no inbound rule, and no secret in user data", () => {
    const instance = resource("aws_instance", "worker");
    expect(instance.instance_type).toBe("t4g.micro");
    expect(instance.associate_public_ip_address).toBe(true);
    expect(instance.key_name ?? null).toBeNull();
    const group = resource("aws_security_group", "worker");
    expect(group.ingress ?? []).toEqual([]);
    expect(egressRules(group.egress).some((rule) => rule.from_port === 22 || rule.to_port === 22)).toBe(false);
    expect(typeof instance.user_data).toBe("string");
    expect(String(instance.user_data).length).toBeGreaterThan(0);
    const script = fs.readFileSync(path.join(infra, "worker-user-data.sh"), "utf8");
    const rendered = script.replaceAll("${bucket}", "dd-recovery-plan-test");
    expect(rendered).toContain("DD_BUCKET=dd-recovery-plan-test");
    expect(rendered).toContain("dnf install -y nodejs24");
    expect(rendered).toContain("ExecStart=/usr/bin/node-24 /opt/dd-worker/main.mjs");
    expect(rendered).toContain("MemoryMax=768M");
    expect(rendered).toContain("sleep 10");
    expect(rendered).not.toContain("command -v node");
    const unitAt = rendered.indexOf("cat > /etc/systemd/system/dd-worker.service");
    const reloadAt = rendered.indexOf("systemctl daemon-reload");
    const installAt = rendered.indexOf("dnf install -y nodejs24");
    expect(unitAt).toBeGreaterThan(-1);
    expect(unitAt).toBeLessThan(reloadAt);
    expect(reloadAt).toBeLessThan(installAt);
    for (const forbidden of ["postgres://", "sk-ant", "AKIA", "BEGIN OPENSSH", "BEGIN RSA", "password="]) {
      expect(rendered, forbidden).not.toContain(forbidden);
    }
    for (const line of [
      "DynamicUser=yes",
      "NoNewPrivileges=yes",
      "ProtectSystem=strict",
      "ProtectHome=yes",
      "PrivateTmp=yes",
      "ReadOnlyPaths=/opt/dd-worker",
      "install -d -o root -g root -m 0755 /opt/dd-worker",
    ]) {
      expect(rendered, line).toContain(line);
    }
    expect(rendered).not.toContain("User=root");
    expect(String(instance.user_data)).toBe(createHash("sha1").update(rendered).digest("hex"));
  });

  it("keeps the customer pool separate, admin-only, and without a client secret", () => {
    const pool = resource("aws_cognito_user_pool", "portal");
    expect(pool.name).toBe("dd-portal");
    expect(fs.readFileSync(path.join(infra, "versions.tf"), "utf8")).toContain('region                      = "us-east-2"');
    expect(pool.user_pool_tier).toBe("ESSENTIALS");
    expect(block(pool, "admin_create_user_config").allow_admin_create_user_only).toBe(true);
    expect(pool.username_attributes).toEqual(["email"]);
    const factors = block(pool, "sign_in_policy").allowed_first_auth_factors;
    expect(Array.isArray(factors) ? [...factors].map(String).sort() : []).toEqual(["EMAIL_OTP", "WEB_AUTHN"]);
    const passkey = block(pool, "web_authn_configuration");
    expect(passkey.relying_party_id).toBe("portal.example.com");
    expect(passkey.user_verification).toBe("required");
    const email = block(pool, "email_configuration");
    expect(email.email_sending_account).toBe("DEVELOPER");
    expect(email.from_email_address).toBe("codes@example.com");
    const emailUnknown = block(unknown("aws_cognito_user_pool", "portal"), "email_configuration");
    expect(emailUnknown.source_arn).toBe(true);
    expect(fs.readFileSync(path.join(infra, "portal-cognito.tf"), "utf8")).toContain(
      "source_arn            = aws_ses_email_identity.portal.arn",
    );
    expect(resource("aws_ses_email_identity", "portal").email).toBe("codes@example.com");
    const sesPolicy = resource("aws_ses_identity_policy", "portal_cognito");
    expect(sesPolicy.name).toBe("dd-portal-cognito-send");
    expect(sesPolicy.identity).toBe("codes@example.com");
    expect(unknown("aws_ses_identity_policy", "portal_cognito").policy).toBe(true);
    const ses = fs.readFileSync(path.join(infra, "portal-cognito.tf"), "utf8");
    expect(ses).toContain("ses:SendEmail");
    expect(ses).toContain("ses:SendRawEmail");
    expect(ses).toContain("email.cognito-idp.amazonaws.com");
    expect(ses).toContain("aws:SourceArn");
    const readme = fs.readFileSync(path.join(infra, "README.md"), "utf8");
    expect(readme).toContain("sandbox");
    expect(readme).toContain("production access");
    const client = resource("aws_cognito_user_pool_client", "portal");
    expect(client.name).toBe("dd-portal");
    expect(client.generate_secret).toBe(false);
    expect([...(Array.isArray(client.explicit_auth_flows) ? client.explicit_auth_flows : [])].map(String).sort()).toEqual([
      "ALLOW_REFRESH_TOKEN_AUTH",
      "ALLOW_USER_AUTH",
    ]);
    const outputs = fs.readFileSync(path.join(infra, "outputs.tf"), "utf8");
    expect(outputs).toContain("portal_user_pool_id");
    expect(outputs).toContain("portal_client_id");
    const ci = fs.readFileSync(path.join(repoRoot, ".github/workflows/ci.yml"), "utf8");
    expect(ci).not.toContain("terraform apply");
  });

  it("opens worker egress on 5432 for Neon", () => {
    const rules = egressRules(resource("aws_security_group", "worker").egress);
    expect(rules.map((rule) => rule.from_port).sort((a, b) => a - b)).toEqual([443, 5432]);
    const postgres = rules.find((rule) => rule.from_port === 5432);
    expect(postgres).toMatchObject({ to_port: 5432, protocol: "tcp", cidr_blocks: ["0.0.0.0/0"] });
  });
});

function resource(type: string, name: string): Record<string, unknown> {
  const found = (plan.resource_changes ?? []).find((change) => change.type === type && change.name === name);
  if (found?.change.after == null) throw new Error(`missing ${type}.${name}`);
  return found.change.after;
}

function unknown(type: string, name: string): Record<string, unknown> {
  const found = (plan.resource_changes ?? []).find((change) => change.type === type && change.name === name);
  const value = found?.change.after_unknown;
  if (value === null || typeof value !== "object") throw new Error(`missing unknown ${type}.${name}`);
  return value as Record<string, unknown>;
}

function first(value: unknown): Record<string, unknown> {
  const item = Array.isArray(value) ? value[0] : value;
  if (item === null || typeof item !== "object") throw new Error("missing block");
  return item as Record<string, unknown>;
}

function block(value: Record<string, unknown>, key: string): Record<string, unknown> {
  return first(value[key]);
}

function statements(policy: string): { actions: string[]; resources: string[] }[] {
  const parsed = JSON.parse(policy) as {
    Statement?: { Action?: string | string[]; Resource?: string | string[] }[];
  };
  return (parsed.Statement ?? []).map((statement) => ({
    actions: statement.Action === undefined ? [] : [statement.Action].flat(),
    resources: statement.Resource === undefined ? [] : [statement.Resource].flat(),
  }));
}

function actions(items: { actions: string[]; resources: string[] }[], action: string): string[] {
  return items.filter((item) => item.actions.includes(action)).flatMap((item) => item.resources);
}

function egressRules(value: unknown): { from_port: number; to_port: number; protocol: string; cidr_blocks: string[] }[] {
  const items = Array.isArray(value) ? value : [value];
  return items.filter((item) => item !== null && typeof item === "object").map((item) => {
    const rule = item as Record<string, unknown>;
    return {
      from_port: Number(rule.from_port),
      to_port: Number(rule.to_port),
      protocol: String(rule.protocol),
      cidr_blocks: Array.isArray(rule.cidr_blocks) ? rule.cidr_blocks.map(String) : [],
    };
  });
}
