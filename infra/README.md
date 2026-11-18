# Apply

You apply this. CI plans it and does not apply it.

The account SCP denies `iam:*Provider*` on the free and paid plans of the new sign-up experience, so this configuration does not create an OIDC provider. The web app uses one IAM user, `dd-web`. Revisit Vercel OIDC at M4, when the account moves to advanced features.

`dd-web` has no console login. Its only policy allows `s3:PutObject` on `incoming/*` and `documents/*`, and `s3:GetObject` on `incoming/*`, `documents/*`, and `reports/*`. Terraform does not create the access key, so the secret stays out of state.

The bucket allows a browser `PUT` from `upload_origin` only. That origin is `https://detention-demurage.vercel.app`. The allowed headers are `content-length`, `content-type`, and `x-amz-checksum-sha256`. There is no wildcard.

After `terraform apply`, create the key:

```sh
aws iam create-access-key --user-name dd-web
```

On the Vercel project, set these variables. Mark each one Sensitive and Production-only:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `DD_BUCKET` (the `bucket_name` output)
- `DATABASE_URL`

Rotate the key every 90 days. A user can hold two keys, so create the new one, swap it in Vercel, then delete the old one:

```sh
aws iam create-access-key --user-name dd-web
aws iam delete-access-key --user-name dd-web --access-key-id AKIA_OLD
```

The worker still reads `/dd/worker/database-url` and `/dd/worker/anthropic-api-key` from Parameter Store. Create those SecureStrings yourself. The database URL must set `sslmode=require`, `verify-ca`, or `verify-full`.

## Worker program

The worker is one `t4g.micro` (1 GB). The running total is about $32 a month. `pnpm worker:bundle` writes `dist/dd-worker.tar` and `dist/dd-worker.sha256`. The tarball is `main.mjs`, `pdf.worker.mjs`, and the report fonts. The unit runs `/usr/bin/node-24`, which is the `nodejs24` package, and `MemoryMax` is 768M. User data writes that unit and reloads systemd before it installs Node, and it retries the install three times. Applying a user-data change replaces the instance, because `user_data_replace_on_change` is set. After apply, the instance id is `terraform output -raw worker_instance_id`.

The worker role can `s3:GetObject` on `deploy/*`, `documents/*`, and `reports/*`, and `s3:PutObject` on `reports/*`. There is no `s3:DeleteObject`. Upload and install from a clean tree:

```sh
scripts/deploy-worker.sh
```

That reads the sha from `dist/`, uploads `deploy/<sha>.tar`, and sends `scripts/worker-install.sh` through SSM. An account admin can overwrite that object. The install checks the sha256 and leaves the running program in place when the bytes differ.

```sh
scripts/worker-logs.sh
scripts/worker-logs.sh 50
scripts/rollback-worker.sh
scripts/requeue-run.sh <run-id>
scripts/diagnose-run.sh <run-id>
```

Logs are `journalctl -u dd-worker`. Each line carries the processing-run id. A failure line is `run <id> failed <stage> <name> <code>`. The lines do not include a customer name, a config id, a storage key, page text, or an error message. Rollback restores `/opt/dd-worker-previous`. Requeue clears `finished_at`, `attempts`, the lease, and `page_records` for that one run. It connects as `dd_app` with the worker's database URL and does not print the URL. Diagnose processes that one document once, in a transient unit with the same sandbox and memory cap as `dd-worker`, and prints the error to the command output. It refuses a hash that is not one of the eight synthetic documents. These scripts read the bucket and the instance id from terraform outputs and stop when AWS credentials are missing.

If an older `terraform.tfvars` still has `aws_account_id`, `vercel_team_slug`, `vercel_project_name`, or `vercel_oidc_thumbprint`, delete those lines. They are no longer variables.
