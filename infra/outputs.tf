output "bucket_name" {
  value = aws_s3_bucket.documents.bucket
}

output "web_user_name" {
  description = "IAM user for the web app. Create its access key with the CLI in README.md. Terraform does not create the key."
  value       = aws_iam_user.dd_web.name
}

output "worker_instance_id" {
  value = aws_instance.worker.id
}

output "database_url_parameter" {
  value = local.database_url_parameter
}

output "anthropic_key_parameter" {
  value = local.anthropic_key_parameter
}
