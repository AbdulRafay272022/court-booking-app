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

# Pre-pull disk-space guard. A `docker compose pull` that runs out of space mid-download leaves
# partial layers in /var/lib/containerd/... AND (as seen on 2026-09-28) fills the SSM Agent's own
# IPC-channel directory in /var/lib/amazon/ssm/... which then crashes the deploy's ability to
# report back at all. Refuse to start rather than let that happen -- the operator can then prune
# manually, restart the deploy, or grow the disk. 2 GiB of headroom covers one backend image
# (~1 GB) plus one web image (~400 MB) plus a bit of slack for extract-in-place. Skip the guard
# when SKIP_DISK_GUARD=1 (unit test / dry-run scenarios).
if [ "${SKIP_DISK_GUARD:-0}" != "1" ]; then
  # Available blocks * 1024 to bytes; awk to strip the K suffix that df -k prints as raw kilobytes.
  AVAIL_KB="$(df -Pk / | awk 'NR==2 {print $4}')"
  MIN_KB="${MIN_FREE_KB:-2097152}"  # 2 GiB
  if [ -z "$AVAIL_KB" ] || [ "$AVAIL_KB" -lt "$MIN_KB" ]; then
    echo "ERROR: root volume has only ${AVAIL_KB:-unknown} KiB free; need ${MIN_KB} KiB (2 GiB) before pulling new images."
    echo "Prune stacked-up old images with: docker image prune -a -f  (safe -- running containers pin what they need)"
    exit 1
  fi
  echo "disk-space guard: ${AVAIL_KB} KiB free on / (>= ${MIN_KB} KiB required)"
fi

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
# `-a` is REQUIRED, not a style preference. Plain `docker image prune -f` only removes
# *dangling* images (no tag); every deploy leaves its previous IMAGE_TAG tagged and referenced
# by no running container, and those tagged-but-unused images stack up until they fill the disk
# (seen 2026-09-28: 56 images = 13.4 GB on a 20 GB root disk, deploy failed on ENOSPC).
# `-a` prunes anything not referenced by a running container -- running containers pin their
# own image, so this cannot remove an image in use.
docker image prune -a -f
docker compose -f docker-compose.prod.yml ps
