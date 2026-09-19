variable "aws_region" {
  description = "AWS region for all resources -- ap-south-1 (Mumbai), closest to the Karachi pilot."
  type        = string
  default     = "ap-south-1"
}

variable "project_name" {
  description = "Short project name, used as a prefix for resource names and the default_tags 'project' tag -- how this project's resources stay distinguishable from other unrelated things already in this shared AWS account."
  type        = string
  default     = "court-booking-app"
}

variable "environment" {
  description = "Deployment environment tag."
  type        = string
  default     = "pilot"
}

variable "github_owner" {
  description = "GitHub org or username that owns the repo -- scopes the OIDC trust policy so only this repo's Actions runs can assume the deploy role."
  type        = string
  default     = "AbdulRafay272022"
}

variable "github_repo" {
  description = "GitHub repo name (without the owner)."
  type        = string
  default     = "court-booking-app"
}
