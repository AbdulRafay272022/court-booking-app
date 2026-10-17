# Web Push plan (Step 1: design only; nothing here is built, no migration exists)

Goal: a browser notification that arrives even when the Khelo tab is closed (owner: new payment screenshot, refund owed; player: booking confirmed/cancelled), on Chrome/Edge/Firefox desktop and Android Chrome, and on iPhone only when Khelo is installed to the Home Screen.

## 1. Pieces and where they live
| Piece | File / place |
|---|---|
| Service worker | `court-booking-frontend/apps/web/public/sw.js` (scope `/`) |
| Web app manifest (needed for iOS install) | `apps/web/app/manifest.ts` (name Khelo, icons from `public/brand`, `display: standalone`, `start_url: /`) |
| Subscribe/permission logic + UI | `apps/web/lib/web-push.ts`, button inside the existing bell dropdown (`components/site/notification-bell.tsx`) |
| Subscribe/unsubscribe API | `court-booking-backend/app/api/web_push.py` (router under `/users/me/web-push`) |
| Model + migration | `app/models/web_push_subscription.py`, `alembic/versions/<new>_web_push_subscriptions.py` (down_revision = current head `c4f1a9e2d7b3`) |
| Sender | `app/services/web_push.py` (httpx + `cryptography`, same style as `fcm.py`; no pywebpush) |
| Hook | `NotificationService._send_push_tier` (beside the FCM/APNs loop) |
| Cleanup | `app/jobs/web_push_cleanup.py`, runner name `webpush-clean` (one new cron line, added by hand on the box like the billing line) |

## 2. VAPID keys
- Generate ONE P-256 key pair once, offline, with a small script (`scripts/make-vapid-keys.py`, uses `cryptography`; prints only to the owner's terminal, never to logs or the repo).
- Private key: SSM SecureString `/court-booking-app/secrets/WEB_PUSH_VAPID_PRIVATE_KEY` (base64url of the 32-byte scalar). Public key (not secret): SSM `/court-booking-app/secrets/WEB_PUSH_VAPID_PUBLIC_KEY`. Subject: `WEB_PUSH_VAPID_SUBJECT=mailto:<support email>`.
- Backend settings in `config.py`: `WEB_PUSH_VAPID_PRIVATE_KEY`, `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_SUBJECT`, all blank by default = feature off (same convention as `FCM_SERVICE_ACCOUNT_KEY`). `.env.example` gets blank placeholders. `bootstrap.sh env` renders them; the on-box `bootstrap.sh` is a first-boot copy, so the three lines are added there by hand, then `--force-recreate backend` (CLAUDE.md gotcha 14).
- The browser needs the PUBLIC key. Instead of `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (inlined at build time, forces a web image rebuild and a Dockerfile/deploy.yml ARG), the web app asks the backend at runtime: `GET /users/me/web-push/config`. Recommended: no web rebuild when keys rotate, no build arg.
- Changing the key pair invalidates every existing subscription (they were made for the old public key): treat it as a reset and let users re-enable.

## 3. Table `web_push_subscriptions` (exact schema)
| column | type | null | notes |
|---|---|---|---|
| id | uuid | no | pk, default gen_random_uuid() (`UUIDPkMixin`) |
| user_id | uuid | no | FK `users.id` ON DELETE CASCADE |
| endpoint | text | no | the push service URL; UNIQUE |
| p256dh | varchar(255) | no | client public key, base64url |
| auth | varchar(255) | no | client auth secret, base64url |
| user_agent | varchar(500) | yes | for the device list, never used for decisions |
| created_at | timestamptz | no | default now() |
| last_seen_at | timestamptz | yes | set on subscribe/refresh and on each successful delivery |
| revoked_at | timestamptz | yes | set when the user unsubscribes or the push service says 404/410; null = active |

Indexes/constraints: `uq_web_push_endpoint` UNIQUE (endpoint); partial `idx_web_push_user_active` on (user_id) WHERE revoked_at IS NULL (the sender's only query); `idx_web_push_revoked` on (revoked_at) WHERE revoked_at IS NOT NULL (cleanup). Same endpoint re-subscribing under another user (shared browser) re-assigns the row (as `fcm_tokens` does) and clears `revoked_at`. Max 10 active subscriptions per user (oldest revoked first). Additive only: no existing table or column is touched; downgrade drops this one table (loses subscriptions only; users re-enable).

## 4. API (all need a signed-in user; none changes an existing endpoint)
- `GET /users/me/web-push/config` -> `{enabled: bool, public_key: str|null}` (`enabled` = keys configured AND feature flag `push_notifications` on).
- `POST /users/me/web-push` body `{endpoint, keys:{p256dh, auth}, user_agent?}` -> 201, upsert by endpoint. Validation: endpoint must be `https` and its host must be in an allow-list of the real push services (`fcm.googleapis.com`, `*.push.services.mozilla.com`, `*.push.apple.com`, `*.notify.windows.com`). This matters: the SERVER later POSTs to that URL, so an open field would be a request-forgery hole.
- `DELETE /users/me/web-push` body `{endpoint}` -> 204 (sets `revoked_at`, only for the caller's own row; unknown = 204 so the UI can always clear a stale state).
- Optional `GET /users/me/web-push?endpoint=` -> `{subscribed: bool}` so the button shows the true state of THIS device.

## 5. Backend sender (`app/services/web_push.py`)
- RFC 8291 `aes128gcm` payload encryption (ECDH P-256 with `p256dh`, HKDF-SHA256 with `auth`, 16-byte salt, record size 4096) and RFC 8292 VAPID: ES256 JWT (`aud` = the endpoint's origin, `exp` <= 12 h, `sub` = subject) sent as `Authorization: vapid t=<jwt>, k=<public key>`. Headers: `Content-Encoding: aes128gcm`, `TTL: 3600`, `Urgency: high` for payment_submitted / refund_owed (normal otherwise), `Topic` = short hash of event_type + reference_id so a repeat replaces instead of stacking.
- Payload JSON (<= ~2 KB, limit 3993 bytes): `{title, body, url, tag, event_type}`. No phone numbers, no names beyond what the FCM push already carries. `url` comes from a server-side map event_type -> page (payment_submitted -> `/dashboard/owner/approvals`, refund_owed -> `/dashboard/owner/refunds`, booking_confirmed/cancelled -> `/bookings`, venue_* -> `/dashboard/owner/today`), the same map the web bell uses.
- Outcome classification, never raises (best-effort like FCM): 201 -> SENT; 404 / 410 -> UNREGISTERED (set `revoked_at = now()`); 400/401/403 -> FAILED + error log (VAPID/payload bug, no retry); 413 -> FAILED (payload too large); 429 / 5xx / timeout -> FAILED after ONE retry (honouring `Retry-After` up to 5 s). Missing keys -> SKIPPED. Timeouts short (5 s).
- Hook: `_send_push_tier` (already gated by the admin `push_notifications` flag) loops the user's active subscriptions after the FCM/APNs tokens. A user with no subscription is a no-op.

## 6. `notification_log`
One row per attempt: `channel = 'web_push'` (8 chars, fits varchar(20)), same `event_type`/`reference_id`, `status = sent | failed`, `error_message` such as `web_push gone (410)`, `web_push failed (503)`. This uses the corrected push logging already merged on this branch (a row says what really happened). No schema change for it.

## 7. Expired / dead subscription cleanup
- Immediate: 404/410 from the push service sets `revoked_at` (the next send skips it).
- Nightly job `python -m app.jobs.runner webpush-clean` (idempotent): delete rows revoked more than 30 days ago; revoke rows never confirmed or delivered for 90 days (`last_seen_at` older than 90 days, or null and `created_at` older than 90 days). One cron line in `infra/scripts/court-booking.cron` plus a hand edit of the on-box copy. Deleting a user cascades.
- The page re-sends the subscription on load while permission is granted (updates `last_seen_at` and survives browser-side rotation); the service worker handles `pushsubscriptionchange` by re-subscribing and POSTing.

## 8. Permission button and UI (web, `notif.*` copy in Roman Urdu + English, owner "karein", player "karo")
Lives in the bell dropdown, next to the existing tab-open popup opt-in; NEVER asks on page load; always an explicit tap.
States: unsupported browser (no button); iPhone/iPad Safari not installed (hint "Home Screen par add karo, phir yahan on karo", needs the manifest); not asked (button "Notifications on karein"); granted but not subscribed on this device (same button, no prompt); subscribed on this device ("Is device par on hai" + "Band karein"); denied (text explaining how to re-enable in browser settings); backend `enabled=false` (button hidden). Enabling = `Notification.requestPermission()` -> register `/sw.js` -> `pushManager.subscribe({userVisibleOnly: true, applicationServerKey})` -> POST. Disabling = `subscription.unsubscribe()` + DELETE. Per-user choice stored locally as today. The tab-open `new Notification()` popup stays as the fallback when Web Push is off or unsupported, and is suppressed when a push subscription is active on this device (otherwise the user would get both).
`sw.js` is served with `Cache-Control: no-cache` (next.config `headers()`), `Service-Worker-Allowed: /`, HTTPS only (sslip.io is fine). It has `push` (show notification with `tag`, `data.url`, icon/badge from `/brand`), `notificationclick` (focus an open Khelo tab and navigate, else open the url), `pushsubscriptionchange`.

## 9. Tests to write in Step 2
Backend: subscribe creates / upserts / re-assigns user; endpoint host allow-list (http, bad host, IP literal rejected); per-user limit; unsubscribe own vs other's; `config` reflects keys + flag; sender with mocked httpx (201 sent, 410 -> revoked, 404, 429 retry then failed, 5xx, 413, no keys = skipped); encryption verified against the RFC 8291 published test vector and a decrypt round-trip; `_send_push_tier` writes `web_push` rows with correct status and does not break the FCM path; cleanup job (30-day revoked delete, 90-day stale revoke, idempotent); migration up/down/up on a scratch Postgres with data + `alembic check`. Web: unit tests for the key/base64url helpers and the state machine; Playwright with stubbed `serviceWorker` / `PushManager` / `Notification` for every UI state, including that nothing asks on load.

## 10. Risks and caveats
- iPhone: only after "Add to Home Screen" (iOS 16.4+), so a manifest and an install hint are part of the work; plain Safari tabs cannot receive web push.
- Android Chrome cannot show `new Notification()` from a page, so Web Push is the only route there.
- Push services can drop or delay messages; this is best-effort like FCM, never a substitute for the in-app list or WhatsApp.
- Browsers/profiles each have their own subscription; a user with 3 browsers has 3 rows.
- Rotating the VAPID key kills all subscriptions.
- The mobile app is unaffected (it keeps FCM/APNs).

## 11. Step 2 checklist (only after the owner writes "Migration-Go")
1. RDS manual snapshot. DB instance (read-only lookup): `court-booking-app-db` (postgres 16.13, status available, automated backups 1 day). Snapshot name format `khelo-pre-webpush-YYYYMMDD-HHMM` (UTC date/time at creation). Create it, wait until `available`; if AWS permission is missing or it fails, STOP and tell the owner; no migration.
2. Only then: create the migration (additive, with downgrade), prove upgrade + downgrade + upgrade on a local/test DB with `alembic check`.
3. Build the code and tests (section 9), merge to local `main`, do not push.
4. Report: snapshot name, migration revision id, post-deploy checks.
5. After the owner pushes and the deploy succeeds, the migration runs as part of the deploy script only with the commit line `Migration-Go: owner-approved`; nothing runs on production unless the owner says so. Post-deploy checks: `alembic current` = new head; `GET /users/me/web-push/config` returns enabled true only after the SSM keys are set and the backend recreated; `https://<web>/sw.js` returns 200 with `Cache-Control: no-cache` and a JavaScript content type; subscribe from the owner's own browser, trigger a test event, see a `web_push` row `sent` in `notification_log`; 0 backend errors.
