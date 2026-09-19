#!/bin/bash
# Re-runnable post-provision setup, run ON the instance (via SSM Session
# Manager) -- see infra/README.md for the exact order:
#
#   sudo /opt/court-booking-app/bootstrap.sh env            # build .env/.env.web from SSM
#   sudo /opt/court-booking-app/bootstrap.sh db-init        # CREATE EXTENSION postgis on RDS
#   (deploy the containers: push to main, or run the deploy workflow)
#   sudo /opt/court-booking-app/bootstrap.sh migrate        # alembic upgrade head + alembic check
#   sudo /opt/court-booking-app/bootstrap.sh nginx-cert <letsencrypt-email>
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
DATABASE_URL=postgresql+asyncpg://court_admin:${db_pass}@${db_host}:5432/court_booking?ssl=require
SESSION_TOKEN_SECRET=$(ssm_get "$P/secrets/SESSION_TOKEN_SECRET")
BANK_DETAILS_ENCRYPTION_KEY=$(ssm_get "$P/secrets/BANK_DETAILS_ENCRYPTION_KEY")
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
SENTRY_DSN=$(ssm_get "$P/secrets/SENTRY_DSN")
ENV
  # .env.web is only read by `docker compose` for the web container; the
  # browser-side API URL is baked at IMAGE BUILD time (see the web
  # Dockerfile) -- this only feeds Next's server-side fetches at runtime.
  cat > "$APP_DIR/.env.web" <<ENVWEB
NEXT_PUBLIC_API_BASE_URL=https://${API_HOST}
ENVWEB
  chmod 600 "$APP_DIR/.env" "$APP_DIR/.env.web"
  echo "wrote $APP_DIR/.env and .env.web (AI provider: ${provider})"
}

phase_db_init() {
  local db_host db_pass
  db_host=$(ssm_get "$P/db/host"); db_pass=$(ssm_get "$P/db/password")
  # Alembic never creates PostGIS (the local postgis image pre-creates it),
  # and the geometry columns need it. The RDS master user has rds_superuser,
  # which is allowed to CREATE EXTENSION postgis.
  PGPASSWORD="$db_pass" PGSSLMODE=require psql -h "$db_host" -U court_admin -d court_booking -v ON_ERROR_STOP=1 \
    -c "CREATE EXTENSION IF NOT EXISTS postgis;" -c "SELECT postgis_full_version();"
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
  migrate)    phase_migrate ;;
  nginx-cert) shift; phase_nginx_cert "$@" ;;
  *) echo "usage: $0 {env|db-init|migrate|nginx-cert <email>}"; exit 1 ;;
esac
