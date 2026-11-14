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
  default     = "Aftr-Solutions"
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
  default     = "356441512" # Aftr-Solutions org (repo transferred from AbdulRafay272022, id 160610501)
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
  description = "t3.small (2GB RAM): this box now runs Postgres too (backend + web + db + nginx). t3.micro (1GB) was already tight WITHOUT a database; it can still be forced with -var ec2_instance_type=t3.micro (user-data adds 2GB swap either way)."
  type        = string
  default     = "t3.small"
}

variable "db_volume_size_gb" {
  description = "Size of the dedicated EBS volume holding the Postgres data directory (/srv/court-booking-db). gp3 can be grown in place later."
  type        = number
  default     = 10
}

variable "db_backup_retention_days" {
  description = "How long nightly pg_dump files are kept in the db-backups bucket."
  type        = number
  default     = 14
}
