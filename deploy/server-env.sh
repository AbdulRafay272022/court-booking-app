#!/bin/bash
# Writes /opt/court-booking/.env, .env.web and .env.db from SSM Parameter Store (/court-booking-app/...).
# Run by remote-deploy.sh on every deploy. To change a secret: put it in SSM, then re-run the deploy workflow.
#   aws ssm put-parameter --region ap-south-1 --type SecureString --overwrite --name /court-booking-app/secrets/GEMINI_API_KEY --value '...'
set -euo pipefail
export PATH="$PATH:/snap/bin:/usr/local/bin"
APP_DIR=/opt/court-booking
P=/court-booking-app
R=ap-south-1
WEB_HOST=khelo.13.233.73.99.sslip.io
API_HOST=api.khelo.13.233.73.99.sslip.io
ACC="$(aws sts get-caller-identity --query Account --output text)"

# All params in one call per path; missing ones are just empty.
declare -A V
while IFS=$'\t' read -r name value; do V["${name##*/}"]="$value"; done < <(
  aws ssm get-parameters-by-path --region "$R" --path "$P" --recursive --with-decryption \
    --query 'Parameters[].[Name,Value]' --output text)
g() { printf '%s' "${V[$1]:-}"; }

[ -n "$(g password)" ] && [ -n "$(g SESSION_TOKEN_SECRET)" ] && [ -n "$(g BANK_DETAILS_ENCRYPTION_KEY)" ] \
  || { echo "ERROR: required SSM params missing under $P"; exit 1; }

if [ -n "$(g ANTHROPIC_API_KEY)" ]; then provider=claude; elif [ -n "$(g GEMINI_API_KEY)" ]; then provider=gemini
else provider=gemini; echo "WARNING: no ANTHROPIC_API_KEY / GEMINI_API_KEY in SSM -- AI chat/OCR is off until one is added."; fi

umask 077
cat > "$APP_DIR/.env" <<ENV
APP_NAME="Court Booking API"
DEBUG=false
API_V1_PREFIX=/api/v1
ALLOWED_ORIGINS=["https://${WEB_HOST}"]
DATABASE_URL=postgresql+asyncpg://court_admin:$(g password)@db:5432/court_booking
SESSION_TOKEN_SECRET=$(g SESSION_TOKEN_SECRET)
BANK_DETAILS_ENCRYPTION_KEY=$(g BANK_DETAILS_ENCRYPTION_KEY)
BANK_DETAILS_ENCRYPTION_KEYS_OLD=$(g BANK_DETAILS_ENCRYPTION_KEYS_OLD)
AWS_REGION=${R}
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_ENDPOINT_URL=
S3_BUCKET_PUBLIC=court-booking-app-photos-${ACC}
S3_BUCKET_PRIVATE=court-booking-app-proofs-${ACC}
S3_KMS_KEY_ID=
CLOUDFRONT_DOMAIN=
WHATSAPP_API_URL=https://graph.facebook.com/v20.0
WHATSAPP_API_TOKEN=$(g WHATSAPP_API_TOKEN)
WHATSAPP_PHONE_NUMBER_ID=$(g WHATSAPP_PHONE_NUMBER_ID)
WHATSAPP_WEBHOOK_VERIFY_TOKEN=$(g WHATSAPP_WEBHOOK_VERIFY_TOKEN)
WHATSAPP_APP_SECRET=$(g WHATSAPP_APP_SECRET)
AI_PROVIDER=${provider}
AI_VISION_PROVIDER=${provider}
ANTHROPIC_API_KEY=$(g ANTHROPIC_API_KEY)
GEMINI_API_KEY=$(g GEMINI_API_KEY)
OPENAI_API_KEY=$(g OPENAI_API_KEY)
FCM_SERVICE_ACCOUNT_KEY=$(g FCM_SERVICE_ACCOUNT_KEY)
APNS_KEY=$(g APNS_KEY)
APNS_KEY_ID=$(g APNS_KEY_ID)
APNS_TEAM_ID=$(g APNS_TEAM_ID)
WEB_PUSH_VAPID_PRIVATE_KEY=$(g WEB_PUSH_VAPID_PRIVATE_KEY)
WEB_PUSH_VAPID_PUBLIC_KEY=$(g WEB_PUSH_VAPID_PUBLIC_KEY)
WEB_PUSH_VAPID_SUBJECT=$(g WEB_PUSH_VAPID_SUBJECT)
CNIC_HASH_KEY=$(g CNIC_HASH_KEY)
SENTRY_DSN=$(g SENTRY_DSN)
PLATFORM_BANK_NAME=$(g PLATFORM_BANK_NAME)
PLATFORM_ACCOUNT_TITLE=$(g PLATFORM_ACCOUNT_TITLE)
PLATFORM_ACCOUNT_NUMBER=$(g PLATFORM_ACCOUNT_NUMBER)
PLATFORM_IBAN=$(g PLATFORM_IBAN)
ENV

cat > "$APP_DIR/.env.db" <<ENVDB
POSTGRES_USER=court_admin
POSTGRES_PASSWORD=$(g password)
POSTGRES_DB=court_booking
ENVDB

# Public values only. The browser-side API URL is baked into the web image at build time (deploy.yml).
cat > "$APP_DIR/.env.web" <<ENVWEB
NEXT_PUBLIC_API_BASE_URL=https://${API_HOST}
NEXT_PUBLIC_SUPPORT_WHATSAPP=923345634571
NEXT_PUBLIC_SUPPORT_EMAIL=info@khelo.pk
NEXT_PUBLIC_SUPPORT_HOURS=Roz 10am se 3am
NEXT_PUBLIC_OWNER_PRICING_TEXT=14 din free trial
NEXT_PUBLIC_SITE_URL=https://${WEB_HOST}
ENVWEB
chmod 600 "$APP_DIR/.env" "$APP_DIR/.env.db" "$APP_DIR/.env.web"
echo "env files written (AI provider: ${provider})"
