output "ecr_backend_repository_url" {
  value = aws_ecr_repository.backend.repository_url
}

output "ecr_web_repository_url" {
  value = aws_ecr_repository.web.repository_url
}

output "github_actions_role_arn" {
  description = "Paste this into the GitHub repo as the AWS_ROLE_ARN Actions secret/variable."
  value       = aws_iam_role.github_actions_ecr_push.arn
}

output "aws_account_id" {
  value = data.aws_caller_identity.current.account_id
}

output "aws_region" {
  value = var.aws_region
}

# --- Section 25 ---

output "ec2_instance_id" {
  description = "Connect with: aws ssm start-session --target <this> --region ap-south-1. Also the GitHub Actions variable EC2_INSTANCE_ID (enables the deploy job)."
  value       = aws_instance.app.id
}

output "elastic_ip" {
  value = aws_eip.app.public_ip
}

output "web_url" {
  description = "sslip.io placeholder -- see README 'Migrating off sslip.io'."
  value       = "https://${local.web_host}"
}

output "api_base_url" {
  description = "Goes into the GitHub Actions variable API_BASE_URL (baked into the web image at build time) and apps/mobile/app.json extra.apiBaseUrl."
  value       = "https://${local.api_host}"
}

output "whatsapp_webhook_url" {
  description = "Register this with the WhatsApp BSP/Meta. Note the /api/v1 prefix -- routes are mounted under it."
  value       = "https://${local.api_host}/api/v1/webhooks/whatsapp"
}

output "rds_endpoint" {
  value = aws_db_instance.main.address
}

output "proofs_bucket" {
  value = aws_s3_bucket.proofs.bucket
}

output "photos_bucket" {
  value = aws_s3_bucket.photos.bucket
}

output "cloudfront_domain" {
  value = aws_cloudfront_distribution.photos.domain_name
}

output "kms_key_arn" {
  value = aws_kms_key.proofs.arn
}
