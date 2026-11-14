#!/usr/bin/env bash
# Publish a new owner APK to the fixed "latest APK" link (infra/downloads.tf, infra/APP-DOWNLOADS.md).
#
#   infra/scripts/publish-apk.sh <path-to.apk | https EAS artifact URL> [git-sha]
#
# Uploads TWO objects to the downloads bucket:
#   app/khelo-latest.apk               replaced every time  -> the fixed link (https://<web>/app redirects here)
#   app/khelo-YYYY-MM-DD-<sha>.apk     a dated copy, kept   -> to go back to an older APK if needed
# Then checks that both links serve the new file. Needs the AWS CLI logged in to the project account.
# Run from Git Bash; the prefix MSYS_NO_PATHCONV=1 is set below so "/app/..." keys are not rewritten into Windows paths.
set -euo pipefail
export MSYS_NO_PATHCONV=1

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
aws s3 cp "$SRC" "s3://${BUCKET}/app/khelo-latest.apk" --region "$REGION" --content-type "$TYPE" \
  --content-disposition "attachment; filename=khelo.apk" --cache-control "no-cache"

echo "Checking the links..."
LATEST="https://${BUCKET}.s3.${REGION}.amazonaws.com/app/khelo-latest.apk"
GOT=$(curl -fsSI "$LATEST" | tr -d '\r' | awk 'tolower($1)=="content-length:"{print $2}')
[[ "$GOT" == "$SIZE" ]] || { echo "Latest link serves ${GOT:-nothing}, expected ${SIZE} bytes" >&2; exit 1; }
TARGET=$(curl -fsSI "${WEB}/app" | tr -d '\r' | awk 'tolower($1)=="location:"{print $2}')
echo "OK  ${LATEST} (${GOT} bytes)"
echo "OK  ${WEB}/app -> ${TARGET:-<no redirect yet: deploy the web first>}"
echo "Dated copy: https://${BUCKET}.s3.${REGION}.amazonaws.com/${DATED}"
[[ -n "$TMP" ]] && rm -rf "$TMP"
