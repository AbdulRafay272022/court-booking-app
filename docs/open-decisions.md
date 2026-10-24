# Open decisions after Floodlight (2026-10-25)

Har item ek line: **kya hai** / **backend ya migration?** / **recommendation**.
"Abhi" = agla kaam, launch se pehle. "Baad mein" = launch ke baad, jab zaroorat dikhe.
Source: `docs/floodlight-contract.md` (B1-B8 table) aur `docs/floodlight-progress.md`.

| # | Kya hai | Backend / migration | Recommendation |
|---|---|---|---|
| B1 | Chat inbox: har venue/booking ki alag conversation list, unread dot, owner↔player messages. Abhi sirf ek "assistant" row hai. | Backend: naya endpoint + logic. Migration: shayad (unread state ke liye column/table). | **Baad mein.** Bara kaam hai aur abhi owner↔player chat ka koi feature hi nahi. Pehla chhota qadam (sirf read-only): chat history mein `venue_id`/`booking_id` add karna. |
| B2 | Check-in ka chhota code (6 characters) jo owner haath se type kar sake. Abhi poora booking UUID ya QR chahiye. | Backend: naya lookup endpoint + uniqueness rule. Migration: haan (code column + unique index). | **Abhi**, agar owners camera ke baghair check-in karte hain; warna baad mein. Front desk pe ye roz ka kaam hai, aur UUID type karna mumkin nahi. |
| B3 | Growth heatmap: poora hafte ka grid + discount amount. Abhi API sirf kam-booked cells aur ek text suggestion deti hai. | Backend: `/owners/growth` ka response barhana. Migration: nahi (data bookings se nikal sakta hai). Discount lagana ho to pricing rule, yani migration. | **Baad mein.** Ye premium/growth feature hai, core booking ke liye zaroori nahi. |
| B4 | Photo thumbnails (~720 px) taake venue cards jaldi load hon. Abhi har card full-size photo load karta hai. | Infra: upload pe resize ya CDN image transform. Migration: nahi. | **Abhi** (sasta aur foran farq). Mobile data pe list bohat bhari hai. CloudFront ka resize sab se kam code wala raasta hai. |
| B5 | Pehle se bane hold ki bank details dobara fetch karna. Abhi ye sirf `POST /bookings/hold` ke response mein aati hain (app inhein save rakhta hai). | Backend: hold/booking detail mein bank details dena (read-only). Migration: nahi. | **Baad mein.** Client mein save karne se kaam chal raha hai; masla sirf tab hai jab app reinstall/doosre phone se khule. |
| B6 | Hold se pehle player ko dikhana ke hold kitne minute ka hoga (`hold_minutes`). | Backend: `VenuePublicOut` mein ek field (read-only). Migration: nahi. | **Abhi.** Sab se chhota kaam (ek field) hai aur player ka bharosa barhata hai. |
| B7 | Notifications ka read/unread server pe. Abhi sirf phone pe yaad rehta hai, is liye doosre device pe sab "unread" dikhta hai. | Backend: read state endpoint. Migration: haan (`read_at` column). | **Baad mein.** Zyada log ek hi phone use karte hain. |
| B8 | Bulk approve: kai payments ek saath approve karna. Abhi app ek ek call karta hai. | Backend: batch endpoint. Migration: nahi. | **Baad mein.** Ek ek call wahi rules follow karti hain aur theek chal rahi hai; jab kisi venue ki roz 20+ approvals hon tab banana. |
| W | Walk-in booking pe payment method (cash / JazzCash / bank) save karna. Abhi koi field nahi, is liye UI mein bhi nahi rakha. | Backend: field + schema. Migration: **haan** (bookings pe naya column). | **Abhi**, agar owners walk-in ka hisaab app se rakhna chahte hain (Paisa/report ke liye zaroori). Migration ke liye aap ki "go" + RDS snapshot chahiye. |
| MAP | Venue ka map ("Naqsha") aur owner ke liye "Pin khud lagao". Abhi map nahi dikhta, sirf address + "Directions" link hai. | Backend: nahi (`latitude`/`longitude` pehle se hain). Native: `react-native-maps` + Google Maps API key, yani **naya EAS build** (OTA update se nahi aa sakta). | **Baad mein**, lekin agle native build ke sath. Agar EAS build abhi hona hai to ye module usi mein daal dena behtar hai, taake doosra build na karna pare. |
| NAME | **DONE: Khelo, com.aftrsolutions.khelo** (2026-10-25, branch `rename-khelo`). slug `khelo`, schemes `khelo://` + purana `maidan://`. EAS project ab **`@abdulrafay879/khelo`** hai, `abdulrafay879` account pe (projectId `e166063a-198d-4bf8-9e12-299a98cd8b18`); purana `maidan-app` project use nahi hota. Details: `docs/rename-khelo.md`. | Backend: sirf `APNS_BUNDLE_ID` ki default value. Migration: nahi. | Baqi kaam: Firebase mein `com.aftrsolutions.khelo` ki Android app add karke nayi `google-services.json` lani hai (iske baghair Android build fail hoga). `maidan.*` storage keys jaan boojh kar nahi badlin. |

## ⚠️ Push notifications blocked

"Push notifications blocked: Firebase project maidan-31556 ka access team member ke paas hai. com.aftrsolutions.khelo Android app add karwani hai + mujhe Owner access. Store release se pehle zaroori."

- Abhi ke liye (2026-10-25): `apps/mobile/app.config.js` **sirf development build** (`APP_VARIANT=development`) se `googleServicesFile` hata deta hai. Is liye dev build mein push nahi aayega; app crash nahi karti, kyunke token ka error pakda jata hai.
- **Preview aur production** builds abhi bhi `google-services.json` use karti hain. Is file mein `com.aftrsolutions.khelo` nahi hai, is liye **nayi file aane tak preview/production Android build fail hogi**.
- File aane par: nayi `google-services.json` `apps/mobile/` mein rakhein aur `app.config.js` delete karein (ya us commit ko `git revert` karein). Phir naya build banayein.

## ⚠️ EAS upload incident (2026-10-25): `.env` files Expo pe chali gayi thin

- **Kya hua:** pehle development build (`ac91d899`) ka upload 476 MB tha. eas-cli 25.3.0 Windows pe sirf root `.gitignore` pe amal karta hai (nested `.gitignore` ke rules match hi nahi hote), is liye ye files bhi chali gayin: `court-booking-backend/.env`, `court-booking-frontend/apps/web/.env.local`, backend `.venv`, web `.next`, aur `Claude outputs/`, `design/desgin/`, `scripts/`. `infra/terraform.tfstate` **nahi** gayi (root `.gitignore` ne roki).
- **Kya kiya:** build cancel aur delete kiya (`eas build:list` → 0 builds). Project `@abdulrafay879/khelo` aaj hi bana tha, is liye is pe koi aur purana build nahi. Purane `maidan-app` project pe kabhi build hua ho to wo is account se dikhta nahi (access nahi), aur wo is machine ke aaj ke kaam se nahi bana. CLI se ye confirm nahi ho sakta ke delete ke baad Expo ne archive ki storage copy bhi foran mita di; dashboard pe build ab nazar nahi aata.
- **Fix:** repo root pe `.easignore` (commit `9b4e461`). Upload ab 1.4 MB hai: sirf frontend workspace. eas-cli ki apni ignore class se dry-run kiya: disk ki saari `.env*`, `tfstate`, aur key/keystore/p8/p12/pem/adminsdk paths BLOCKED, sirf `.env.example` jati hai.
- **Rotation (founder khud karega; agent ne koi key na banayi, na mitayi, na print ki):**

| File | Variable | Secret? | Rotate? |
|---|---|---|---|
| backend `.env` | `GEMINI_API_KEY` (set) | **Haan**: asli, billed key | **Haan, foran** (Google AI Studio / Cloud console) |
| backend `.env` | `SESSION_TOKEN_SECRET` (set) | Haan | Sirf agar production mein bhi yahi value hai; warna local ke liye naya bana lein |
| backend `.env` | `WHATSAPP_WEBHOOK_VERIFY_TOKEN` (set) | Haan (kam asar) | Agar production webhook mein yahi value hai to haan; warna nahi |
| backend `.env` | `DATABASE_URL` (set) | Password andar hai, lekin sirf local docker Postgres (`localhost:5433`) | Nahi (local) |
| backend `.env` | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (set) | Nahi: localstack dummy (AWS format nahi) | Nahi |
| backend `.env` | `DEV_FIXED_OTP` (set) | Local dev setting | Nahi (production mein ye set nahi hona chahiye; wahan check kar lein) |
| backend `.env` | `WHATSAPP_API_TOKEN`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `FCM_SERVICE_ACCOUNT_KEY`, `SENTRY_DSN`, `S3_KMS_KEY_ID`, `CLOUDFRONT_DOMAIN` | Khaali thin, kuch nahi gaya | Nahi |
| backend `.env` | `APP_NAME`, `DEBUG`, `API_V1_PREFIX`, `ALLOWED_ORIGINS`, `SESSION_TOKEN_EXPIRE_DAYS`, `OTP_EXPIRE_MINUTES`, `OTP_MAX_ATTEMPTS`, `OTP_RATE_LIMIT_WINDOW_MINUTES`, `AWS_REGION`, `AWS_ENDPOINT_URL`, `S3_BUCKET_PUBLIC`, `S3_BUCKET_PRIVATE`, `WHATSAPP_API_URL`, `AI_PROVIDER`, `AI_VISION_PROVIDER`, `CLAUDE_HAIKU_MODEL`, `CLAUDE_SONNET_MODEL`, `GEMINI_FLASH_MODEL`, `GEMINI_PRO_MODEL`, `OPENAI_MINI_MODEL`, `OPENAI_FULL_MODEL` | Nahi (settings / naam / URLs) | Nahi |
| web `.env.local` | `NEXT_PUBLIC_API_BASE_URL` (set) | Nahi (public URL) | Nahi |

## Notifications phase 0 (commit 9fb5bd7, archived, NOT merged)

Commit 2026-10-02, base `e0da708`. Ab ye local tag **`archive/notifications-phase-0`** aur local branch `notifications-phase-0` mein hai. Push nahi kiya, merge nahi kiya, aur worktree hata diya gaya.
Commit ka maqsad: push/SMS ka asal nateeja log karna (sent/failed/skipped, `no_token`), har push mein `reference_id`, player cancel kare to owner ko push, mobile pe push registration ke errors na chhupana, launch/foreground pe dobara register karna, "Notifications off" hint, aur poora deep-link table.
Base ke baad main mein in 12 files mein +2156/−791 lines badal chuki hain, is liye commit seedha apply nahi hota.

| File | Main mein pehle se? | Missing |
|---|---|---|
| backend `app/api/bookings.py` | Zyada tar haan: `reference_id` aur owner refund-owed notice (f0b7b0b) | 4 lines: player-cancel pe owner ko push |
| backend `app/api/owners.py` | Nahi | 1 line (`reference_id` pass karna) |
| backend `app/api/payments.py` | Zyada tar haan | 1 line |
| backend `app/jobs/expiry_job.py` | **Haan**, poora (8/8 lines) | — |
| backend `app/services/ai_chat_service.py` | Nahi | 5 lines (chat se hold/cancel pe `reference_id`) |
| backend `app/services/notification_service.py` | Hissa: `notify_payment_rejected`, `notify_refund_paid`, `notify_owner_refund_owed`, aur `reference_id` (main mein zyada jagah) | Push ka per-token sent/failed/skipped log, `no_token` row, SMS ka honest skipped/failed status, `notify_owner_of_player_cancellation` (~80 lines) |
| backend `app/services/waitlist_service.py` | Nahi | 1 line (`reference_id`) |
| backend `tests/test_jobs.py`, `tests/test_notifications.py` | Nahi | Chhote updates (2 + 4 lines) |
| backend `tests/test_notification_phase0.py` | **Nahi** (file hi nahi) | Poori file, 437 lines |
| mobile `app/_layout.tsx` | Hissa: AppState listener aur ek chhota `routeForNotification` (sirf 3 event types) | Poora deep-link table (16 event types: owner_new_booking, refund_owed, venue_approved/rejected, reminder, court_deactivated...) aur foreground pe re-register |
| mobile `lib/push-notifications.ts` | Hissa: `registerForPushNotifications` hai | `usePushStatus`, errors ko na chhupana (`doRegister`) |
| mobile `components/notifications-off-hint.tsx` | **Nahi** (file nahi) | Poori file (hint card) |
| mobile `(owner)/account.tsx`, `(player)/(tabs)/profile.tsx` | Nahi | Hint card lagana (2-3 lines) |
| mobile `(owner)/today.tsx` | File ab `(owner)/(tabs)/today.tsx` pe hai (Floodlight) | Hint card (2 lines), nayi jagah pe |

**Recommendation:** baad mein, ek nayi branch pe main ke upar dobara likh ke (rebase nahi). Backend ka honest logging + owner-cancel push, aur mobile ka deep-link table sab se qeemti hissa hai. Koi migration nahi chahiye. Mobile wala hissa JS-only hai, is liye EAS update se ja sakta hai.

## Sab se chhota "abhi" wala package (meri recommendation)

1. ~~**NAME** ka faisla~~: DONE (Khelo).
2. **MAP** module isi build mein daalna hai ya nahi, ye bhi build se pehle tay karna hai.
3. **B6** aur **B4**: koi migration nahi, jaldi ho jate hain.
4. **B2** aur **W**: dono mein migration hai. Ek saath ek hi migration mein karein, aap ki "go" aur snapshot ke sath.

Is file ke liye koi code nahi likha gaya.
