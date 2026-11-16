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
