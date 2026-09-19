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

# GitHub's OIDC `sub` claim now embeds immutable numeric IDs:
#   repo:<owner>@<owner_id>/<repo>@<repo_id>:ref:refs/heads/main
# rather than the older repo:<owner>/<repo>:ref:... form. A trust policy
# written against the old form never matches (the wildcard can't bridge the
# @<id> segments) -- AssumeRoleWithWebIdentity is denied with a generic
# "Not authorized". These values were read from the actual failed
# AssumeRoleWithWebIdentity events in CloudTrail on 2026-09-19, not guessed.
# Pinning the IDs also means a renamed/deleted-and-recreated repo (or a new
# owner reusing the old username) can't inherit this role.
variable "github_owner_id" {
  description = "Numeric GitHub owner (user/org) ID, as embedded in the OIDC sub claim."
  type        = string
  default     = "160610501"
}

variable "github_repo_id" {
  description = "Numeric GitHub repository ID, as embedded in the OIDC sub claim."
  type        = string
  default     = "1377316289"
}

# --- Section 25: AWS pilot deployment ---

variable "vpc_cidr" {
  description = "CIDR for the pilot VPC."
  type        = string
  default     = "10.20.0.0/16"
}

variable "ec2_instance_type" {
  description = "t3.micro is free-tier eligible only on some accounts (depends on account age/plan) and has 1GB RAM -- user-data adds swap because backend+web+nginx is tight on it."
  type        = string
  default     = "t3.micro"
}

variable "db_instance_class" {
  type    = string
  default = "db.t3.micro"
}

variable "db_allocated_storage_gb" {
  type    = number
  default = 20
}

variable "db_backup_retention_days" {
  description = "RDS automated backup retention in days (point-in-time restore window). 1 because this account is on the AWS Free plan, which rejects anything higher at CreateDBInstance (FreeTierRestrictionError, 2026-09-19). Raise it (7+ recommended for a payments app) after upgrading the account plan -- it's an in-place change, no rebuild."
  type        = number
  default     = 1
}

variable "deletion_protection" {
  description = "Guards the RDS instance against an accidental terraform destroy. Turn off deliberately, in its own apply, before tearing the stack down."
  type        = bool
  default     = true
}
