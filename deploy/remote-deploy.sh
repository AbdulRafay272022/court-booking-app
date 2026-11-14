#!/bin/bash
# Runs ON the server (sent by .github/workflows/deploy.yml through SSM Run Command), as root.
# Needs: IMAGE_TAG, RAW (raw.githubusercontent.com URL of the repo at the deployed commit).
set -euo pipefail
: "${IMAGE_TAG:?}" "${RAW:?}"
export AWS_REGION=ap-south-1
APP_DIR=/opt/court-booking
mkdir -p "$APP_DIR"
cd "$APP_DIR"
export PATH="$PATH:/snap/bin:/usr/local/bin"

# 1) files from this commit
for f in docker-compose.yml server-env.sh db-backup.sh db-restore.sh court-booking.cron; do
  curl -fsSL "$RAW/deploy/$f" -o "$APP_DIR/$f"
done
chmod 700 server-env.sh db-backup.sh db-restore.sh

# 2) .env / .env.web / .env.db rebuilt from SSM Parameter Store every deploy (secrets never live in git)
bash ./server-env.sh

# 3) cron: background jobs + nightly DB backup
install -m 644 court-booking.cron /etc/cron.d/court-booking

# 4) pull images
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
export ECR_REGISTRY="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
export IMAGE_TAG
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$ECR_REGISTRY"
docker compose pull

# 5) database first, then migrations from the NEW image (one transaction; on failure nothing changes and the old
#    containers keep serving), then the app
docker compose up -d db
for _ in $(seq 1 60); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' court-booking-db 2>/dev/null)" = "healthy" ] && break
  sleep 2
done
[ "$(docker inspect -f '{{.State.Health.Status}}' court-booking-db)" = "healthy" ] || { docker logs --tail 50 court-booking-db; exit 1; }
docker compose run --rm -T --no-deps backend alembic upgrade head
docker compose run --rm -T --no-deps backend alembic current

docker compose up -d --remove-orphans

# 6) remove old court-booking image tags only (other apps on this server are left alone)
docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '/court-booking-app-(backend|web):' \
  | grep -v -E ":(${IMAGE_TAG}|latest)$" | xargs -r docker rmi >/dev/null 2>&1 || true
docker image prune -f >/dev/null

sleep 15
docker compose ps
curl -fsS -m 10 http://127.0.0.1:8100/health && echo
