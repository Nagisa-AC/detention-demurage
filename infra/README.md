# Apply

You apply this. CI plans it and does not apply it.

The account SCP denies `iam:*Provider*` on the free and paid plans of the new sign-up experience, so this configuration does not create an OIDC provider. The web app uses one IAM user, `dd-web`. Revisit Vercel OIDC at M4, when the account moves to advanced features.

`dd-web` has no console login. Its only policy allows `s3:PutObject` on `incoming/*` and `documents/*`, and `s3:GetObject` on `incoming/*`. Terraform does not create the access key, so the secret stays out of state.

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

If an older `terraform.tfvars` still has `aws_account_id`, `vercel_team_slug`, `vercel_project_name`, or `vercel_oidc_thumbprint`, delete those lines. They are no longer variables.
