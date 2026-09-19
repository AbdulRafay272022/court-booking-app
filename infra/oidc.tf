# The GitHub Actions OIDC provider for this AWS account already exists
# (shared across whatever else runs in this account) -- reference it
# rather than creating a second one, which AWS rejects (one provider per
# unique URL per account). This project only needs its own IAM role,
# trust-scoped to this specific repo.
data "aws_iam_openid_connect_provider" "github_actions" {
  url = "https://token.actions.githubusercontent.com"
}

data "aws_caller_identity" "current" {}

resource "aws_iam_role" "github_actions_ecr_push" {
  name = "${var.project_name}-github-actions-ecr-push"

  # Scoped to this exact repo, by name AND immutable numeric IDs (see the
  # github_owner_id/github_repo_id variables for why the IDs are required).
  # Any branch/PR/tag under it -- no other
  # repo's Actions run, in this account or anywhere else, can assume this
  # role. Long-lived AWS access keys are deliberately avoided: OIDC means
  # nothing but a short-lived, per-run token ever exists, and there's
  # nothing to leak or rotate.
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Federated = data.aws_iam_openid_connect_provider.github_actions.arn
        }
        Action = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          }
          StringLike = {
            "token.actions.githubusercontent.com:sub" = "repo:${var.github_owner}@${var.github_owner_id}/${var.github_repo}@${var.github_repo_id}:*"
          }
        }
      }
    ]
  })
}

# Just enough to build+push+pull these two repos' images -- not blanket
# ECR access, and nothing outside ECR at all.
resource "aws_iam_role_policy" "ecr_push" {
  name = "ecr-push"
  role = aws_iam_role.github_actions_ecr_push.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "EcrAuth"
        Effect   = "Allow"
        Action   = "ecr:GetAuthorizationToken"
        Resource = "*"
      },
      {
        Sid    = "EcrPushPull"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:PutImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
        ]
        Resource = [
          aws_ecr_repository.backend.arn,
          aws_ecr_repository.web.arn,
        ]
      }
    ]
  })
}

# Deploy = `aws ssm send-command` against this one instance (there is no SSH
# path into it at all -- see network.tf). Scoped to that instance and the
# stock AWS-RunShellScript document, nothing broader.
resource "aws_iam_role_policy" "ssm_deploy" {
  name = "ssm-deploy"
  role = aws_iam_role.github_actions_ecr_push.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SendCommandToAppInstance"
        Effect = "Allow"
        Action = "ssm:SendCommand"
        Resource = [
          aws_instance.app.arn,
          "arn:aws:ssm:${var.aws_region}::document/AWS-RunShellScript",
        ]
      },
      {
        Sid      = "ReadCommandResult"
        Effect   = "Allow"
        Action   = ["ssm:GetCommandInvocation", "ssm:ListCommandInvocations"]
        Resource = "*"
      }
    ]
  })
}
