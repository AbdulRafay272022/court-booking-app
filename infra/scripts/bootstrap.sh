#!/bin/bash
# Re-runnable post-provision setup, run ON the instance (via SSM Session
# Manager) -- see infra/README.md for the exact order:
#
#   sudo /opt/court-booking-app/bootstrap.sh env            # build .env/.env.web/.env.db from SSM
#   (deploy the containers: push to main, or run the deploy workflow -- starts the db container too)
#   sudo /opt/court-booking-app/bootstrap.sh db-init        # CREATE EXTENSION postgis (the image already does; harmless)
#   sudo /opt/court-booking-app/bootstrap.sh migrate        # alembic upgrade head + alembic check
#   sudo /opt/court-booking-app/bootstrap.sh nginx-cert <letsencrypt-email>
#
# Database (Postgres container "court-booking-db", data on /srv/court-booking-db):
#   sudo /opt/court-booking-app/bootstrap.sh db-backup              # pg_dump -> s3://<db-backups bucket>/... (cron runs it nightly)
#   sudo /opt/court-booking-app/bootstrap.sh db-restore <s3-key|/path/file.dump>   # pg_restore a custom-format dump
#
# Every phase is idempotent. Nothing here ever prints a secret.
set -euo pipefail

# shellcheck disable=SC1091
source /etc/court-booking/host.env
APP_DIR=/opt/court-booking-app
P="/${PROJECT}"

ssm_get()  { aws ssm get-parameter --region "$AWS_REGION" --with-decryption --name "$1" --query Parameter.Value --output text 2>/dev/null || true; }

# Create a random secret in SSM only if it doesn't exist yet (--no-overwrite):
# regenerating BANK_DETAILS_ENCRYPTION_KEY would make every stored bank
# detail unreadable, so this must never overwrite.
ensure_generated() { # name, generator-command
  local name="$1" gen="$2"
  if [ -z "$(ssm_get "$P/secrets/$name")" ]; then
    aws ssm put-parameter --region "$AWS_REGION" --name "$P/secrets/$name" --type SecureString \
      --no-overwrite --value "$(eval "$gen")" >/dev/null
    echo "generated $name (stored in SSM, not printed)"
  fi
}

phase_env() {
  ensure_generated SESSION_TOKEN_SECRET            "python3 -c 'import secrets;print(secrets.token_urlsafe(64))'"
  # A Fernet key is 32 random bytes, urlsafe-base64 encoded.
  ensure_generated BANK_DETAILS_ENCRYPTION_KEY     "python3 -c 'import base64,os;print(base64.urlsafe_b64encode(os.urandom(32)).decode())'"
  ensure_generated WHATSAPP_WEBHOOK_VERIFY_TOKEN   "python3 -c 'import secrets;print(secrets.token_urlsafe(32))'"

  local db_host db_pass kms_arn proofs photos cf
  db_host=$(ssm_get "$P/db/host");          db_pass=$(ssm_get "$P/db/password")
  kms_arn=$(ssm_get "$P/infra/kms_key_arn"); proofs=$(ssm_get "$P/infra/proofs_bucket")
  photos=$(ssm_get "$P/infra/photos_bucket"); cf=$(ssm_get "$P/infra/cloudfront_domain")
  for v in db_host db_pass kms_arn proofs photos cf; do
    [ -n "${!v}" ] || { echo "ERROR: SSM value for $v is empty -- did terraform apply finish?"; exit 1; }
  done

  local anthropic gemini provider
  anthropic=$(ssm_get "$P/secrets/ANTHROPIC_API_KEY"); gemini=$(ssm_get "$P/secrets/GEMINI_API_KEY")
  if [ -n "$anthropic" ]; then provider=claude
  elif [ -n "$gemini" ]; then provider=gemini
  else provider=claude; echo "WARNING: no ANTHROPIC_API_KEY or GEMINI_API_KEY in SSM -- AI chat/OCR will not work until one is added and 'env' is re-run."; fi

  umask 077
  cat > "$APP_DIR/.env" <<ENV
APP_NAME="Court Booking API"
DEBUG=false
API_V1_PREFIX=/api/v1
ALLOWED_ORIGINS=["https://${WEB_HOST}"]
DATABASE_URL=postgresql+asyncpg://court_admin:${db_pass}@${db_host}:5432/court_booking
SESSION_TOKEN_SECRET=$(ssm_get "$P/secrets/SESSION_TOKEN_SECRET")
BANK_DETAILS_ENCRYPTION_KEY=$(ssm_get "$P/secrets/BANK_DETAILS_ENCRYPTION_KEY")
# Key rotation (optional): earlier keys, comma-separated, only to READ data written with them.
BANK_DETAILS_ENCRYPTION_KEYS_OLD=$(ssm_get "$P/secrets/BANK_DETAILS_ENCRYPTION_KEYS_OLD")
AWS_REGION=${AWS_REGION}
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_ENDPOINT_URL=
S3_BUCKET_PUBLIC=${photos}
S3_BUCKET_PRIVATE=${proofs}
S3_KMS_KEY_ID=${kms_arn}
CLOUDFRONT_DOMAIN=${cf}
WHATSAPP_API_URL=https://graph.facebook.com/v20.0
WHATSAPP_API_TOKEN=$(ssm_get "$P/secrets/WHATSAPP_API_TOKEN")
WHATSAPP_PHONE_NUMBER_ID=$(ssm_get "$P/secrets/WHATSAPP_PHONE_NUMBER_ID")
WHATSAPP_WEBHOOK_VERIFY_TOKEN=$(ssm_get "$P/secrets/WHATSAPP_WEBHOOK_VERIFY_TOKEN")
WHATSAPP_APP_SECRET=$(ssm_get "$P/secrets/WHATSAPP_APP_SECRET")
AI_PROVIDER=${provider}
AI_VISION_PROVIDER=${provider}
ANTHROPIC_API_KEY=${anthropic}
GEMINI_API_KEY=${gemini}
OPENAI_API_KEY=$(ssm_get "$P/secrets/OPENAI_API_KEY")
FCM_SERVICE_ACCOUNT_KEY=$(ssm_get "$P/secrets/FCM_SERVICE_ACCOUNT_KEY")
APNS_KEY=$(ssm_get "$P/secrets/APNS_KEY")
APNS_KEY_ID=$(ssm_get "$P/secrets/APNS_KEY_ID")
APNS_TEAM_ID=$(ssm_get "$P/secrets/APNS_TEAM_ID")
WEB_PUSH_VAPID_PRIVATE_KEY=$(ssm_get "$P/secrets/WEB_PUSH_VAPID_PRIVATE_KEY")
WEB_PUSH_VAPID_PUBLIC_KEY=$(ssm_get "$P/secrets/WEB_PUSH_VAPID_PUBLIC_KEY")
WEB_PUSH_VAPID_SUBJECT=$(ssm_get "$P/secrets/WEB_PUSH_VAPID_SUBJECT")
CNIC_HASH_KEY=$(ssm_get "$P/secrets/CNIC_HASH_KEY")
SENTRY_DSN=$(ssm_get "$P/secrets/SENTRY_DSN")
PLATFORM_BANK_NAME=$(ssm_get "$P/secrets/PLATFORM_BANK_NAME")
PLATFORM_ACCOUNT_TITLE=$(ssm_get "$P/secrets/PLATFORM_ACCOUNT_TITLE")
PLATFORM_ACCOUNT_NUMBER=$(ssm_get "$P/secrets/PLATFORM_ACCOUNT_NUMBER")
PLATFORM_IBAN=$(ssm_get "$P/secrets/PLATFORM_IBAN")
ENV
  # The Postgres container's own credentials (docker-compose.prod.yml, service "db"). Only read on the db's FIRST init
  # (empty data dir); changing the password later needs ALTER USER inside the db as well.
  cat > "$APP_DIR/.env.db" <<ENVDB
POSTGRES_USER=court_admin
POSTGRES_PASSWORD=${db_pass}
POSTGRES_DB=court_booking
ENVDB
  # .env.web is only read by `docker compose` for the web container; the
  # browser-side API URL is baked at IMAGE BUILD time (see the web
  # Dockerfile) -- this only feeds Next's server-side fetches at runtime.
  # The five site-content values below are PUBLIC contact info (not secrets). The web app reads them at request time, so changing a line
  # here and re-running `bootstrap.sh env` + recreating the web container is enough (no image rebuild). Unset/empty = that content is hidden.
  cat > "$APP_DIR/.env.web" <<ENVWEB
NEXT_PUBLIC_API_BASE_URL=https://${API_HOST}
NEXT_PUBLIC_SUPPORT_WHATSAPP=923345634571
NEXT_PUBLIC_SUPPORT_EMAIL=info@khelo.pk
NEXT_PUBLIC_SUPPORT_HOURS=Roz 10am se 3am
NEXT_PUBLIC_OWNER_PRICING_TEXT=14 din free trial
NEXT_PUBLIC_SITE_URL=https://${WEB_HOST}
ENVWEB
  chmod 600 "$APP_DIR/.env" "$APP_DIR/.env.web" "$APP_DIR/.env.db"
  echo "wrote $APP_DIR/.env, .env.web and .env.db (AI provider: ${provider})"
}

DB_CONTAINER=court-booking-db
db_psql() { docker exec -i "$DB_CONTAINER" psql -U court_admin -d court_booking -v ON_ERROR_STOP=1 "$@"; }

phase_db_init() {
  # The postgis/postgis image already creates the extension in POSTGRES_DB on first init; this is a re-runnable check.
  db_psql -c "CREATE EXTENSION IF NOT EXISTS postgis;" -c "SELECT postgis_full_version();"
}

phase_db_backup() {
  local bucket key tmp
  bucket=$(ssm_get "$P/infra/db_backups_bucket")
  [ -n "$bucket" ] || { echo "ERROR: SSM $P/infra/db_backups_bucket is empty -- did terraform apply finish?"; exit 1; }
  key="court_booking/$(date -u +%Y/%m/%d)/court_booking-$(date -u +%Y%m%dT%H%M%SZ).dump"
  tmp=$(mktemp /tmp/cbdump.XXXXXX)
  trap 'rm -f "$tmp"' RETURN
  # Custom format (-Fc): compressed, and pg_restore can restore it selectively.
  docker exec "$DB_CONTAINER" pg_dump -U court_admin -d court_booking -Fc --no-owner > "$tmp"
  [ -s "$tmp" ] || { echo "ERROR: pg_dump produced an empty file"; exit 1; }
  aws s3 cp --only-show-errors "$tmp" "s3://$bucket/$key"
  echo "backup OK: s3://$bucket/$key ($(stat -c %s "$tmp") bytes)"
}

# Restore a custom-format dump (from this app's db-backup, or a pg_dump -Fc of the old RDS database) into the running db.
# --clean --if-exists replaces existing objects. Stop the app first so nothing writes mid-restore.
phase_db_restore() {
  local src="${1:-}" bucket file
  [ -n "$src" ] || { echo "usage: bootstrap.sh db-restore <s3-key in the db-backups bucket | /local/path.dump>"; exit 1; }
  if [ -f "$src" ]; then file="$src"; else
    bucket=$(ssm_get "$P/infra/db_backups_bucket"); file=$(mktemp /tmp/cbrestore.XXXXXX)
    aws s3 cp --only-show-errors "s3://$bucket/$src" "$file"
  fi
  docker compose -f "$APP_DIR/docker-compose.prod.yml" --project-directory "$APP_DIR" stop backend web || true
  db_psql -c "CREATE EXTENSION IF NOT EXISTS postgis;"
  docker exec -i "$DB_CONTAINER" pg_restore -U court_admin -d court_booking --clean --if-exists --no-owner --no-privileges \
    < "$file" || echo "WARNING: pg_restore reported errors (often harmless 'extension already exists' style ones) -- check the output above."
  docker compose -f "$APP_DIR/docker-compose.prod.yml" --project-directory "$APP_DIR" up -d
  docker exec court-booking-backend alembic current || true
  echo "restore finished from $src"
}

phase_migrate() {
  docker exec court-booking-backend alembic upgrade head
  docker exec court-booking-backend alembic check
}

phase_nginx_cert() {
  local email="${1:-}"
  [ -n "$email" ] || { echo "usage: bootstrap.sh nginx-cert <email for Let's Encrypt expiry notices>"; exit 1; }

  cat > /etc/nginx/sites-available/court-booking <<NGINX
# Two server blocks, one Elastic IP, routed by hostname -- same shape a real
# domain would use (see README "Migrating off sslip.io").
server {
    listen 80;
    server_name ${WEB_HOST};
    client_max_body_size 12m;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
server {
    listen 80;
    server_name ${API_HOST};
    client_max_body_size 12m;   # payment-proof uploads
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }
}
NGINX
  ln -sf /etc/nginx/sites-available/court-booking /etc/nginx/sites-enabled/court-booking
  rm -f /etc/nginx/sites-enabled/default
  nginx -t && systemctl reload nginx

  # One cert covering both hostnames. HTTP-01 works because both genuinely
  # resolve to this box via sslip.io.
  certbot --nginx --non-interactive --agree-tos --redirect -m "$email" \
    --domains "${WEB_HOST},${API_HOST}"
  systemctl enable --now certbot.timer
  certbot certificates
}

case "${1:-}" in
  env)        phase_env ;;
  db-init)    phase_db_init ;;
  db-backup)  phase_db_backup ;;
  db-restore) shift; phase_db_restore "$@" ;;
  migrate)    phase_migrate ;;
  nginx-cert) shift; phase_nginx_cert "$@" ;;
  *) echo "usage: $0 {env|db-init|db-backup|db-restore <src>|migrate|nginx-cert <email>}"; exit 1 ;;
esac
