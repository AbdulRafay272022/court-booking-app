# Pre-push check: Floodlight → production (2026-10-25)

Kya push hoga: local `main` **9130262**, jo `origin/main` **db4db49** se 30 commits aage hai.
865 files add/modify hui hain (878 total changes), +33,685 / −9,307 lines.
Ye check production ko chhue baghair kiya gaya: push nahi kiya, kuch deploy nahi kiya.

## a) Tests, tsc, web build (sab local)

| Check | Command | Nateeja |
|---|---|---|
| Backend pytest (poora suite, real Postgres) | `AI_PROVIDER=claude AI_VISION_PROVIDER=claude TEST_DB_NAME=court_booking_test_prepush .venv/Scripts/python.exe -m pytest -q` | ✅ 1568 passed, 0 failed (11 min 28 s; 6 deprecation warnings only) |
| tsc: web, api-client, types, ui-tokens | `npm run typecheck` (court-booking-frontend) | ✅ 0 errors |
| tsc: mobile | `npx tsc --noEmit` (apps/mobile) | ✅ 0 errors |
| Mobile unit tests | `npx tsx --test <21 files>` | ✅ 131/131 |
| Web unit tests | `npx tsx --test <26 files>` | ✅ 144/144 |
| packages/types unit tests | `npx tsx --test <16 files>` | ✅ 96/96 |
| Web production build | `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000 npx next build` | ✅ compiled, 45/45 static pages |

Playwright/e2e dobara nahi chalaye. Un ke liye poora local stack (seeded backend + web server) chahiye, aur QA phase (8af03f1) mein ye 245/245 aur 278/278 pass hue thay.

## b) Files: binaries, secrets, size

- **.env / keys / certs:** koi `.env`, `.pem`, `.key`, `.p12`, `.jks`, keystore, `id_rsa` ya service-account file nahi hai. Naam mein "token" wali files sirf `packages/ui-tokens/*` hain (design tokens), secret nahi. `google-services.json` is push mein nahi badla.
- **Secret patterns** (sirf added lines scan kiye, values print nahi kiye): AWS key, `sk-`/`sk-ant-`, Google `AIza`, private key, GitHub/Slack token, JWT, Sentry DSN, `password=...`. Inke 4 hits aaye, aur charon QA scripts mein hain:
  - `apps/mobile/e2e/player-states-live.cjs`, `apps/mobile/e2e/qa-motion-check.cjs`
  - `docs/floodlight-qa/scripts/web-qa.cjs`, `docs/floodlight-qa/w1/scripts/w1_qa.cjs`
  Ye **local seed ka test password** hai: wahi string `court-booking-backend/app/seed.py` mein pehle se hai, aur scripts `http://localhost:8000` pe login karte hain. Koi asal secret nahi.
  ⚠️ Ek baat aap confirm kar lein: kya production pe koi account isi seed password ke sath bana hai? Agar haan, to wo password badal dein. Push se is ka khatra nahi barhta, kyunke ye seed.py mein pehle se public hai.
- **Size:** 865 files mein se 550 PNG screenshots hain. Kul **96.2 MB** add ho raha hai:
  - `docs/floodlight-qa`: **84.1 MB, 450 files**. ⚠️ Ye 20 MB ki had se zyada hai.
  - `docs/mobile-audit`: 6.5 MB, `docs/venue-card-qa`: 2.0 MB, app code: 2.3 MB.
  - Sab se bari file 1.14 MB hai (`docs/floodlight-qa/web/bookings-390.png`). 1 MB se bari sirf 3 files hain, 5 MB se bari koi nahi, is liye GitHub ki 100 MB/file wali limit ka masla nahi.
  - Asar: repo hamesha ke liye ~84 MB bhari ho jayegi (har clone aur CI checkout mein). Deploy images pe asar nahi, kyunke Docker build sirf `court-booking-backend` aur `court-booking-frontend` folders use karta hai.
  - Agar repo halki rakhni hai to push se **pehle** faisla karna hoga: ya screenshots ko commits se nikal dein (history rewrite, aur ye abhi local hai to safe hai), ya unhein Git LFS / Drive pe rakhein. Push ke baad nikalne se history se nahi jayenge.

## c) Push karne par kya hota hai (`.github/workflows/deploy.yml`)

`main` pe har push ke baad GitHub Actions khud ye 3 jobs chalata hai:

1. **migration-guard:** pichle *kamyab* deploy se ab tak `court-booking-backend/alembic/versions/` mein koi `.py` file nayi ya badli ho, aur kisi commit message mein bilkul ye line na ho: `Migration-Go: owner-approved`, to poora run fail ho jata hai aur kuch deploy nahi hota.
   **Is push mein koi migration nahi**, is liye guard "OK" karke aage barhega.
2. **build-and-push:** do Docker images banti hain, **backend** aur **web** (Next.js, `NEXT_PUBLIC_API_BASE_URL` = Actions variable `API_BASE_URL`). Dono AWS ECR pe commit hash ke tag aur `latest` ke sath push hoti hain.
3. **deploy:** SSM ke zariye EC2 pe ye hota hai: disk mein 2 GB jagah check, nayi images pull, `alembic upgrade head` (aaj ke liye no-op), `alembic check`, phir `docker compose up -d` (naye containers chalte hain) aur purani images prune hoti hain.

Simple lafzon mein: push ke baad **website (web) naya Floodlight design ke sath live ho jayegi**. **Backend** bhi dobara build aur restart hoga, lekin us ka code nahi badla (sirf ek nayi test file hai), is liye API wahi rahegi. Restart mein kuch seconds ki downtime ho sakti hai.
**Mobile app push se nahi badalti.** Wo sirf EAS build/update se jati hai (step 1, alag kaam).

## d) Rollback plan (force-push ke baghair)

- Abhi wala `origin/main`: **`db4db49d1b4f7c9e2daf59793310a21a17ba10dc`** (db4db49, "Merge mobile-p0-fixes", 2026-10-24).
- Local tag **`pre-floodlight`** isi commit pe bana diya hai. Push nahi kiya.

**Tareeqa 1 (sab se tez, code nahi chhoota):** GitHub → Actions → "Build, push, deploy" → db4db49 wala aakhri kamyab run kholein → **Re-run all jobs**. Ye wahi purana commit dobara build/deploy karta hai. (GitHub sirf 30 din tak purane run re-run karne deta hai.) Is ke baad `main` pe ab bhi Floodlight code hoga, is liye agle push se pehle Tareeqa 2 karna hoga.

**Tareeqa 2 (asal fix: naya "rollback" commit, force-push nahi):** PowerShell mein:

```powershell
cd "C:\Users\Noman Traders\Desktop\Court Booking App"
git switch main
git pull --ff-only origin main
# Poore tracked tree ko pre-floodlight jaisa kar do (jo files baad mein add hui thin wo hat jayengi; untracked files ko kuch nahi hota)
git restore --source=pre-floodlight --staged --worktree -- .
git status --short | Select-Object -First 20
git commit -m "Rollback: restore tree to pre-floodlight (db4db49)"
# Confirm: tree bilkul db4db49 jaisa hai (koi output nahi aana chahiye)
git diff pre-floodlight HEAD --stat
git push origin main
```

Is push pe migration-guard pass hoga (koi migration nahi) aur purana web dobara deploy ho jayega. History mein Floodlight commits rahenge, is liye baad mein `git revert <rollback-commit-hash>` karke wapas la sakte hain.

Ye steps ek temporary worktree mein test kiye gaye: restore + commit ke baad `git diff pre-floodlight HEAD` khaali aaya, yani tree bilkul db4db49 jaisa tha. (Test worktree aur branch delete kar diye; push nahi kiya.)

Agar tag kisi wajah se na mile to `pre-floodlight` ki jagah `db4db49d1b4f7c9e2daf59793310a21a17ba10dc` likhein.

## e) Push ke baad smoke test (sirf public pages, login nahi)

Web: `https://3.6.48.6.sslip.io`, API: `https://api.3.6.48.6.sslip.io`

1. **Deploy kamyab:** GitHub Actions ka run hara ho, deploy log mein `migration guard: no migration in this push. OK.` aur aakhir mein `docker compose ps` mein backend + web "Up" dikhein.
2. **API zinda:** `https://api.3.6.48.6.sslip.io/health` → 200 OK.
3. **Home page:** `/` naye Floodlight design mein khule, browser console mein laal errors na hon, aur Roman Urdu/English switch kaam kare.
4. **Venue list + venue page:** `/venues` (ya `/search`) mein venue cards photo ke sath dikhein. Ek venue kholein: photos, courts, aaj ke slots aur cancellation policy nazar aayein. Ye page API se data leta hai, is liye ye web↔API ka asal test hai.
5. **Phone width + static pages:** phone pe (ya browser 390 px width pe) `/`, `/for-owners`, `/about`, `/terms`, `/privacy` kholein. Koi page sideways scroll na kare, kuch toota hua na ho, aur ek ghalat URL (maslan `/xyz`) pe naya 404 page aaye.

Kuch bhi fail ho to section (d) dekhein.
