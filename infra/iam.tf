locals {
  database_url_parameter  = "/dd/worker/database-url"
  anthropic_key_parameter = "/dd/worker/anthropic-api-key"
  bucket_arn              = "arn:aws:s3:::${var.bucket_name}"
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

# No login profile, so this user cannot open the console.
# No access key here: create it with the CLI in README.md so the secret stays out of state.
resource "aws_iam_user" "dd_web" {
  name = "dd-web"
}

resource "aws_iam_user_policy" "dd_web" {
  name   = "dd-web-documents"
  user   = aws_iam_user.dd_web.name
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
    sid       = "ReadDeployArtifacts"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = ["${local.bucket_arn}/deploy/*"]
  }

  statement {
    sid     = "ReadWorkerParameters"
    effect  = "Allow"
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
