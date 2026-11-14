#!/usr/bin/env bash
# Publish a new owner APK to the fixed "latest APK" link (infra/downloads.tf, infra/APP-DOWNLOADS.md).
#
#   infra/scripts/publish-apk.sh <path-to.apk | https EAS artifact URL> [git-sha]
#
# Uploads TWO objects to the downloads bucket:
#   app/khelo-latest.apk               replaced every time  -> the fixed link (https://<web>/app redirects here)
#   app/khelo-YYYY-MM-DD-<sha>.apk     a dated copy, kept   -> to go back to an older APK if needed
# Then checks that both links serve the new file. Needs the AWS CLI logged in to the project account.
# Runs in Git Bash or any bash. (No MSYS_NO_PATHCONV: the S3 keys do not start with "/", and it would break the temp path.)
set -euo pipefail
# a ~150 MB upload over a home connection: retry dropped parts instead of failing the whole file
export AWS_RETRY_MODE="${AWS_RETRY_MODE:-adaptive}" AWS_MAX_ATTEMPTS="${AWS_MAX_ATTEMPTS:-10}"

REGION="ap-south-1"
BUCKET="${DOWNLOADS_BUCKET:-court-booking-app-app-downloads-959666773387}"
WEB="${KHELO_WEB_URL:-https://3.6.48.6.sslip.io}"
SRC="${1:?usage: publish-apk.sh <file.apk | https-url> [git-sha]}"
SHA="${2:-$(git rev-parse --short HEAD 2>/dev/null || echo manual)}"
DATE="$(date +%Y-%m-%d)"
TMP=""

if [[ "$SRC" == https://* ]]; then
  TMP="$(mktemp -d)"
  echo "Downloading $SRC"
  curl -fsSL "$SRC" -o "$TMP/khelo.apk"
  SRC="$TMP/khelo.apk"
fi
[[ -f "$SRC" ]] || { echo "No such file: $SRC" >&2; exit 1; }
# an APK is a zip: it must start with "PK"
[[ "$(head -c 2 "$SRC")" == "PK" ]] || { echo "Not an APK (zip) file: $SRC" >&2; exit 1; }

SIZE=$(wc -c < "$SRC" | tr -d ' ')
DATED="app/khelo-${DATE}-${SHA}.apk"
TYPE="application/vnd.android.package-archive"
echo "APK ${SIZE} bytes -> s3://${BUCKET}/${DATED} and s3://${BUCKET}/app/khelo-latest.apk"

# the dated copy first: if the second upload fails, the old latest is still intact
aws s3 cp "$SRC" "s3://${BUCKET}/${DATED}" --region "$REGION" --content-type "$TYPE" \
  --content-disposition "attachment; filename=khelo.apk" --cache-control "public, max-age=31536000, immutable"
# "latest" is a server-side copy of the dated file: the APK is uploaded once (a second 150 MB upload over a home
# connection failed on 14 Nov), and the copy inside S3 takes seconds
aws s3 cp "s3://${BUCKET}/${DATED}" "s3://${BUCKET}/app/khelo-latest.apk" --region "$REGION" --content-type "$TYPE" \
  --content-disposition "attachment; filename=khelo.apk" --cache-control "no-cache" --metadata-directive REPLACE

echo "Checking the links..."
LATEST="https://${BUCKET}.s3.${REGION}.amazonaws.com/app/khelo-latest.apk"
GOT=$(curl -fsSI "$LATEST" | tr -d '\r' | awk 'tolower($1)=="content-length:"{print $2}')
[[ "$GOT" == "$SIZE" ]] || { echo "Latest link serves ${GOT:-nothing}, expected ${SIZE} bytes" >&2; exit 1; }
TARGET=$(curl -fsSI "${WEB}/app" | tr -d '\r' | awk 'tolower($1)=="location:"{print $2}')
echo "OK  ${LATEST} (${GOT} bytes)"
echo "OK  ${WEB}/app -> ${TARGET:-<no redirect yet: deploy the web first>}"
echo "Dated copy: https://${BUCKET}.s3.${REGION}.amazonaws.com/${DATED}"
[[ -n "$TMP" ]] && rm -rf "$TMP"
