# Pre-push check: Floodlight + Khelo rename → production (final, 2026-10-25)

Kya push hoga: local `main` (code: merge **93b8376**, phir sirf is doc ka commit), jo `origin/main` **db4db49** se 34 commits aage hai:
- Floodlight ke 30 commits (rewrite ke baad screenshots ke baghair)
- `.gitignore` commit `5848aa5`
- rename commit `e4df42a` + merge `93b8376`

Kul 370 files, +33,980 / −9,318 lines. **Push size ~3.0 MB** (git pack). Screenshots nikalne se pehle ye 85.2 MB tha.
Ye check production ko chhue baghair kiya gaya: push nahi kiya, kuch deploy nahi kiya.

## a) Tests, tsc, web build: rename ke baad, final `main` tree pe

| Check | Command | Nateeja |
|---|---|---|
| Backend pytest (poora suite, real Postgres) | `AI_PROVIDER=claude AI_VISION_PROVIDER=claude TEST_DB_NAME=court_booking_test_final .venv/Scripts/python.exe -m pytest -q` | ✅ 1568 passed, 0 failed (8 min 29 s; 6 deprecation warnings) |
| tsc: web, api-client, types, ui-tokens | `npm run typecheck` (court-booking-frontend) | ✅ 0 errors |
| tsc: mobile | `npx tsc --noEmit` (apps/mobile) | ✅ 0 errors |
| Mobile unit tests | `npx tsx --test <21 files>` | ✅ 131/131 |
| Web unit tests | `npx tsx --test <26 files>` | ✅ 144/144 |
| packages/types unit tests | `npx tsx --test <16 files>` | ✅ 96/96 |
| Web production build | `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000 npx next build` | ✅ compiled, 45/45 static pages |
| Expo config | `npx expo config --type public` | ✅ Khelo / khelo / [khelo, maidan] / com.aftrsolutions.khelo / projectId e166063a-… |

Playwright/e2e dobara nahi chalaye. Un ke liye poora seeded local stack chahiye. QA phase (8af03f1) mein ye 245/245 aur 278/278 pass hue thay. Rename ne koi visible text nahi badla, is liye e2e ke text checks pe asar nahi.

## b) Files: binaries, secrets, size

- **Screenshots:** `docs/floodlight-qa/**/*.png` (437) aur `docs/mobile-audit/p0-after/` (78), kul 515 PNG, unpushed history se nikaal di gayi hain (`git filter-branch --index-filter`, sirf `db4db49..main`).
  - Copy yahan hai: `C:\Users\Noman Traders\Desktop\Court Booking App - QA screenshots\` (515 files, 92 MB).
  - Dono patterns `.gitignore` mein hain. .md reports, scripts aur json repo mein hain.
  - Backup: local branch `backup/pre-cleanup` = `9130262` (purana main, images ke sath). Ye local hai, push na karein.
- **Baqi files:** push mein ab sirf 35 PNG hain (2.5 MB, zyada tar `docs/venue-card-qa` aur e2e). Sab se bari file `package-lock.json` (0.56 MB) hai, aur koi image 0.1 MB se bari nahi. Kul added content 5.8 MB hai, jo compress hokar ~3.0 MB pack banta hai.
- **.env / keys / certs:** koi `.env`, `.pem`, `.key`, `.p12`, `.jks`, keystore ya service-account file nahi hai. `.env.example` mein sirf `APNS_BUNDLE_ID` ki example value badli. `google-services.json` abhi nahi badla.
- **Secret patterns** (sirf added lines; values print nahi kiye): AWS key, `sk-`/`sk-ant-`, `AIza`, private key, GitHub/Slack token, JWT, Sentry DSN, `password=...`. 4 hits aaye, charon QA scripts mein **local seed ka test password** hai (wahi jo `app/seed.py` mein pehle se hai), aur ye scripts `localhost:8000` pe login karti hain.
- **Kya production kabhi seed.py chalata hai?** **Nahi.** `deploy.yml`, `infra/`, `docker-compose.prod.yml`, backend `Dockerfile` (CMD sirf uvicorn) aur app startup mein seed ka koi zikr nahi.

## c) Push karne par kya hota hai (`.github/workflows/deploy.yml`)

`main` pe har push ke baad GitHub Actions khud ye 3 jobs chalata hai:

1. **migration-guard:** pichle *kamyab* deploy se ab tak `court-booking-backend/alembic/versions/` mein koi `.py` file nayi ya badli ho, aur kisi commit message mein bilkul ye line na ho: `Migration-Go: owner-approved`, to run fail ho jata hai aur kuch deploy nahi hota.
   **Is push mein koi migration nahi** (0 files), is liye guard "OK" karega.
2. **build-and-push:** **backend** aur **web** dono ki Docker images banti hain aur AWS ECR pe commit hash ke tag + `latest` ke sath jati hain.
3. **deploy:** SSM ke zariye EC2 pe ye hota hai: disk mein 2 GB jagah check, nayi images pull, `alembic upgrade head` (aaj no-op), `alembic check`, `docker compose up -d` aur purani images prune.

Simple lafzon mein:
- **Website** naye Floodlight design ke sath live ho jayegi.
- **Backend** restart hoga. Us mein sirf ek tabdeeli hai: `APNS_BUNDLE_ID` ki default value `com.aftrsolutions.khelo` ho gayi. Ye sirf iOS push pe lagti hai, aur sirf tab jab production mein `APNS_BUNDLE_ID` set na ho. Abhi koi iOS app hai hi nahi, is liye amli asar nahi. API wahi hai.
- Restart mein kuch seconds ki downtime ho sakti hai.
- **Mobile app push se nahi badalti.** Wo sirf EAS build/update se jati hai, aur ab naye project `@abdulrafay879/khelo` se.

## d) Rollback plan (force-push ke baghair)

- Abhi wala `origin/main`: **`db4db49d1b4f7c9e2daf59793310a21a17ba10dc`** (db4db49, "Merge mobile-p0-fixes", 2026-10-24).
- Local tag **`pre-floodlight`** isi commit pe hai (rewrite ke baad dobara check kiya). Push nahi kiya.

**Tareeqa 1 (sab se tez):** GitHub → Actions → "Build, push, deploy" → db4db49 wala aakhri kamyab run kholein → **Re-run all jobs**. Ye wahi purana commit dobara build aur deploy karta hai. (GitHub sirf 30 din tak purane run re-run karne deta hai.) Is ke baad `main` pe ab bhi naya code hoga, is liye agle push se pehle Tareeqa 2 karna hoga.

**Tareeqa 2 (asal fix: naya "rollback" commit, force-push nahi):**

```powershell
cd "C:\Users\Noman Traders\Desktop\Court Booking App"
git switch main
git pull --ff-only origin main
# Poore tracked tree ko pre-floodlight jaisa kar do (baad mein add hui files hat jayengi; untracked files ko kuch nahi hota)
git restore --source=pre-floodlight --staged --worktree -- .
git status --short | Select-Object -First 20
git commit -m "Rollback: restore tree to pre-floodlight (db4db49)"
# Confirm: tree bilkul db4db49 jaisa hai (koi output nahi aana chahiye)
git diff pre-floodlight HEAD --stat
git push origin main
```

- Ye steps ek temporary worktree mein test kiye gaye: restore + commit ke baad `git diff pre-floodlight HEAD` khaali aaya.
- Is push pe migration-guard pass hoga (koi migration nahi).
- Floodlight commits history mein rahenge, aur `git revert <rollback-commit-hash>` se wapas aa sakte hain.
- Agar tag na mile to `pre-floodlight` ki jagah `db4db49d1b4f7c9e2daf59793310a21a17ba10dc` likhein.

## e) Push ke baad smoke test (sirf public pages, login nahi)

Web: `https://3.6.48.6.sslip.io`, API: `https://api.3.6.48.6.sslip.io`

1. **Deploy kamyab:** Actions run hara ho, log mein `migration guard: no migration in this push. OK.` dikhe, aur aakhir mein `docker compose ps` mein backend + web "Up" hon.
2. **API zinda:** `https://api.3.6.48.6.sslip.io/health` → 200 OK.
3. **Home page:** `/` naye Floodlight design mein khule, browser console mein laal errors na hon, aur Roman Urdu/English switch kaam kare.
4. **Venue list + venue page:** `/venues` (ya `/search`) mein venue cards photo ke sath dikhein. Ek venue kholein: photos, courts, aaj ke slots aur cancellation policy nazar aayein. Ye page API se data leta hai.
5. **Phone width + static pages:** 390 px width pe `/`, `/for-owners`, `/about`, `/terms`, `/privacy` kholein. Koi sideways scroll ya toota hua layout na ho, aur ghalat URL (`/xyz`) pe 404 page aaye.

Kuch bhi fail ho to section (d) dekhein.

## Push se pehle yaad rakhein

- Sirf `main` push karein (`git push origin main`). `backup/pre-cleanup` aur tags (`pre-floodlight`, `archive/notifications-phase-0`) local hain.
- EAS development build ka push se koi taalluq nahi. Wo `google-services.json` ki nayi file ka intezar kar raha hai.

READY TO PUSH
