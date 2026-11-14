#!/bin/bash
# pg_dump (custom format) of the court-booking Postgres container -> S3 (bucket expires dumps after 14 days).
# Cron runs it nightly; run it by hand before anything risky:  sudo /opt/court-booking/db-backup.sh
set -euo pipefail
export PATH="$PATH:/snap/bin:/usr/local/bin"
ACC="$(aws sts get-caller-identity --query Account --output text)"
KEY="court_booking/$(date -u +%Y/%m/%d)/court_booking-$(date -u +%Y%m%dT%H%M%SZ).dump"
TMP="$(mktemp /tmp/cbdump.XXXXXX)"; trap 'rm -f "$TMP"' EXIT
docker exec court-booking-db pg_dump -U court_admin -d court_booking -Fc --no-owner > "$TMP"
[ -s "$TMP" ] || { echo "ERROR: empty dump"; exit 1; }
aws s3 cp --only-show-errors "$TMP" "s3://court-booking-app-db-backups-${ACC}/${KEY}"
echo "$(date -u +%FT%TZ) backup OK: s3://court-booking-app-db-backups-${ACC}/${KEY} ($(stat -c %s "$TMP") bytes)"
