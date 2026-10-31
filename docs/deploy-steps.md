# Deploy steps: audit build (branch `feat/audit-build`)

Written 2026-10-28 for the founder. **Nothing here has been run against production.** The branch was never pushed.
Read the whole page once before starting. Every step says what to check before the next one.

## 0. What is going out

- Branch `feat/audit-build`, cut from `main` at `b708a20`.
- **2 migrations**, both additive. Both commits carry `Migration-Go: owner-approved` (pre-approved in the RUN MODE brief).
  - `f7c3a9d2b415` (Phase 2):
    - `owner_identity`: `cnic_status`, `rejection_reason`, `reviewed_by`, `reviewed_at`
    - `bookings.whatsapp_opt_in`
    - `payment_disputes.payment_id` becomes nullable, plus `payment_disputes.player_note`
  - `a9d4e7b2c813` (Phase 3):
    - new tables `point_entries`, `short_payment_claims`, `noshow_replies`, `arrival_checks`
    - `venues.points_discount_enabled` and `venues.points_discount_pkr`
    - `bookings.points_discount_pkr`
- Both migrations were tested up, check, down and up again on a scratch DB (`cb_mig_scratch`).
  - Each downgrade **refuses and changes nothing** while rows exist that it would lose.
- **Every new behaviour is behind a feature flag that defaults to OFF.** Merging and deploying changes nothing for players until a flag is switched on. The flags are listed in section 4.
- **New cron line** in `infra/scripts/court-booking.cron`: `short-payments`, every 10 minutes. The on-box cron file is a copy, so add the line there by hand (section 3, step 6).

## 1. Before you push

1. Ask a teammate to review the diff: `git log --oneline b708a20..feat/audit-build` (41 commits).
2. Run the checks locally (the final report lists the results from this session):
   - backend:
     ```
     cd court-booking-backend
     AI_PROVIDER=claude AI_VISION_PROVIDER=claude .venv/Scripts/python.exe -m pytest -q
     ```
   - frontend:
     ```
     cd court-booking-frontend
     npx tsc --noEmit -p apps/web && npx tsc --noEmit -p apps/mobile
     cd apps/web && npx next build
     ```
3. **Take a manual RDS snapshot.** Backups are kept for only 1 day.
   - AWS console > RDS > the `court-booking` instance > Actions > Take snapshot. Name it `pre-audit-build-YYYYMMDD-HHMM`.
   - Or with the CLI:
     ```
     MSYS_NO_PATHCONV=1 aws rds create-db-snapshot --region ap-south-1 \
       --db-instance-identifier <instance id> --db-snapshot-identifier pre-audit-build-YYYYMMDD-HHMM
     ```
   - Wait until the snapshot status is **available** before going on.
4. Run the CNIC-gate check (section 5). It is read-only. It tells you which live venues WOULD be hidden if you ever switch `cnic_visibility_gate` on. Deploying does not switch it on.

## 2. Push (you do this, the agent never pushes)

```
git checkout main
git merge --no-ff feat/audit-build
git push origin main
```

The push deploys automatically through GitHub Actions:

1. `migration-guard` passes, because the commits contain `Migration-Go: owner-approved`.
2. The new images are built.
3. `remote-deploy.sh` runs `alembic upgrade head` from the NEW image before the new backend starts. If a migration refuses, the deploy stops and the old containers keep running.

## 3. After the deploy (check each)

1. Actions run is green.
2. `https://api.3.6.48.6.sslip.io/health` returns 200, and `uptime_seconds` has reset.
3. The migration output in the Actions log shows:
   - `Running upgrade e5b8c2d4f6a1 -> f7c3a9d2b415`
   - `Running upgrade f7c3a9d2b415 -> a9d4e7b2c813`
   - `alembic check` reports no new upgrade operations.
4. Read-only spot checks, run through SSM `docker exec court-booking-backend python -c ...` or psql:
   - `SELECT version_num FROM alembic_version;` returns `a9d4e7b2c813`.
   - `SELECT cnic_status, count(*) FROM owner_identity GROUP BY 1;` shows that verified owners became `approved`.
   - `SELECT count(*) FROM point_entries;` returns 0.
5. Open the web app as a player and as an owner. Nothing should look different, because every flag is OFF.
6. **Cron on the box** (Session Manager):
   - `sudo nano /etc/cron.d/court-booking`
   - add the line from `infra/scripts/court-booking.cron` that starts with `*/10 * * * *   root flock -n /var/lock/cb-short.lock`
   - save the file
   - one hour later, `grep short-payments /var/log/court-booking-jobs.log` should show runs ending in `jobs.runner.completed`.

**Rollback:**
- If the app is broken, revert the merge commit and push. The migrations stay; they are additive and harmless to the old code.
- If the data itself is wrong, restore the snapshot from step 1.3.

## 3b. Live on push WITHOUT a flag (fixes of 2026-10-31)

- **"Haan" / "Nahi" on a no-show booking is refused** (`NOSHOW_REVERSAL_REQUIRED`). It used to record the whole price as cash. Owners now see
  "No-show hatayein": final price, amount received now, Cash / Transfer. A transfer needs its screenshot, which waits in Approvals and is
  credited only when approved. Web is live at once; the app sheet needs the new EAS build. The OLD app build shows the server's message
  when Haan is pressed on a no-show (nothing is recorded): "No-show hatane ke liye web dashboard istemal karein (naya app update jald)".
- **Approving a balance / no-show-reversal screenshot** sends the player the receipt ("PKR N mil gaye, kul ada ..., baqi ...", push +
  in-app; WhatsApp only with `whatsapp_templates`) instead of "Booking confirmed", plus "+50 / +10 points mile, kul X" when points are
  given. Advance approvals are unchanged.
- **"Bank se mila lein" has a "Bank mein nahi mila" button** (owner only) on balance transfers. Marking one takes the money out (a
  reversing ledger entry), and "Staff ka kaam" shows it in red under the staff member who approved it until the owner picks "Staff se
  wasool karein" (player keeps the points, no message) or "Player se baqi maangein" (the transfer's points are taken back and the
  short-payment message says so). Web live at once; the app screens need the new EAS build.
- **Rejecting a balance screenshot** starts the short-payment flow only while `short_payment_reply` / `player_dues` are on; with them off
  the player gets the old "payment rejected" message, as today.
- **Every "kitna mila" box** reads "Pehle Rs X mil chuke. Abhi kitna mila? (baqi Rs Y)" and will not take more than Y (web now, app with
  the EAS build).
- Dues "Done" asks Cash / Transfer (behind the dues flags, so nobody sees it until they are on). The old app build's "Done" is cash, as before.

## 4. Feature flags (all OFF; switch on one at a time in Admin > Feature flags)

| Flag | What it switches on | Before switching it on |
|---|---|---|
| `iban_qr` | Raast QR with the amount on the pay screens | Device test D7 (Meezan, HBL, Easypaisa, JazzCash all accept it). The QR identifier is an assumption: decision #10 |
| `cnic_visibility_gate` | Players no longer see venues whose owner CNIC is not approved | Section 5: approve the CNIC of every live owner first, or their venue disappears |
| `whatsapp_templates` | WhatsApp copies of the notices (khelo_* templates) | Section 6: every template approved by Meta. Turning it on before then just produces failed sends |
| `balance_proof` | Player can send a screenshot for the balance; owner approves it | none (web + app). App part needs the new EAS build |
| `player_points` | Points: 50 per booking paid fully by transfer, venue-funded discount | Tell owners about the discount switch in Venue Settings (it stays off per venue until the owner turns it on) |
| `short_payment_reply` | "Total X, diye Y, baqi Z: Sahi hai / Ghalat hai". -20 at 24 h without a reply; a reply is still taken later, +5 only within 4 days of the notice | The cron line from 3.6 must be on the box, or the 24 h penalty never runs |
| `player_dues` | Dues on the next approval card, "No-show X / kul bookings Y" | none |
| `noshow_reply` | "Main aaya tha" and "Pohanch gaya" (GPS); taking back the no-show goes through the price / received / method dialog | Device tests D10 and D11 |

The safest order: `balance_proof`, then `player_dues`, then `short_payment_reply`, then `player_points`, then `noshow_reply`. After that `iban_qr` (after D7), `whatsapp_templates` (after Meta) and last `cnic_visibility_gate`.

## 5. CNIC gate: which live venues it would hide (read-only)

Run on production before ever switching `cnic_visibility_gate` on:

```sql
SELECT v.name, u.phone, COALESCE(o.cnic_status, 'missing') AS cnic
FROM venues v
JOIN users u ON u.id = v.owner_id
LEFT JOIN owner_identity o ON o.user_id = v.owner_id
WHERE v.status = 'approved' AND v.is_active
  AND COALESCE(o.cnic_status, 'missing') <> 'approved';
```

- The query could not be run from this session, because production access is not allowed here. Expect it to list the live public venues known on 2026-10-28, **KHA Legends Arena** and **Court Site**, unless their owners' CNIC is already approved.
- Note that `cnic_status` only exists after migration `f7c3a9d2b415`. Before the deploy, use this instead:
  ```sql
  ... COALESCE(CASE WHEN o.verified_at IS NOT NULL THEN 'approved' END, 'missing') ...
  ```

## 5b. The two live venues and the new 404 rule (read-only)

The Phase 1 rule (`app/services/venue_visibility.py`): a venue is public only when `status = 'approved'` AND `is_active`. Anything else is a
404 for players. On 2026-10-28 the public `GET /api/v1/venues` (which already used exactly that filter on `main`) listed KHA Legends Arena and
Court Site, so both were approved and active that day. They are not in the local dev DB, and production was not queried from here. Run this
read-only check on production before pushing:

```sql
SELECT v.name, v.slug, v.status, v.is_active,
       (SELECT count(*) FROM courts c WHERE c.venue_id = v.id AND c.is_active) AS active_courts,
       v.updated_at
FROM venues v
WHERE v.name ILIKE '%KHA Legends%' OR v.name ILIKE '%Court Site%';
```

Expected: both rows `status = approved`, `is_active = t`, at least one active court. If either is not, its public page becomes a 404 after the
push (the owner still sees it in the dashboard).

## 6. Meta WhatsApp templates (BLOCKED on Meta business verification)

Submit each template in WhatsApp Manager under the exact name, language `en`, with the category and the body below. The text is in `app/services/whatsapp_templates.py`; `{{1}}`, `{{2}}` and so on are the params in order.

| Name | Category | Params | Quick-reply buttons |
|---|---|---|---|
| khelo_advance_payment | Utility | venue, court + time, advance, account | none |
| khelo_balance_payment | Utility | booking ID, balance, account | none |
| khelo_payment_receipt | Utility | booking ID, received, total paid, balance | none |
| khelo_short_payment | Utility | booking ID, total, paid, due | **2 buttons: "Sahi hai", "Ghalat hai"** (type Quick reply) |
| khelo_points_deducted | Utility | booking ID, points, reason | none |
| khelo_due_resolved | Utility | booking ID, amount | none |
| khelo_no_show | Utility | booking ID, court + time, total, paid, due | **1 button: "Main aaya tha"** (Quick reply) |
| khelo_walkin_welcome | **Marketing** | venue | none |
| khelo_points_reward | Utility | points, booking ID, balance | none |
| khelo_booking_reminder | Utility | court, time, "Khelo" | none |

- The app sends each quick-reply button's payload itself:
  - `short:<claim id>:yes` or `short:<claim id>:no`
  - `noshow:<booking id>`
- The webhook handles those payloads. Inside the 24 h window the same buttons go out as interactive reply buttons.
- Next step: finish Meta business verification. Then submit the templates. When all of them are approved, switch on `whatsapp_templates`.

## 7. Mobile: preview build with Firebase (Phase 4, BLOCKED on the Firebase file)

**Why it is blocked:**
- `apps/mobile/google-services.json` only has an Android client for the old package `com.maidan.app`. The Firebase project `maidan-31556` belongs to a team member.
- The app is now `com.aftrsolutions.khelo`.
- `apps/mobile/app.config.js` (commit `567b80d`) removes the Firebase file for **development** builds only. preview and production builds still need a real file and fail at the Gradle google-services step until it exists.

**Steps once you have access to Firebase:**

1. Firebase console > project `maidan-31556` (or a new Khelo project):
   - Project settings > Your apps > **Add app** > Android
   - package name **`com.aftrsolutions.khelo`**
   - download the new `google-services.json`
   - if it is a NEW project, also create a service account key: Project settings > Service accounts > Generate new private key. The key is used in step 7, which you do yourself; the agent never creates or prints keys.
2. Replace `court-booking-frontend/apps/mobile/google-services.json` with the downloaded file.
   - It is public config and must be committed; EAS only uploads tracked files.
   - Check that it contains `"package_name": "com.aftrsolutions.khelo"`.
3. Undo the dev-only workaround. Either:
   - `git revert 567b80d` (removes `app.config.js` and its note in `docs/open-decisions.md`), or
   - delete the file by hand: `git rm court-booking-frontend/apps/mobile/app.config.js`.
4. Commit both changes: `git commit -m "Firebase for com.aftrsolutions.khelo; remove the dev-only app.config.js"`.
5. Check that the root `.easignore` exists (it does on this branch).
   - **Never build without it.** On Windows, eas-cli 25.x only reads the root `.gitignore` and once uploaded the backend `.env`.
6. Build:
   ```
   cd court-booking-frontend/apps/mobile
   npx eas-cli@latest build --profile preview --platform android
   ```
   - The profile is in `eas.json` (internal APK).
   - Log in with `npx eas-cli login`. Non-interactive: `eas login --device --non-interactive`.
7. If you made a new Firebase project:
   - put its service account JSON (base64) in SSM `/court-booking-app/secrets/FCM_SERVICE_ACCOUNT_KEY`
   - run `bootstrap.sh env`
   - recreate the backend container (backend CLAUDE.md item 14)
   - Do this yourself; the agent never touches keys.
8. Install the APK on a cheap Android phone and run `docs/device-test-checklist.md` (D1 to D16).

**Everything app-side from this branch needs this new build:**
- Phase 1: items 4, 5, 6, 16, 19 and 20
- Phase 2: item 4 (the admin screens)
- Phase 3: every app screen

Over-the-air updates cannot carry it, because this branch is the first build of the new package.
