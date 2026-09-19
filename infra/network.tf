# Section 25, Part 1 -- networking.
#
# One VPC, one public subnet (the EC2 instance), two private subnets (RDS).
# RDS requires a DB subnet group spanning >= 2 AZs even for a single-AZ
# instance -- a hard AWS requirement, hence two private subnets although only
# one AZ actually hosts anything.
#
# There is deliberately NO NAT Gateway (~$35/mo): nothing in the private
# subnets needs the internet. The background jobs run on the EC2 instance
# (see compute.tf / cron), not in Lambda -- a VPC-attached Lambda would have
# needed a NAT to reach WhatsApp/AI APIs.

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  az_primary   = data.aws_availability_zones.available.names[0]
  az_secondary = data.aws_availability_zones.available.names[1]
}

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true # RDS endpoint resolution inside the VPC

  tags = { Name = "${var.project_name}-vpc" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${var.project_name}-igw" }
}

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, 0)
  availability_zone       = local.az_primary
  map_public_ip_on_launch = false # the Elastic IP is the only public address

  tags = { Name = "${var.project_name}-public-${local.az_primary}" }
}

resource "aws_subnet" "private_a" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, 10)
  availability_zone = local.az_primary

  tags = { Name = "${var.project_name}-private-${local.az_primary}" }
}

resource "aws_subnet" "private_b" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, 11)
  availability_zone = local.az_secondary

  tags = { Name = "${var.project_name}-private-${local.az_secondary}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = { Name = "${var.project_name}-public-rt" }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

# Private subnets stay on the VPC's main route table, which only has the
# implicit local route -- no path to the internet, by design.

resource "aws_security_group" "ec2" {
  name        = "${var.project_name}-ec2-sg"
  description = "Web/API instance: 80/443 from anywhere. No SSH -- shell access is via SSM Session Manager."
  vpc_id      = aws_vpc.main.id

  tags = { Name = "ec2-sg" }
}

# Port 22 is intentionally absent. Access is `aws ssm start-session`, which
# is outbound-only from the instance, so no inbound rule is needed at all.
resource "aws_vpc_security_group_ingress_rule" "ec2_http" {
  security_group_id = aws_security_group.ec2.id
  description       = "HTTP (Certbot HTTP-01 challenge + redirect to HTTPS)"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
}

resource "aws_vpc_security_group_ingress_rule" "ec2_https" {
  security_group_id = aws_security_group.ec2.id
  description       = "HTTPS"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "ec2_all" {
  security_group_id = aws_security_group.ec2.id
  description       = "All outbound (ECR/SSM/S3/AI+WhatsApp APIs/RDS)"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_security_group" "rds" {
  name        = "${var.project_name}-rds-sg"
  description = "Postgres: 5432 from the EC2 security group only."
  vpc_id      = aws_vpc.main.id

  tags = { Name = "rds-sg" }
}

resource "aws_vpc_security_group_ingress_rule" "rds_from_ec2" {
  security_group_id            = aws_security_group.rds.id
  description                  = "Postgres from ec2-sg only"
  referenced_security_group_id = aws_security_group.ec2.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}
