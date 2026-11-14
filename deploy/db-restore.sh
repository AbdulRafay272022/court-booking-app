#!/bin/bash
# Restore a pg_dump -Fc file into the court-booking database (REPLACES existing data).
#   sudo /opt/court-booking/db-restore.sh /path/file.dump
#   sudo /opt/court-booking/db-restore.sh s3://bucket/key.dump
# Used for: restoring a backup, or importing the old (RDS) database. For the old database the SAME
# BANK_DETAILS_ENCRYPTION_KEY and CNIC_HASH_KEY must be in SSM first, then redeploy.
set -euo pipefail
export PATH="$PATH:/snap/bin:/usr/local/bin"
SRC="${1:?usage: db-restore.sh <file|s3://...>}"
FILE="$SRC"
if [[ "$SRC" == s3://* ]]; then FILE="$(mktemp /tmp/cbrestore.XXXXXX)"; aws s3 cp --only-show-errors "$SRC" "$FILE"; fi
cd /opt/court-booking
/opt/court-booking/db-backup.sh || echo "WARNING: pre-restore backup failed"
docker compose stop backend web
docker exec -i court-booking-db pg_restore -U court_admin -d court_booking --clean --if-exists --no-owner --no-privileges < "$FILE" \
  || echo "WARNING: pg_restore reported errors -- read them above (extension 'already exists' style errors are harmless)."
docker compose up -d
docker compose run --rm -T --no-deps backend alembic upgrade head
echo "restore finished from $SRC"
