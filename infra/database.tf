# Postgres runs ON the EC2 instance as a container (postgis/postgis:16-3.4, the
# same image local dev uses) -- there is no RDS. See docker-compose.prod.yml
# (service "db") and infra/scripts/remote-deploy.sh.
#
# Data lives on its OWN encrypted EBS volume (below), mounted at
# /srv/court-booking-db, NOT on the instance's root disk -- so replacing the
# instance (`terraform apply -replace=aws_instance.app`) keeps the database:
# the new instance re-attaches the same volume and mounts it at first boot.
#
# Backups: `bootstrap.sh db-backup` (pg_dump -> the db-backups S3 bucket),
# run nightly from cron (scripts/court-booking.cron). Restore with
# `bootstrap.sh db-restore <s3-key>`. See infra/README.md.

# Generated here, stored in SSM as a SecureString, read by bootstrap.sh to
# write .env (DATABASE_URL) and .env.db (the Postgres container's own
# POSTGRES_PASSWORD). No special characters so DATABASE_URL needs no escaping.
# NOTE: the value also lands in terraform.tfstate (local, gitignored).
resource "random_password" "db" {
  length  = 32
  special = false
}

resource "aws_ssm_parameter" "db_password" {
  name  = "/${var.project_name}/db/password"
  type  = "SecureString"
  value = random_password.db.result
}

# The compose service name -- containers on the compose network resolve it.
resource "aws_ssm_parameter" "db_host" {
  name  = "/${var.project_name}/db/host"
  type  = "String"
  value = "db"
}

# --- dedicated data volume for Postgres ---

resource "aws_ebs_volume" "pgdata" {
  availability_zone = local.az_primary # must match the instance's subnet AZ
  size              = var.db_volume_size_gb
  type              = "gp3"
  encrypted         = true

  # This volume IS the database. `terraform destroy` (or a plan that would
  # replace it) fails on purpose; take a `bootstrap.sh db-backup` and remove
  # this line in its own commit if you really mean to delete it.
  lifecycle {
    prevent_destroy = true
  }

  tags = { Name = "${var.project_name}-pgdata" }
}

resource "aws_volume_attachment" "pgdata" {
  device_name = "/dev/sdf" # shows up as an NVMe device on t3; user-data finds it by volume id
  volume_id   = aws_ebs_volume.pgdata.id
  instance_id = aws_instance.app.id
}
