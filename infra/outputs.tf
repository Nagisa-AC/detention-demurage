output "bucket_name" {
  value = aws_s3_bucket.documents.bucket
}

output "web_role_arn" {
  description = "Set this as AWS_ROLE_ARN on the Vercel project. It is not an access key."
  value       = aws_iam_role.web.arn
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
