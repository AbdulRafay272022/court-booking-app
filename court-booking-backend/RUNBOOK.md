# Operational Runbook

One page, three real incidents. Written 2026-09-19 (Section 24, finding
#24) for a pilot with non-technical venue owners and real money moving —
if you're on call and something's wrong, start here.

Every fix below either goes through `/docs` (Swagger UI, needs an admin
session token) or a direct `psql`/Python one-liner against `DATABASE_URL`.
None of it needs a code deploy.

## 1. A payment is stuck / the API is misbehaving for one booking

**Symptom:** an owner says a payment they approved/rejected didn't take
effect, or a player says their proof was accepted but the booking still
shows `payment_submitted`/`held`.

1. Find the booking and its payment:
   ```sql
   SELECT id, status, court_id, player_id, held_until, payment_deadline
   FROM bookings WHERE id = '<booking_id>';
   SELECT id, review_verdict, ocr_verdict, is_duplicate, created_at
   FROM payments WHERE booking_id = '<booking_id>' ORDER BY created_at DESC;
   ```
2. If a payment has `review_verdict IS NULL` and the booking is genuinely
   stuck (not just a slow request), approve/reject it for real via `/docs`:
   `POST /api/v1/payments/{payment_id}/approve` or `/reject` with an admin
   or the venue's own owner session. These are the same atomically-guarded
   endpoints the app uses — if two requests raced, you'll see a clean
   `PAYMENT_ALREADY_REVIEWED` / `BOOKING_ALREADY_CANCELLED` error telling
   you it already resolved, not silent corruption.
3. **Do not hand-edit `bookings.status`/`payments.review_verdict` directly
   in SQL** except as an absolute last resort — the state machine has
   side effects (player `total_bookings`/`total_rejections`,
   notifications, waitlist wake-ups, `payment_disputes` rows) that a raw
   `UPDATE` skips entirely, silently desyncing the record from reality.
4. If a real payment genuinely has nowhere to go (e.g. the booking's slot
   is now taken by someone else), that's exactly what the refund queue is
   for — check `GET /api/v1/admin/disputes/refund-queue` and handle it as
   a manual refund; there's no automated refund execution.

## 2. The configured AI provider (chat or OCR) is down

**Symptom:** payment-proof uploads are all coming back `ocr_verdict:
unreadable` when they shouldn't be, or `/chat/message` is only returning
the generic "our team will get back to you" fallback for real, well-formed
messages.

1. Check which provider is actually configured:
   ```sql
   -- or just: grep AI_PROVIDER /path/to/.env
   ```
   `AI_PROVIDER` picks the chat-tier provider; `AI_VISION_PROVIDER`
   overrides just the OCR path if set, otherwise it reuses `AI_PROVIDER`
   (`app/config.py`).
2. Check recent AI call outcomes without needing vendor-side dashboard
   access:
   ```sql
   SELECT provider, model, purpose, created_at
   FROM ai_usage_log ORDER BY created_at DESC LIMIT 20;
   ```
   A vision-provider outage degrades gracefully as of Section 23 (finding
   #7) — `httpx.HTTPError` (timeout/network/5xx) routes to the same
   `unreadable`/manual-review path as an unconfigured provider, so
   payment-proof upload itself should **not** be 500ing even during a
   real outage. If it is 500ing, that's a bug, not expected degradation —
   escalate rather than working around it here.
3. **To fail over the vision provider** (e.g. Gemini is down, Claude
   isn't): set `AI_VISION_PROVIDER` in the environment to the working
   provider's name (`claude` / `gemini` / `openai`) and restart the app —
   settings are read at import time. This only needs the corresponding
   `*_API_KEY` to already be configured; it's an env var flip, not a
   deploy.
4. **If the AI chat itself is the problem** (e.g. manipulated into an
   abusive tool-calling loop, or you just need it off while you
   investigate): set `AI_CHAT_ENABLED=false` and restart. Every
   `/chat/message` call immediately degrades to the same free, no-cost
   canned fallback reply — no user-facing error, no further provider
   calls. `GLOBAL_AUTO_APPROVE_ENABLED=false` is the equivalent switch for
   payment auto-approval if OCR quality is the concern specifically
   (forces every payment to manual owner review regardless of any venue's
   own `auto_approve_enabled`). Both are read fresh on every request — no
   caching to worry about. See finding #21.

## 3. A scheduled job run was missed (expiry/no-show/escalation/waitlist)

**Symptom:** stale `held`/`payment_submitted` bookings aren't being
cancelled on schedule, no-shows aren't being marked, or waitlist entries
aren't advancing — usually because the external scheduler (EventBridge ->
Lambda in production; nothing runs this automatically in local dev) missed
a run.

```bash
cd court-booking-backend
.venv/Scripts/python.exe -m scripts.run_expiry_job
```

This calls `app.jobs.expiry_job.run_expiry_job` directly — the exact same
function the scheduler calls. Every step inside it (hold expiry, payment-
review expiry, no-show marking, escalation, waitlist cleanup) is
independently idempotent (see `CLAUDE.md`'s "Architectural conventions"),
so running this late, or twice in a row, is always safe — it will never
double-notify anyone or error on an already-processed booking. Confirm it
worked by checking the printed summary dict (`expired_bookings`,
`no_shows`, `escalations_sent`, `waitlist_entries_deactivated`) — all
zeros on a second immediate run is expected, not a sign it didn't work the
first time.

## Database backup / restore (RDS)

The pilot database is **RDS Postgres 16** (`court-booking-app-db`,
`ap-south-1`, single-AZ, encrypted, private subnets) — this closes
`AUDIT_FINDINGS.md` D.1 ("no managed Postgres provider chosen"). Settings,
as defined in `infra/database.tf` (not hand-edited in the console):

- **Automated backups: on, 1-day retention** (`backup_retention_period`),
  daily window 20:00–21:00 UTC (01:00–02:00 PKT). This also enables
  **point-in-time restore** to any second inside that ~24-hour window.
  **1 day is a Free-plan limit, not a considered choice**: the account is on
  the AWS Free plan, which rejected anything higher when the instance was
  created (`FreeTierRestrictionError`, 2026-09-19). The practical meaning: a
  bad migration, a bug that corrupts rows, or an accidental delete that
  isn't noticed within about a day **cannot be restored from RDS backups**.
  To raise it: upgrade the AWS account plan, set `db_backup_retention_days`
  (7+ recommended before real payments flow) in `infra/variables.tf`, and
  `terraform apply` -- an in-place change, no rebuild. Until then, consider
  a manual `aws rds create-db-snapshot` before any risky migration (manual
  snapshots don't expire and aren't subject to the retention window).
- **Final snapshot on delete** (`skip_final_snapshot = false`) and
  **`deletion_protection = true`**, so a stray `terraform destroy` can't
  silently take the data with it.
- Backups cover the database only. Two things live *outside* it and must be
  protected separately: **`BANK_DETAILS_ENCRYPTION_KEY`** (SSM parameter
  `/court-booking-app/secrets/BANK_DETAILS_ENCRYPTION_KEY` — lose it and every
  stored bank detail is unreadable, even from a perfect restore) and the
  payment-proof bucket (versioned + KMS-encrypted, noncurrent versions
  expire after 90 days; current proofs are never expired).

**Restore** (RDS restores into a *new* instance; it never overwrites in
place):

```bash
aws rds restore-db-instance-to-point-in-time \
  --region ap-south-1 \
  --source-db-instance-identifier court-booking-app-db \
  --target-db-instance-identifier court-booking-app-db-restore-test \
  --restore-time 2026-01-01T10:00:00Z \
  --db-subnet-group-name court-booking-app-db \
  --vpc-security-group-ids <rds-sg id> \
  --no-publicly-accessible
```

then point a scratch `DATABASE_URL` at the new endpoint (from the app
instance — RDS is not reachable from anywhere else) and sanity-check row
counts. Delete the scratch instance afterwards.

- [ ] **Dry-run restore before the pilot starts — NOT YET DONE.** Do one
  point-in-time restore to a scratch instance as above, confirm PostGIS and
  the `one_live_booking_per_slot` index came across, then delete it. A backup
  that has never been restored is unverified.

## Background jobs run from the instance's cron

Section 25 runs the scheduled jobs from the app instance's cron, not
EventBridge/Lambda (a VPC Lambda would need a ~$35/mo NAT to reach WhatsApp).
See `infra/README.md` for the table. Check they're firing with
`tail /var/log/court-booking-jobs.log` on the instance (via SSM Session
Manager — there is no SSH). If cron missed runs, the manual trigger above
still applies.

## 4. Something fails for a real user: read the production logs first

Added 2026-09-21 after three incidents in one day were each diagnosed from the logs, not from the
user's description ("Can't reach the server" turned out to be a 500 from a database constraint).
**A browser "network / server connection error" is often a server 500**: an unhandled 500 carries no
CORS headers, so the browser can't read it and reports a failed fetch. Check the server before the
user's connection.

There is no SSH. Read logs with SSM Run Command (always `--region ap-south-1`; on Git Bash also
`export MSYS_NO_PATHCONV=1`; instance id from `terraform output ec2_instance_id`):

```bash
# ship the script as base64 and run it with bash (SSM's default shell is dash), then read the result
SCRIPT='docker logs --since 60m court-booking-backend 2>&1 | grep -E "Traceback| 500 |whatsapp\.send|Error" | tail -50'
printf '{"commands":["echo %s | base64 -d | bash"]}' "$(printf '%s' "$SCRIPT" | base64 -w0)" > params.json
CID=$(aws ssm send-command --region ap-south-1 --instance-ids <id> --document-name AWS-RunShellScript \
      --parameters file://params.json --query Command.CommandId --output text)
sleep 8; aws ssm get-command-invocation --region ap-south-1 --command-id $CID --instance-id <id> \
      --query '[Status,StandardOutputContent]' --output text
```

- **Logs start at the last deploy**: `docker logs` only covers the current container, and every deploy
  recreates it. Older history is only in the database.
- **Chat content is in the database, not the logs.** The `messages` table holds every WhatsApp and
  in-app turn (`channel`, `sender_type` player|ai, `content`, `metadata` with the assistant's proposed
  `actions`); `ai_usage_log` has one row per model call. Query them from inside the container with
  `docker exec -i court-booking-backend python -` and the app's own `AsyncSessionLocal` (RDS is not
  reachable from anywhere else). Mask phone numbers when printing (`'***'||right(phone,4)`).
- **Failed notifications** are rows in `notification_log` with `status = 'failed'` and an
  `error_message` (Meta error code inside). Until Meta business verification is done and the message
  templates exist, most WhatsApp notifications outside the 24h window fail this way, by design.
- Useful lines: `request.completed ... status=500`, `whatsapp.send.rejected` (Meta's error code),
  `notification.whatsapp_failed`, `ai_chat.tool_error`.
- The permission system in some Claude Code sessions blocks bulk production reads/writes; if it does,
  stop and hand the user the exact command instead of working around it.

## 5. Make someone an admin (or check who can review venues)

A new venue sits in `pending` until an **admin** approves it at `/dashboard/admin/venues` (web only).
Nobody is notified reliably (push is a stub; WhatsApp needs an open window), so the admin must open
that page. There is **no way to create an admin in the app**: signup cannot select `admin` and there
is no admin-management endpoint. The user signs up as a normal player first, then:

```bash
bash infra/scripts/promote_admin.sh +923XXXXXXXXX
```

It runs `infra/scripts/promote_admin.py` in the backend container and refuses unless exactly one
account matches, that account is a `player`, and its phone is verified; it writes an
`audit_log` entry (`user.role_changed`). **An account has one role**: after this it loses the player
screens (app routing is role-gated), so use a separate number for the admin. Going back to player is
the same kind of manual database change. Promoted so far: the project owner's own number (ending 6981),
on 2026-09-20, as the reviewer of the first venue ("Maidan COurt").

## 6. Running a database migration on production (the rules the owner set on 2026-09-22)

Never run a migration on production without the owner's explicit go. Before it:
1. **Read-only preflight** from the instance (SSM Run Command, `docker exec ... python -` with SELECTs only): current revision,
   and whatever the migration will assert (Part 4: no booking with a bad `ends_at`, no overlapping live bookings).
2. **The owner takes a manual RDS snapshot** (automated backups are only 1 day and a restore has never been rehearsed). Wait for
   it to show `available`.
3. The migration was tested **up, down and up again** on a scratch database seeded with production-shaped data, and its refusal
   cases were exercised. `alembic check` is clean.
Order on deploy: build and push the images, run the migration **from the NEW image before the new backend serves traffic** (the code
must never run against a missing column), then restart. Read the migration output and report it; `alembic current` must show the new
head. To undo: `alembic downgrade <previous revision>` from the same image (the Part 4 downgrade copies each venue's current
cancellation policy back onto its courts), then redeploy the previous image. A snapshot restore is the last resort.

## Not yet covered here

- **Rotating the WhatsApp/AI vendor credentials themselves** (as opposed
  to failing over which provider is active) — infra-specific, not
  documented here.
