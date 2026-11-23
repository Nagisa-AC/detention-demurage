variable "upload_origin" {
  type        = string
  description = "The one browser origin allowed to PUT a PDF. No wildcard."
  default     = "https://detention-demurage.vercel.app"

  validation {
    condition     = can(regex("^https://[a-z0-9.-]+$", var.upload_origin)) && !strcontains(var.upload_origin, "*")
    error_message = "upload_origin must be one https origin and must not contain a wildcard."
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

variable "portal_host" {
  type        = string
  description = "Hostname of the future customer portal. Passkeys are bound to this host. No scheme, no path, no wildcard."

  validation {
    condition     = can(regex("^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$", var.portal_host))
    error_message = "portal_host must be a lowercase hostname, with no scheme and no wildcard."
  }
}
