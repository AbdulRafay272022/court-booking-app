#!/usr/bin/env bash
# Publish the app's JS as an OTA update to the owners' APKs (EAS channel "preview": the 7 and 8 Nov preview APKs).
#
#   apps/mobile/scripts/ota-preview.sh "message"
#
# Refuses to publish when:
#   - EXPO_PUBLIC_API_BASE_URL points anywhere but production (the APKs must keep talking to the production server);
#   - the PRODUCTION backend is still the old one (no ledger_v2 in /api/v1/feature-flags): the new app must never reach
#     phones before the backend it needs (founder 14 Nov, "Before prod" step 2).
# It does NOT need the ledger_v2 flag to be on: with the flag OFF the new app shows the old screens.
set -euo pipefail
cd "$(dirname "$0")/.."

MSG="${1:?usage: ota-preview.sh \"what changed\"}"
PROD_API="https://api.3.6.48.6.sslip.io"
UPDATE_URL="https://3.6.48.6.sslip.io/app"

if [[ -n "${EXPO_PUBLIC_API_BASE_URL:-}" && "${EXPO_PUBLIC_API_BASE_URL}" != "$PROD_API" ]]; then
  echo "STOP: EXPO_PUBLIC_API_BASE_URL=${EXPO_PUBLIC_API_BASE_URL} (not production). Unset it and run again." >&2
  exit 1
fi
unset EXPO_PUBLIC_API_BASE_URL # app.json extra.apiBaseUrl (production) is used

FLAGS=$(curl -fsS "${PROD_API}/api/v1/feature-flags") || { echo "STOP: production API not reachable" >&2; exit 1; }
if ! grep -q '"ledger_v2"' <<<"$FLAGS"; then
  echo "STOP: the production backend has no ledger_v2 yet (old backend). Deploy the backend first." >&2
  exit 1
fi
echo "Production backend is the new one. ledger_v2: $(grep -o '"ledger_v2":[a-z]*' <<<"$FLAGS")"

export APP_VARIANT=preview
export EXPO_PUBLIC_UPDATE_URL="$UPDATE_URL"
npx -y eas-cli@27.9.0 update --channel preview --message "$MSG" --non-interactive
