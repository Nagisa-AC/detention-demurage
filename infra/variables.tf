variable "aws_account_id" {
  type        = string
  description = "AWS account id. Used so the OIDC trust policy is known at plan time."

  validation {
    condition     = can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "aws_account_id must be 12 digits."
  }
}

variable "vercel_team_slug" {
  type        = string
  description = "Vercel team slug. The OIDC issuer is https://oidc.vercel.com/<slug>."

  validation {
    condition     = can(regex("^[A-Za-z0-9-]+$", var.vercel_team_slug))
    error_message = "vercel_team_slug must be letters, numbers, and hyphens."
  }
}

variable "vercel_project_name" {
  type        = string
  description = "Vercel project slug. The web role trusts production only."

  validation {
    condition     = can(regex("^[A-Za-z0-9-]+$", var.vercel_project_name))
    error_message = "vercel_project_name must be letters, numbers, and hyphens."
  }
}

variable "vercel_oidc_thumbprint" {
  type        = string
  description = "SHA-1 thumbprint of the certificate for oidc.vercel.com. Supply it at apply."

  validation {
    condition     = can(regex("^[0-9a-fA-F]{40}$", var.vercel_oidc_thumbprint))
    error_message = "vercel_oidc_thumbprint must be 40 hex characters."
  }
}

variable "bucket_name" {
  type        = string
  description = "Private document bucket in us-east-2. The name is global."

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", var.bucket_name))
    error_message = "bucket_name must be a DNS-style S3 name."
  }
}

variable "vpc_id" {
  type        = string
  description = "VPC for the worker security group. Use the default VPC if you have no other."
}

variable "subnet_id" {
  type        = string
  description = "Public subnet for the worker. The instance is given a public IPv4 address."
}

variable "ami_id" {
  type        = string
  description = "Amazon Linux 2023 arm64 AMI in us-east-2. Look up the current id at apply; do not bake an image."
}
