# Ledger v2: production rollout (fixed order, founder 14 Nov)

Nothing here runs without the founder's GO for that step. Branch: `feat/ledger-v2`.

## 0. Before anything
- Production DB head is `c3e8a1f5b902` (refund disputes). Ledger's migration `e6b2d4f8a913` sits on top of it.
- **Prod copy (GO):** restore a copy, `alembic upgrade head`, `scripts/ledger_v2_backfill.py --dry-run`, `scripts/ledger_v2_check.py`
  (0 failures; read the day-by-day difference), then the real backfill + check on the copy, one round of screenshots on real data.
- `terraform plan` for `infra/downloads.tf` (must only ADD the downloads bucket); apply on GO. Then publish the current APK once
  with `infra/scripts/publish-apk.sh` so `/app` has a file to serve.

## 1. Backend + web deploy: flag OFF, MIN_STAFF_APP_LEVEL=0
- Fresh manual RDS snapshot.
- Merge to `main` with `Migration-Go: owner-approved` (founder's go). The deploy runs the migration (adds columns/tables only).
- `ledger_v2` stays OFF and `MIN_STAFF_APP_LEVEL` stays 0 (the default): every user, old app or new, keeps the old screens and
  nobody is blocked. Check `https://api.3.6.48.6.sslip.io/api/v1/feature-flags` lists `"ledger_v2": false`.

## 2. Only AFTER step 1: the app update
- `apps/mobile/scripts/ota-preview.sh "Ledger v2 (Paisa)"` publishes to channel **preview** (the owners' 7/8 Nov APKs).
  It stops if `EXPO_PUBLIC_API_BASE_URL` is not production, or if the production backend has no `ledger_v2` yet (old backend),
  so the new app can never reach phones before its backend.
- A new APK (optional, for new installs): `eas build --profile preview`, then `infra/scripts/publish-apk.sh` (APP-DOWNLOADS.md).

## 3. Check the new app with the flag still OFF
- On a phone with the update (owner + staff accounts): the old screens show (Ledger / Refunds tabs, History, Dues), money
  actions work as before, nothing says "Update karein". Checked locally on 14 Nov (flag OFF, new app: old screens).
- The update is never published against the old backend (step 2's guard).

## 4. Phones have the update -> flag day
- Confirm the update reached the owners' phones (EAS update dashboard: installs on channel preview; or ask each owner to
  open the app twice, the update applies on the next start).
- Fresh RDS snapshot.
- `MIN_STAFF_APP_LEVEL=1` in the backend env, restart: an owner/staff app without the update now gets "Update karein".
- Backfill + check (0 failures), then `ledger_v2` ON right away (same short window; never split them).
- Same day: check again, Paisa -> Kaam and Statement on real venues.

## Rollback
- Screens: `ledger_v2` OFF (old screens return, data stays). Blocking: `MIN_STAFF_APP_LEVEL=0`, restart.
- Code: redeploy the previous image (the new columns do not break old code).
- Data: `alembic downgrade` refuses once app-written adjustments/credit exist; after the backfill the way back is the RDS
  snapshot from step 4 (everything after it is lost). First choice: flag OFF and fix forward.
