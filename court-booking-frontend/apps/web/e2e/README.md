# Khelo smoke runner

Plain Node script (not `@playwright/test`, which is not installed). For each of the 9 routes (`/`, `/features`, `/for-owners`,
`/about`, `/blog`, `/contact`, `/login`, `/signup`, `/search`) at 360, 768 and 1280 px it checks: no horizontal scroll, the header
link "Khelo home", exactly one `<h1>`, a `<main>` landmark, no console or page errors, and no leftover placeholder text
(`[LIKE THIS]`, `00+`, the word "Maidan"). It saves a full-page screenshot per route and width to `design-review/` (git-ignored).

Run against a production build (never `next dev`):

```
cd court-booking-frontend/apps/web
npx next build
npx next start --port 3000
BASE_URL=http://localhost:3000 node e2e/smoke.cjs
```

Prints a PASS/FAIL table and exits 1 on any failure (2 if Playwright cannot be loaded).

`playwright` is resolved from `require("playwright")`, then env `PLAYWRIGHT_PATH`, then the copy in `apps/mobile/node_modules`
of the main checkout. Optional env: `SHOT_DIR` to change the screenshot folder.
