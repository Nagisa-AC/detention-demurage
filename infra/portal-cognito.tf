# Customer login pool. Separate from the staff pool in docs/cognito-setup.md.
# The provider region is us-east-2. Admin-created users only.
# Passkey first, email one-time code as the other first factor.
# The provider expresses both. There is no client secret.

resource "aws_cognito_user_pool" "portal" {
  name           = "dd-portal"
  user_pool_tier = "ESSENTIALS"

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  # EMAIL_OTP requires SES. COGNITO_DEFAULT cannot send that code.
  email_configuration {
    email_sending_account = "DEVELOPER"
    from_email_address    = var.portal_email_from
    source_arn            = aws_ses_email_identity.portal.arn
  }

  sign_in_policy {
    allowed_first_auth_factors = ["WEB_AUTHN", "EMAIL_OTP"]
  }

  web_authn_configuration {
    relying_party_id  = var.portal_host
    user_verification = "required"
  }
}

resource "aws_ses_email_identity" "portal" {
  email = var.portal_email_from
}

# Cognito sends as this identity. The pool ARN keeps another caller from using it.
data "aws_iam_policy_document" "portal_ses" {
  statement {
    sid     = "CognitoSendPortalEmail"
    effect  = "Allow"
    actions = ["ses:SendEmail", "ses:SendRawEmail"]

    resources = [aws_ses_email_identity.portal.arn]

    principals {
      type        = "Service"
      identifiers = ["email.cognito-idp.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = [aws_cognito_user_pool.portal.arn]
    }
  }
}

resource "aws_ses_identity_policy" "portal_cognito" {
  name     = "dd-portal-cognito-send"
  identity = aws_ses_email_identity.portal.email
  policy   = data.aws_iam_policy_document.portal_ses.json
}

resource "aws_cognito_user_pool_client" "portal" {
  name         = "dd-portal"
  user_pool_id = aws_cognito_user_pool.portal.id

  generate_secret               = false
  prevent_user_existence_errors = "ENABLED"
  explicit_auth_flows           = ["ALLOW_REFRESH_TOKEN_AUTH", "ALLOW_USER_AUTH"]
  enable_token_revocation       = true
}
