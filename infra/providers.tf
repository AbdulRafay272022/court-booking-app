provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      project     = var.project_name
      managed_by  = "terraform"
      environment = var.environment
    }
  }
}
