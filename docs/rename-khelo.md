# Rename: Maidan → Khelo (branch `rename-khelo`, 2026-10-25)

## Kya badla

| Cheez | Pehle | Ab |
|---|---|---|
| App name | Khelo (pehle se) | Khelo |
| slug | `maidan` | `khelo` |
| Android package | `com.maidan.app` | `com.aftrsolutions.khelo` |
| iOS bundle id | `com.maidan.app` | `com.aftrsolutions.khelo` |
| scheme | `maidan` | `["khelo", "maidan"]`: `khelo://` main hai, purane `maidan://` links bhi khulte hain |
| EAS owner / project | `maidan-app` / `4853b946-…` | `abdulrafay879` / `e166063a-198d-4bf8-9e12-299a98cd8b18` (`@abdulrafay879/khelo`, `eas init` se bana) |
| EAS Update URL | `https://u.expo.dev/4853b946-…` | `https://u.expo.dev/e166063a-198d-4bf8-9e12-299a98cd8b18` |
| Backend `APNS_BUNDLE_ID` default | `com.maidan.app` | `com.aftrsolutions.khelo` (env var ka naam wahi; agar production SSM mein ye set hai to wahan bhi badalna hoga jab iOS push chalu ho) |

User ko nazar aane wala text: app screens, web, notifications, WhatsApp/chat templates, emails, page titles,
manifest aur permission texts **pehle hi "Khelo" thay**. Code mein koi visible "Maidan" brand text nahi mila (neeche poori list).
Backend koi `maidan://` deep link nahi bhejta, is liye wahan badalne ko kuch nahi tha.
Icon/splash images ka text grep se check nahi ho sakta. Wo pehle wale Khelo rebrand mein badli thin (web `logo.tsx` comment).

## Kya NAHI badla (faisle ke mutabiq)

- DB ka data, khaas kar venue "Maidan Court" (asli venue). Tests/fixtures mein bhi wahi naam rehne diya.
- DB/table/column names, env var names, AWS resources, docker services, repo/folder names, API routes. Koi migration nahi.
- `maidan.*` storage keys (web localStorage + mobile AsyncStorage/SecureStore). Ye user ko nazar nahi aatin, aur badalne se sab log logout ho jate.
- Tareekhi docs/design files aur purane logo SVGs.

## ⚠️ Blocker: `google-services.json`

Firebase file (`apps/mobile/google-services.json`, project `maidan-31556`) mein sirf `com.maidan.app` ka Android client hai.
Naye package ke sath Android Gradle build "No matching client found for package name" pe fail hoga, aur push (FCM) bhi
isi file pe chalta hai. Hal: Firebase console → project → Add app → Android → package `com.aftrsolutions.khelo` → nayi
`google-services.json` download karke isi jagah rakhein. Backend ka FCM service account wahi Firebase project use karta hai,
is liye backend mein kuch nahi badalna.

## `grep -ri maidan` ki poori list (rename se pehle, `main` pe: 85 files, 202 hits)

| Faisla | File | Hits | Kyun |
|---|---|---|---|
| BADLA | `court-booking-backend/.env.example` | 1 | example value `APNS_BUNDLE_ID=com.aftrsolutions.khelo` (naam wahi) |
| BADLA | `court-booking-backend/app/config.py` | 1 | `APNS_BUNDLE_ID` ki default value → `com.aftrsolutions.khelo` (iOS bundle se milni chahiye). Env var ka naam wahi hai |
| BADLA | `court-booking-backend/tests/test_apns.py` | 2 | test mein bundle id naya |
| BADLA | `court-booking-frontend/apps/mobile/app.json` | 5 | slug `khelo`, scheme `["khelo","maidan"]`, package/bundle `com.aftrsolutions.khelo`, owner `abdulrafay879`, naya projectId + updates.url |
| BADLA | `court-booking-frontend/apps/mobile/docs/native-foundation.md` | 3 | identity section + whoami note naye project ke mutabiq |
| HISSA | `infra/README.md` | 2 | APNS default wali line badli; `maidan-firebase-adminsdk.json` file ka naam (asal Firebase key file) nahi badla |
| NAHI (BLOCKER) | `court-booking-frontend/apps/mobile/google-services.json` | 3 | Firebase ki file hai (project `maidan-31556`, client `com.maidan.app`). Haath se edit nahi ho sakti; Firebase console se naye package ki nayi file chahiye |
| NAHI | `AUDIT_FINDINGS.md` | 1 | tareekhi docs / design files / purane logo SVG. Ye record hain (asli venue "Maidan Court" ka zikr, purane faisle); app mein ship nahi hote |
| NAHI | `court-booking-backend/CLAUDE.md` | 3 | tareekhi docs / design files / purane logo SVG. Ye record hain (asli venue "Maidan Court" ka zikr, purane faisle); app mein ship nahi hote |
| NAHI | `court-booking-backend/README.md` | 1 | tareekhi docs / design files / purane logo SVG. Ye record hain (asli venue "Maidan Court" ka zikr, purane faisle); app mein ship nahi hote |
| NAHI | `court-booking-backend/RUNBOOK.md` | 1 | tareekhi docs / design files / purane logo SVG. Ye record hain (asli venue "Maidan Court" ka zikr, purane faisle); app mein ship nahi hote |
| NAHI | `court-booking-backend/app/services/reply_text.py` | 1 | docstring example: venue "Maidan Court" (asli venue, brand nahi) |
| NAHI | `court-booking-backend/scripts/generate_ocr_fixtures.py` | 2 | test data: venue/receiver naam "Maidan Court" / "Maidan Padel Club", FCM fake project `maidan-test`, account title. Asli venue/test fixtures |
| NAHI | `court-booking-backend/tests/fixtures/payments/manifest.py` | 2 | test data: venue/receiver naam "Maidan Court" / "Maidan Padel Club", FCM fake project `maidan-test`, account title. Asli venue/test fixtures |
| NAHI | `court-booking-backend/tests/test_chat_reliability.py` | 4 | test data: venue/receiver naam "Maidan Court" / "Maidan Padel Club", FCM fake project `maidan-test`, account title. Asli venue/test fixtures |
| NAHI | `court-booking-backend/tests/test_chat_state.py` | 2 | test data: venue/receiver naam "Maidan Court" / "Maidan Padel Club", FCM fake project `maidan-test`, account title. Asli venue/test fixtures |
| NAHI | `court-booking-backend/tests/test_fcm.py` | 5 | test data: venue/receiver naam "Maidan Court" / "Maidan Padel Club", FCM fake project `maidan-test`, account title. Asli venue/test fixtures |
| NAHI | `court-booking-backend/tests/test_ocr.py` | 6 | test data: venue/receiver naam "Maidan Court" / "Maidan Padel Club", FCM fake project `maidan-test`, account title. Asli venue/test fixtures |
| NAHI | `court-booking-backend/tests/test_owner_billing_step3.py` | 1 | test data: venue/receiver naam "Maidan Court" / "Maidan Padel Club", FCM fake project `maidan-test`, account title. Asli venue/test fixtures |
| NAHI | `court-booking-backend/tests/test_time_formatting.py` | 2 | test data: venue/receiver naam "Maidan Court" / "Maidan Padel Club", FCM fake project `maidan-test`, account title. Asli venue/test fixtures |
| NAHI | `court-booking-backend/tests/test_webhooks.py` | 2 | test data: venue/receiver naam "Maidan Court" / "Maidan Padel Club", FCM fake project `maidan-test`, account title. Asli venue/test fixtures |
| NAHI | `court-booking-frontend/CLAUDE.md` | 15 | tareekhi docs / design files / purane logo SVG. Ye record hain (asli venue "Maidan Court" ka zikr, purane faisle); app mein ship nahi hote |
| NAHI | `court-booking-frontend/apps/mobile/app/dev/components.tsx` | 1 | dev-only component gallery ka sample venue naam "Maidan Court" (asli venue) |
| NAHI | `court-booking-frontend/apps/mobile/e2e/followups-check.cjs` | 4 | test scripts `maidan.*` storage keys set karti hain; app ki keys nahi badlin, to ye bhi wahi |
| NAHI | `court-booking-frontend/apps/mobile/e2e/player-journey-live.cjs` | 5 | test scripts `maidan.*` storage keys set karti hain; app ki keys nahi badlin, to ye bhi wahi |
| NAHI | `court-booking-frontend/apps/mobile/e2e/player-states-live.cjs` | 3 | test scripts `maidan.*` storage keys set karti hain; app ki keys nahi badlin, to ye bhi wahi |
| NAHI | `court-booking-frontend/apps/mobile/e2e/qa-journey-live.cjs` | 5 | test scripts `maidan.*` storage keys set karti hain; app ki keys nahi badlin, to ye bhi wahi |
| NAHI | `court-booking-frontend/apps/mobile/e2e/qa-motion-check.cjs` | 1 | test scripts `maidan.*` storage keys set karti hain; app ki keys nahi badlin, to ye bhi wahi |
| NAHI | `court-booking-frontend/apps/mobile/e2e/round2-m1-check.cjs` | 4 | test scripts `maidan.*` storage keys set karti hain; app ki keys nahi badlin, to ye bhi wahi |
| NAHI | `court-booking-frontend/apps/mobile/e2e/round2-m2-check.cjs` | 5 | test scripts `maidan.*` storage keys set karti hain; app ki keys nahi badlin, to ye bhi wahi |
| NAHI | `court-booking-frontend/apps/mobile/e2e/stage2-m1-check.cjs` | 4 | test scripts `maidan.*` storage keys set karti hain; app ki keys nahi badlin, to ye bhi wahi |
| NAHI | `court-booking-frontend/apps/mobile/e2e/stage2-m2-check.cjs` | 7 | test scripts `maidan.*` storage keys set karti hain; app ki keys nahi badlin, to ye bhi wahi |
| NAHI | `court-booking-frontend/apps/mobile/lib/auth-store.ts` | 3 | `maidan.*` storage keys (session, device id, drafts, push token). Badalne se sab users logout aur drafts gum ho jayenge; user ko nazar nahi aate |
| NAHI | `court-booking-frontend/apps/mobile/lib/booking-flow-store.ts` | 1 | `maidan.*` storage keys (session, device id, drafts, push token). Badalne se sab users logout aur drafts gum ho jayenge; user ko nazar nahi aate |
| NAHI | `court-booking-frontend/apps/mobile/lib/device.ts` | 1 | `maidan.*` storage keys (session, device id, drafts, push token). Badalne se sab users logout aur drafts gum ho jayenge; user ko nazar nahi aate |
| NAHI | `court-booking-frontend/apps/mobile/lib/owner-lang.ts` | 1 | `maidan.*` storage keys (session, device id, drafts, push token). Badalne se sab users logout aur drafts gum ho jayenge; user ko nazar nahi aate |
| NAHI | `court-booking-frontend/apps/mobile/lib/push-notifications.ts` | 1 | `maidan.*` storage keys (session, device id, drafts, push token). Badalne se sab users logout aur drafts gum ho jayenge; user ko nazar nahi aate |
| NAHI | `court-booking-frontend/apps/mobile/lib/selected-venue.ts` | 1 | `maidan.*` storage keys (session, device id, drafts, push token). Badalne se sab users logout aur drafts gum ho jayenge; user ko nazar nahi aate |
| NAHI | `court-booking-frontend/apps/mobile/lib/venue-setup-store.ts` | 1 | `maidan.*` storage keys (session, device id, drafts, push token). Badalne se sab users logout aur drafts gum ho jayenge; user ko nazar nahi aate |
| NAHI | `court-booking-frontend/apps/web/app/globals.css` | 4 | CSS class `maidan-float` (andar ka naam, user ko nahi dikhta) |
| NAHI | `court-booking-frontend/apps/web/components/auth/floating-icons.tsx` | 1 | CSS class `maidan-float` (andar ka naam, user ko nahi dikhta) |
| NAHI | `court-booking-frontend/apps/web/components/auth/logo.tsx` | 1 | code comment (purane logo ki tareekh) |
| NAHI | `court-booking-frontend/apps/web/e2e/README.md` | 1 | isi brand guard ka zikr |
| NAHI | `court-booking-frontend/apps/web/e2e/auth-fix-check.cjs` | 2 | test scripts `maidan.*` storage keys set karti hain; app ki keys nahi badlin, to ye bhi wahi |
| NAHI | `court-booking-frontend/apps/web/e2e/history-check.cjs` | 2 | test scripts `maidan.*` storage keys set karti hain; app ki keys nahi badlin, to ye bhi wahi |
| NAHI | `court-booking-frontend/apps/web/e2e/nav-notif-check.cjs` | 4 | test scripts `maidan.*` storage keys set karti hain; app ki keys nahi badlin, to ye bhi wahi |
| NAHI | `court-booking-frontend/apps/web/e2e/overview-check.cjs` | 4 | test scripts `maidan.*` storage keys set karti hain; app ki keys nahi badlin, to ye bhi wahi |
| NAHI | `court-booking-frontend/apps/web/e2e/round2-approvals-check.cjs` | 3 | test scripts `maidan.*` storage keys set karti hain; app ki keys nahi badlin, to ye bhi wahi |
| NAHI | `court-booking-frontend/apps/web/e2e/round2-refunds-settings-bell-check.cjs` | 4 | test scripts `maidan.*` storage keys set karti hain; app ki keys nahi badlin, to ye bhi wahi |
| NAHI | `court-booking-frontend/apps/web/e2e/smoke.cjs` | 1 | ye check karta hai ke page pe lafz "Maidan" NA ho (brand guard); jaisa hai theek |
| NAHI | `court-booking-frontend/apps/web/e2e/stage2-push-noshow-check.cjs` | 4 | test scripts `maidan.*` storage keys set karti hain; app ki keys nahi badlin, to ye bhi wahi |
| NAHI | `court-booking-frontend/apps/web/e2e/stage2-settings-cnic-check.cjs` | 5 | test scripts `maidan.*` storage keys set karti hain; app ki keys nahi badlin, to ye bhi wahi |
| NAHI | `court-booking-frontend/apps/web/lib/auth-store.ts` | 3 | `maidan.*` storage keys (session, device id, drafts, push token). Badalne se sab users logout aur drafts gum ho jayenge; user ko nazar nahi aate |
| NAHI | `court-booking-frontend/apps/web/lib/device.ts` | 1 | `maidan.*` storage keys (session, device id, drafts, push token). Badalne se sab users logout aur drafts gum ho jayenge; user ko nazar nahi aate |
| NAHI | `court-booking-frontend/apps/web/lib/pending-auth.ts` | 1 | `maidan.*` storage keys (session, device id, drafts, push token). Badalne se sab users logout aur drafts gum ho jayenge; user ko nazar nahi aate |
| NAHI | `court-booking-frontend/apps/web/lib/selected-venue.ts` | 1 | `maidan.*` storage keys (session, device id, drafts, push token). Badalne se sab users logout aur drafts gum ho jayenge; user ko nazar nahi aate |
| NAHI | `court-booking-frontend/apps/web/lib/venue-setup-store.ts` | 1 | `maidan.*` storage keys (session, device id, drafts, push token). Badalne se sab users logout aur drafts gum ho jayenge; user ko nazar nahi aate |
| NAHI | `design/khelo-mobile-floodlight/MASTER-PROMPT.md` | 1 | tareekhi docs / design files / purane logo SVG. Ye record hain (asli venue "Maidan Court" ka zikr, purane faisle); app mein ship nahi hote |
| NAHI | `design/khelo-mobile-floodlight/Main.dc.html` | 2 | tareekhi docs / design files / purane logo SVG. Ye record hain (asli venue "Maidan Court" ka zikr, purane faisle); app mein ship nahi hote |
| NAHI | `design/khelo-mobile-floodlight/PAccount.dc.html` | 2 | tareekhi docs / design files / purane logo SVG. Ye record hain (asli venue "Maidan Court" ka zikr, purane faisle); app mein ship nahi hote |
| NAHI | `design/khelo-mobile-floodlight/PBookings.dc.html` | 1 | tareekhi docs / design files / purane logo SVG. Ye record hain (asli venue "Maidan Court" ka zikr, purane faisle); app mein ship nahi hote |
| NAHI | `design/khelo-mobile-floodlight/PChat.dc.html` | 1 | tareekhi docs / design files / purane logo SVG. Ye record hain (asli venue "Maidan Court" ka zikr, purane faisle); app mein ship nahi hote |
| NAHI | `design/khelo-mobile-floodlight/floodlight-implementation-prompt.md` | 1 | tareekhi docs / design files / purane logo SVG. Ye record hain (asli venue "Maidan Court" ka zikr, purane faisle); app mein ship nahi hote |
| NAHI | `design/khelo-mobile-floodlight/khelo-design-research-2026-10.md` | 1 | tareekhi docs / design files / purane logo SVG. Ye record hain (asli venue "Maidan Court" ka zikr, purane faisle); app mein ship nahi hote |
| NAHI | `docs/SECTION_32_PLAN.md` | 1 | tareekhi docs / design files / purane logo SVG. Ye record hain (asli venue "Maidan Court" ka zikr, purane faisle); app mein ship nahi hote |
| NAHI | `docs/floodlight-contract.md` | 1 | tareekhi docs / design files / purane logo SVG. Ye record hain (asli venue "Maidan Court" ka zikr, purane faisle); app mein ship nahi hote |
| NAHI | `docs/floodlight-qa/scripts/qa-screens.cjs` | 2 | QA scripts: storage keys / brand guard |
| NAHI | `docs/floodlight-qa/scripts/web-qa.cjs` | 4 | QA scripts: storage keys / brand guard |
| NAHI | `docs/floodlight-qa/w1/scripts/w1_qa.cjs` | 4 | QA scripts: storage keys / brand guard |
| NAHI | `docs/frontend-build-prompt.md` | 2 | tareekhi docs / design files / purane logo SVG. Ye record hain (asli venue "Maidan Court" ka zikr, purane faisle); app mein ship nahi hote |
| NAHI | `docs/maidan-logo-full-dark-v2.svg` | 1 | tareekhi docs / design files / purane logo SVG. Ye record hain (asli venue "Maidan Court" ka zikr, purane faisle); app mein ship nahi hote |
| NAHI | `docs/maidan-logo-full-light-v2.svg` | 1 | tareekhi docs / design files / purane logo SVG. Ye record hain (asli venue "Maidan Court" ka zikr, purane faisle); app mein ship nahi hote |
| NAHI | `docs/maidan-screens.html` | 3 | tareekhi docs / design files / purane logo SVG. Ye record hain (asli venue "Maidan Court" ka zikr, purane faisle); app mein ship nahi hote |
| NAHI | `docs/mobile-audit-2026-10.md` | 6 | tareekhi docs / design files / purane logo SVG. Ye record hain (asli venue "Maidan Court" ka zikr, purane faisle); app mein ship nahi hote |
| NAHI | `docs/screens-data.json` | 1 | tareekhi docs / design files / purane logo SVG. Ye record hain (asli venue "Maidan Court" ka zikr, purane faisle); app mein ship nahi hote |
| NAHI | `docs/screens/AdminApproval.html` | 1 | tareekhi docs / design files / purane logo SVG. Ye record hain (asli venue "Maidan Court" ka zikr, purane faisle); app mein ship nahi hote |
| NAHI | `docs/screens/AuthLogin.html` | 1 | tareekhi docs / design files / purane logo SVG. Ye record hain (asli venue "Maidan Court" ka zikr, purane faisle); app mein ship nahi hote |
| NAHI | `docs/screens/AuthOtp.html` | 1 | tareekhi docs / design files / purane logo SVG. Ye record hain (asli venue "Maidan Court" ka zikr, purane faisle); app mein ship nahi hote |
| NAHI | `docs/screens/PaymentRejected.html` | 1 | tareekhi docs / design files / purane logo SVG. Ye record hain (asli venue "Maidan Court" ka zikr, purane faisle); app mein ship nahi hote |
| NAHI | `docs/screens/PlayerHome.html` | 1 | tareekhi docs / design files / purane logo SVG. Ye record hain (asli venue "Maidan Court" ka zikr, purane faisle); app mein ship nahi hote |
| NAHI | `docs/screens/VenueCourts.html` | 1 | tareekhi docs / design files / purane logo SVG. Ye record hain (asli venue "Maidan Court" ka zikr, purane faisle); app mein ship nahi hote |
| NAHI | `docs/screens/VenueRegister.html` | 2 | tareekhi docs / design files / purane logo SVG. Ye record hain (asli venue "Maidan Court" ka zikr, purane faisle); app mein ship nahi hote |
| NAHI | `docs/screens/WebDashboard.html` | 1 | tareekhi docs / design files / purane logo SVG. Ye record hain (asli venue "Maidan Court" ka zikr, purane faisle); app mein ship nahi hote |
| NAHI | `docs/screens/WebLanding.html` | 1 | tareekhi docs / design files / purane logo SVG. Ye record hain (asli venue "Maidan Court" ka zikr, purane faisle); app mein ship nahi hote |
| NAHI | `docs/screens/WebVenue.html` | 1 | tareekhi docs / design files / purane logo SVG. Ye record hain (asli venue "Maidan Court" ka zikr, purane faisle); app mein ship nahi hote |
