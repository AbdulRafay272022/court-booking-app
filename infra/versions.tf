terraform {
  required_version = ">= 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Local state for now (single operator, small pilot). Move to an S3
  # backend (with DynamoDB locking) before more than one person runs
  # `terraform apply` against this, or before this grows past the
  # ECR-only scope it has today.
}
