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
