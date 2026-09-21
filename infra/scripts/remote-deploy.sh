#!/bin/bash
# Runs ON the EC2 instance, sent by .github/workflows/deploy.yml via SSM Run
# Command. The workflow prepends `export AWS_REGION=... IMAGE_TAG=...` and
# writes docker-compose.prod.yml to /opt/court-booking-app before this runs.
# Kept as a real file (not an inline string in the workflow) so it can be
# read, shellchecked, and run by hand over Session Manager.
set -euo pipefail
cd /opt/court-booking-app

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
export ECR_REGISTRY="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
export IMAGE_TAG="${IMAGE_TAG:-latest}"

# The instance authenticates to ECR with its own IAM role (infra/compute.tf).
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$ECR_REGISTRY"

docker compose -f docker-compose.prod.yml pull

# Database migrations run from the NEW image BEFORE the new backend starts, so the new code never runs against a
# missing column (Section 32 rule C). `run` starts a throwaway container from the just-pulled image with the same
# .env; the running backend is untouched until `up -d` below. Alembic migrates in ONE transaction, so if a migration
# refuses or fails nothing is changed, `set -e` aborts here, and the OLD containers keep serving. Nothing to migrate
# is a no-op. The output is printed so it lands in the Actions log and the SSM invocation. To take a migration out
# of a deploy, do not push it: this runs on every deploy.
docker compose -f docker-compose.prod.yml run --rm -T --no-deps backend alembic upgrade head
docker compose -f docker-compose.prod.yml run --rm -T --no-deps backend alembic current
docker compose -f docker-compose.prod.yml run --rm -T --no-deps backend alembic check

docker compose -f docker-compose.prod.yml up -d
docker image prune -f
docker compose -f docker-compose.prod.yml ps
