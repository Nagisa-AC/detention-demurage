#!/bin/bash
# Shared by the Mac-side worker scripts. Source this file; do not run it.

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  echo "Source this file from deploy-worker.sh, worker-logs.sh, rollback-worker.sh, or requeue-run.sh." >&2
  exit 1
fi

WORKER_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
WORKER_REGION=us-east-2

require_aws() {
  if ! aws sts get-caller-identity --output text >/dev/null 2>&1; then
    echo "AWS credentials are required." >&2
    exit 1
  fi
}

read_worker_target() {
  local bucket instance
  bucket=$(terraform -chdir="$WORKER_ROOT/infra" output -raw bucket_name) || exit 1
  instance=$(terraform -chdir="$WORKER_ROOT/infra" output -raw worker_instance_id) || exit 1
  if [[ ! "$bucket" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]]; then
    echo "terraform output bucket_name is not a bucket name." >&2
    exit 1
  fi
  if [[ ! "$instance" =~ ^i-[0-9a-f]+$ ]]; then
    echo "terraform output worker_instance_id is not an instance id." >&2
    exit 1
  fi
  WORKER_BUCKET=$bucket
  WORKER_INSTANCE=$instance
  export WORKER_BUCKET WORKER_INSTANCE
}

run_on_worker() {
  local script=$1
  local comment=$2
  shift 2
  if [[ ! -f "$script" ]]; then
    echo "Missing remote script." >&2
    exit 1
  fi
  if [[ $(($# % 2)) -ne 0 ]]; then
    echo "Refusing an incomplete environment assignment." >&2
    exit 1
  fi
  local prelude="AWS_REGION=${WORKER_REGION}"
  local key value
  while [[ $# -gt 0 ]]; do
    key=$1
    value=$2
    if [[ ! "$key" =~ ^[A-Z][A-Z0-9_]*$ ]]; then
      echo "Refusing an environment name." >&2
      exit 1
    fi
    if [[ ! "$value" =~ ^[A-Za-z0-9._/-]+$ ]]; then
      echo "Refusing an unsafe value." >&2
      exit 1
    fi
    prelude="${prelude}
${key}=${value}"
    shift 2
  done
  local params cmd waited invocation printed
  params=$(mktemp) || exit 1
  set +e
  node --input-type=module - "$script" "$params" "$WORKER_INSTANCE" "$comment" "$prelude" <<'JS'
import { readFileSync, writeFileSync } from "node:fs";

const scriptPath = process.argv[2];
const outPath = process.argv[3];
const instance = process.argv[4];
const comment = process.argv[5];
const prelude = process.argv[6];
if (scriptPath === undefined || outPath === undefined || instance === undefined || comment === undefined || prelude === undefined) {
  console.error("The SSM request is incomplete.");
  process.exit(1);
}
const body = readFileSync(scriptPath, "utf8");
writeFileSync(
  outPath,
  JSON.stringify({
    InstanceIds: [instance],
    DocumentName: "AWS-RunShellScript",
    Comment: comment,
    Parameters: { commands: [prelude, body] },
  }),
);
JS
  printed=$?
  set -e
  if [[ "$printed" -ne 0 ]]; then
    rm -f "$params"
    exit 1
  fi
  cmd=$(aws ssm send-command --region "$WORKER_REGION" --cli-input-json "file://${params}" --query Command.CommandId --output text) || {
    rm -f "$params"
    exit 1
  }
  rm -f "$params"
  set +e
  aws ssm wait command-executed --region "$WORKER_REGION" --command-id "$cmd" --instance-id "$WORKER_INSTANCE"
  waited=$?
  set -e
  invocation=$(mktemp) || exit 1
  aws ssm get-command-invocation \
    --region "$WORKER_REGION" \
    --command-id "$cmd" \
    --instance-id "$WORKER_INSTANCE" \
    --output json >"$invocation" || {
    rm -f "$invocation"
    exit 1
  }
  set +e
  node --input-type=module - "$invocation" <<'JS'
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (file === undefined) {
  console.error("The command result is missing.");
  process.exit(1);
}
const data = JSON.parse(readFileSync(file, "utf8"));
const stdout = typeof data.StandardOutputContent === "string" ? data.StandardOutputContent : "";
const stderr = typeof data.StandardErrorContent === "string" ? data.StandardErrorContent : "";
console.log(`Status: ${data.Status}`);
console.log("--- stdout ---");
process.stdout.write(stdout);
if (stdout !== "" && !stdout.endsWith("\n")) console.log();
console.log("--- stderr ---");
process.stdout.write(stderr);
if (stderr !== "" && !stderr.endsWith("\n")) console.log();
if (data.Status !== "Success") process.exit(1);
JS
  printed=$?
  set -e
  rm -f "$invocation"
  if [[ "$printed" -ne 0 || "$waited" -ne 0 ]]; then
    exit 1
  fi
}
