locals {
  database_url_parameter  = "/dd/worker/database-url"
  anthropic_key_parameter = "/dd/worker/anthropic-api-key"
  vercel_issuer           = "oidc.vercel.com/${var.vercel_team_slug}"
  vercel_audience         = "https://vercel.com/${var.vercel_team_slug}"
  vercel_production_sub   = "owner:${var.vercel_team_slug}:project:${var.vercel_project_name}:environment:production"
  bucket_arn              = "arn:aws:s3:::${var.bucket_name}"
  oidc_provider_arn       = "arn:aws:iam::${var.aws_account_id}:oidc-provider/${local.vercel_issuer}"
}

resource "aws_iam_openid_connect_provider" "vercel" {
  url             = "https://${local.vercel_issuer}"
  client_id_list  = [local.vercel_audience]
  thumbprint_list = [lower(var.vercel_oidc_thumbprint)]
}

data "aws_iam_policy_document" "web_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.vercel_issuer}:aud"
      values   = [local.vercel_audience]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.vercel_issuer}:sub"
      values   = [local.vercel_production_sub]
    }
  }
}

resource "aws_iam_role" "web" {
  name               = "dd-web"
  assume_role_policy = data.aws_iam_policy_document.web_trust.json
  depends_on         = [aws_iam_openid_connect_provider.vercel]
}

# Presign PutObject, HeadObject the incoming copy source, and CopyObject onto documents/.
# No s3:DeleteObject. A rejected upload expires by lifecycle.
data "aws_iam_policy_document" "web" {
  statement {
    sid     = "PutIncomingAndDocuments"
    effect  = "Allow"
    actions = ["s3:PutObject"]

    resources = [
      "${local.bucket_arn}/incoming/*",
      "${local.bucket_arn}/documents/*",
    ]
  }

  statement {
    sid       = "ReadIncomingForCopy"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${local.bucket_arn}/incoming/*"]
  }
}

resource "aws_iam_role_policy" "web" {
  name   = "dd-web-documents"
  role   = aws_iam_role.web.id
  policy = data.aws_iam_policy_document.web.json
}

data "aws_iam_policy_document" "worker_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "worker" {
  name               = "dd-worker"
  assume_role_policy = data.aws_iam_policy_document.worker_trust.json
}

data "aws_iam_policy_document" "worker" {
  statement {
    sid       = "ReadStoredDocuments"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${local.bucket_arn}/documents/*"]
  }

  statement {
    sid    = "ReadWorkerParameters"
    effect = "Allow"
    actions = ["ssm:GetParameter"]

    resources = [
      "arn:aws:ssm:us-east-2:*:parameter${local.database_url_parameter}",
      "arn:aws:ssm:us-east-2:*:parameter${local.anthropic_key_parameter}",
    ]
  }

  statement {
    sid       = "DecryptParameters"
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["ssm.us-east-2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "worker" {
  name   = "dd-worker-documents"
  role   = aws_iam_role.worker.id
  policy = data.aws_iam_policy_document.worker.json
}

resource "aws_iam_role_policy_attachment" "worker_ssm" {
  role       = aws_iam_role.worker.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "worker" {
  name = "dd-worker"
  role = aws_iam_role.worker.name
}
