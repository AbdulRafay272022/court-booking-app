# Section 25, Part 1 -- networking.
#
# One VPC, one public subnet (the EC2 instance). Postgres runs as a container
# on that instance (see database.tf), so there are no private subnets and no
# DB security group: port 5432 is never published outside the compose network.
#
# There is deliberately NO NAT Gateway (~$35/mo). The background jobs run on the EC2 instance
# (see compute.tf / cron), not in Lambda -- a VPC-attached Lambda would have
# needed a NAT to reach WhatsApp/AI APIs.

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  az_primary = data.aws_availability_zones.available.names[0]
}

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

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
  description       = "All outbound (ECR/Docker Hub/SSM/S3/AI+WhatsApp APIs)"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}
