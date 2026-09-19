# Two repos so the backend (FastAPI) and web (Next.js) images have
# independent tag histories / lifecycle policies -- they deploy and version
# on different cadences even though they ship from the same commit today.

resource "aws_ecr_repository" "backend" {
  name                 = "${var.project_name}-backend"
  image_tag_mutability = "MUTABLE" # workflow pushes both <sha> and a floating "latest" tag

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_repository" "web" {
  name                 = "${var.project_name}-web"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

# Keep the last 10 tagged images per repo (the EC2 instance only ever runs
# the latest anyway) so ECR storage doesn't grow unbounded across every
# push to main. Untagged images (superseded manifests) are swept after 1
# day, they're never pulled directly.
resource "aws_ecr_lifecycle_policy" "backend" {
  repository = aws_ecr_repository.backend.name
  policy     = local.lifecycle_policy_json
}

resource "aws_ecr_lifecycle_policy" "web" {
  repository = aws_ecr_repository.web.name
  policy     = local.lifecycle_policy_json
}

locals {
  lifecycle_policy_json = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images after 1 day"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 1
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        # Each push tags one image with both <sha> and "latest" -- ECR
        # counts that as a single image by digest, so "any" here means
        # "keep the last 10 pushes", not "keep the last 10 tags".
        description = "Keep only the last 10 pushed images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = { type = "expire" }
      }
    ]
  })
}
