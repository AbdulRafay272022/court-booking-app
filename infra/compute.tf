# Section 25, Part 2 (+ Part 6 hostnames) -- the single EC2 instance.
#
# Access: SSM Session Manager only. No SSH key pair, no port 22 (see
# network.tf). `aws ssm start-session --target <instance-id>`.
#
# The instance runs host-level nginx + certbot (apt) and the two app
# containers pulled from ECR via docker-compose.prod.yml (it never builds
# images -- 1GB RAM can't reliably build Next.js/Python deps; see
# .github/workflows/deploy.yml). Background jobs run from cron on this same
# host (infra/scripts/user_data.sh.tftpl), not Lambda: a VPC-attached Lambda
# would need a ~$35/mo NAT Gateway to reach WhatsApp/AI APIs.

data "aws_ssm_parameter" "ubuntu_2404_ami" {
  name = "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
}

# --- sslip.io hostnames (deliberate placeholder for a real domain) ---
locals {
  web_host = "${aws_eip.app.public_ip}.sslip.io"
  api_host = "api.${aws_eip.app.public_ip}.sslip.io"
}

resource "aws_eip" "app" {
  domain = "vpc"
  tags   = { Name = "${var.project_name}-app" }
}

resource "aws_eip_association" "app" {
  instance_id   = aws_instance.app.id
  allocation_id = aws_eip.app.id
}

# --- instance role: SSM + ECR pull + this project's S3/KMS/SSM-params only ---

resource "aws_iam_role" "ec2" {
  name = "${var.project_name}-ec2"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# Session Manager + Run Command (what deploy.yml uses).
resource "aws_iam_role_policy_attachment" "ec2_ssm_core" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "ec2_app" {
  name = "app-access"
  role = aws_iam_role.ec2.id

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
        Sid    = "EcrPull"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
        ]
        Resource = [aws_ecr_repository.backend.arn, aws_ecr_repository.web.arn]
      },
      {
        Sid      = "ProofsBucketReadWrite"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject"]
        Resource = "${aws_s3_bucket.proofs.arn}/*"
      },
      {
        Sid      = "PhotosBucketWrite"
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = "${aws_s3_bucket.photos.arn}/*"
      },
      {
        Sid      = "BucketReachability" # app/utils/s3.py bucket_reachable() -> head_bucket, used by /health/ready
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = [aws_s3_bucket.proofs.arn, aws_s3_bucket.photos.arn]
      },
      {
        Sid      = "ProofsKms"
        Effect   = "Allow"
        Action   = ["kms:GenerateDataKey", "kms:Decrypt"]
        Resource = aws_kms_key.proofs.arn
      },
      {
        # Read the app's config/secrets; create-if-missing only for the three
        # secrets the bootstrap script generates itself (never overwrite).
        Sid      = "ParamsRead"
        Effect   = "Allow"
        Action   = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"]
        Resource = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/${var.project_name}/*"
      },
      {
        Sid    = "ParamsCreateGenerated"
        Effect = "Allow"
        Action = ["ssm:PutParameter"]
        Resource = [
          "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/${var.project_name}/secrets/SESSION_TOKEN_SECRET",
          "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/${var.project_name}/secrets/BANK_DETAILS_ENCRYPTION_KEY",
          "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/${var.project_name}/secrets/WHATSAPP_WEBHOOK_VERIFY_TOKEN",
        ]
      },
    ]
  })
}

resource "aws_iam_instance_profile" "ec2" {
  name = "${var.project_name}-ec2"
  role = aws_iam_role.ec2.name
}

resource "aws_instance" "app" {
  ami                    = data.aws_ssm_parameter.ubuntu_2404_ami.value
  instance_type          = var.ec2_instance_type
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.ec2.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2.name

  metadata_options {
    http_tokens                 = "required" # IMDSv2 only
    http_put_response_hop_limit = 2          # containers need the extra hop to reach the instance role's credentials
  }

  root_block_device {
    volume_type = "gp3"
    volume_size = 20
    encrypted   = true
  }

  user_data = templatefile("${path.module}/scripts/user_data.sh.tftpl", {
    web_host      = local.web_host
    api_host      = local.api_host
    region        = var.aws_region
    project       = var.project_name
    bootstrap_b64 = base64encode(file("${path.module}/scripts/bootstrap.sh"))
    cron_b64      = base64encode(file("${path.module}/scripts/court-booking.cron"))
  })

  # A newer AMI or edited user-data must not silently stop/replace the only
  # server. To roll out a changed user-data/bootstrap on purpose:
  #   terraform apply -replace=aws_instance.app
  # (safe: all state is in RDS/S3; the Elastic IP re-associates.)
  lifecycle {
    ignore_changes = [ami, user_data]
  }

  tags = { Name = "${var.project_name}-app" }
}
