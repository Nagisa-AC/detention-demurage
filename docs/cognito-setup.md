# Cognito setup

Two accounts, created by hand. The app has no sign-up page and no MFA enrollment screen. A hand-created user who has not enrolled an authenticator gets an `MFA_SETUP` challenge on first sign-in, and the app rejects that challenge. Enroll each authenticator here before anyone uses the sign-in page.

The pool is in `us-east-1`. MFA is required. The only factor is an authenticator-app TOTP. SMS is off. Self-service sign-up is off.

Set these where the app runs. Do not commit them.

```
COGNITO_REGION=us-east-1
COGNITO_USER_POOL_ID=
COGNITO_CLIENT_ID=
DD_SESSION_SECRET=
```

`DD_SESSION_SECRET` is a long random string. Leave `COGNITO_CLIENT_SECRET` unset. This runbook creates an app client without a secret.

## Pool

```bash
aws cognito-idp create-user-pool \
  --region us-east-1 \
  --pool-name dd-recovery \
  --admin-create-user-config AllowAdminCreateUserOnly=true \
  --username-attributes email \
  --auto-verified-attributes email \
  --mfa-configuration OFF
```

Copy the pool id (`us-east-1_...`) into `COGNITO_USER_POOL_ID`. Then turn MFA on. Only the software token is enabled. The pool has no SMS configuration, so text-message MFA stays off.

```bash
aws cognito-idp set-user-pool-mfa-config \
  --region us-east-1 \
  --user-pool-id "$COGNITO_USER_POOL_ID" \
  --mfa-configuration ON \
  --software-token-mfa-configuration Enabled=true
```

## App client

`USER_PASSWORD_AUTH` has to be enabled. The app uses that flow.

```bash
aws cognito-idp create-user-pool-client \
  --region us-east-1 \
  --user-pool-id "$COGNITO_USER_POOL_ID" \
  --client-name dd-web \
  --explicit-auth-flows ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH \
  --prevent-user-existence-errors ENABLED \
  --no-generate-secret
```

Copy `ClientId` into `COGNITO_CLIENT_ID`.

## Users

Do this once per person. `EMAIL` is the sign-in name. `DISPLAY_NAME` is what the header shows (Ibrahim for the screenshot account). Cognito does not email a temporary password.

```bash
aws cognito-idp admin-create-user \
  --region us-east-1 \
  --user-pool-id "$COGNITO_USER_POOL_ID" \
  --username "$EMAIL" \
  --message-action SUPPRESS \
  --user-attributes \
    Name=email,Value="$EMAIL" \
    Name=email_verified,Value=true \
    Name=name,Value="$DISPLAY_NAME"

aws cognito-idp admin-set-user-password \
  --region us-east-1 \
  --user-pool-id "$COGNITO_USER_POOL_ID" \
  --username "$EMAIL" \
  --password "$PASSWORD" \
  --permanent
```

The password is permanent so the first sign-in is `MFA_SETUP`, not a forced password change.

## Authenticator

Sign in once from the CLI. The response is a challenge named `MFA_SETUP` and a `Session` value.

```bash
aws cognito-idp initiate-auth \
  --region us-east-1 \
  --client-id "$COGNITO_CLIENT_ID" \
  --auth-flow USER_PASSWORD_AUTH \
  --auth-parameters USERNAME="$EMAIL",PASSWORD="$PASSWORD"
```

Start enrollment with that session. The response has a new `Session` and a `SecretCode`.

```bash
aws cognito-idp associate-software-token \
  --region us-east-1 \
  --session "$SESSION"
```

Type `SecretCode` into the authenticator app (or scan a QR code you build from it). The app must generate HMAC-SHA1 codes. Read the 6-digit code it shows, then verify. Use the session from `associate-software-token`, not the one from `initiate-auth`.

```bash
aws cognito-idp verify-software-token \
  --region us-east-1 \
  --session "$ASSOCIATE_SESSION" \
  --user-code "$CODE"
```

`Status` has to be `SUCCESS`. Finish the challenge with the session from `verify-software-token`:

```bash
aws cognito-idp respond-to-auth-challenge \
  --region us-east-1 \
  --client-id "$COGNITO_CLIENT_ID" \
  --challenge-name MFA_SETUP \
  --session "$VERIFY_SESSION" \
  --challenge-responses USERNAME="$EMAIL"
```

Repeat for the second account. After this, the sign-in page's authenticator code is a `SOFTWARE_TOKEN_MFA` challenge, which the app accepts.

## amr, after the pool exists

AWS documents the `amr` claim as rolling out gradually. A new pool may omit it. Sign in once through the app and confirm the ID token's `amr` contains `mfa`. If it does not, the fallback is to accept only an ID token that came back from the `SOFTWARE_TOKEN_MFA` challenge. The MFA check stays. That fallback is not in the app yet.
