# Section 25, Part 3 -- RDS Postgres. Resolves AUDIT_FINDINGS.md D.1
# ("no managed Postgres provider chosen"): the answer is RDS.
#
# Postgres 16 to match the local postgis/postgis:16-3.4 image. PostGIS is
# NOT created by any Alembic migration (locally the postgis image
# pre-creates it), so `CREATE EXTENSION postgis` has to run once against RDS
# before `alembic upgrade head` -- infra/scripts/bootstrap.sh does this from
# inside the VPC (RDS is unreachable from anywhere else).

resource "aws_db_subnet_group" "main" {
  name       = "${var.project_name}-db"
  subnet_ids = [aws_subnet.private_a.id, aws_subnet.private_b.id]
}

# Generated here, stored in SSM as a SecureString, read by the instance's
# bootstrap script. Deliberately NOT `manage_master_user_password` (Secrets
# Manager): that rotates the password every 7 days by default, which would
# silently break a DATABASE_URL baked into the instance's .env.
# NOTE: the value also lands in terraform.tfstate (local, gitignored) --
# another reason to move state to an encrypted S3 backend before a second
# operator exists.
resource "random_password" "db" {
  length  = 32
  special = false # keeps DATABASE_URL free of characters needing escaping
}

resource "aws_db_instance" "main" {
  identifier     = "${var.project_name}-db"
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.db_instance_class

  allocated_storage = var.db_allocated_storage_gb
  storage_type      = "gp3"
  storage_encrypted = true

  db_name  = "court_booking"
  username = "court_admin"
  password = random_password.db.result

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false
  multi_az               = false # pilot scale; flip to true (and re-plan) when uptime matters more than ~2x DB cost

  backup_retention_period = var.db_backup_retention_days
  backup_window           = "20:00-21:00" # UTC == 01:00-02:00 PKT, the quietest hour
  maintenance_window      = "sun:21:30-sun:22:30"
  copy_tags_to_snapshot   = true

  auto_minor_version_upgrade = true
  deletion_protection        = var.deletion_protection
  skip_final_snapshot        = false
  final_snapshot_identifier  = "${var.project_name}-db-final"

  tags = { Name = "${var.project_name}-db" }
}

resource "aws_ssm_parameter" "db_password" {
  name  = "/${var.project_name}/db/password"
  type  = "SecureString"
  value = random_password.db.result
}

resource "aws_ssm_parameter" "db_host" {
  name  = "/${var.project_name}/db/host"
  type  = "String"
  value = aws_db_instance.main.address
}
