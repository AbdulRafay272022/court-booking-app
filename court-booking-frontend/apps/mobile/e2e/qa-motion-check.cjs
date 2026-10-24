// Floodlight QA: reduce-motion path on Expo web (local backend). Playwright emulates prefers-reduced-motion, which
// react-native-web's AccessibilityInfo.isReduceMotionEnabled reads.
// Run: PLAYWRIGHT_PATH=<...>/node_modules/playwright BASE=http://localhost:8095 API=http://localhost:8000 node e2e/qa-motion-check.cjs
// Checks, each with motion ON (control) and REDUCED: VenueCard photo autoplay (>= 2 photos), Sheet slide-in, Skeleton pulse.
const { chromium } = require(process.env.PLAYWRIGHT_PATH);
const BASE = process.env.BASE || "http://localhost:8095";
const API = `${process.env.API || "http://localhost:8000"}/api/v1`;
if (!/localhost|127\.0\.0\.1/.test(API)) throw new Error("local backend only");
const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? "PASS " : "FAIL ") + n + (x !== undefined ? "  " + String(x).slice(0, 200) : "")); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const s = await (await fetch(`${API}/auth/login`, { method: "POST", headers: { "content-type": "application/json", "X-Slot-Grid": "30" }, body: JSON.stringify({ phone: "+923000000003", password: "demo-password-123", platform: "web" }) })).json();
  const list = (await (await fetch(`${API}/venues?page=1&page_size=50`, { headers: { "X-Slot-Grid": "30" } })).json()).venues || [];
  const multi = list.find((v) => (v.photo_urls || []).length >= 2);
  const browser = await chromium.launch({ headless: true });
  async function open(reduced, setup) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: "Asia/Karachi", reducedMotion: reduced ? "reduce" : "no-preference" });
    await ctx.route(/^(?!https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/).*/, (r) => (/^(data|blob):/.test(r.request().url()) ? r.continue() : r.abort()));
    await ctx.addInitScript(([tok, exp, user]) => { if (!localStorage.getItem("maidan.session_token")) { localStorage.setItem("maidan.session_token", tok); localStorage.setItem("maidan.session_expires_at", exp); localStorage.setItem("maidan.cached_user", JSON.stringify(user)); } }, [s.token, s.expires_at, s.user]);
    if (setup) await setup(ctx);
    const page = await ctx.newPage();
    return { ctx, page };
  }
  for (const reduced of [false, true]) {
    const tag = reduced ? "reduced" : "motion on";
    // 1. VenueCard autoplay
    if (multi) {
      const { ctx, page } = await open(reduced);
      await page.goto(`${BASE}/search?near=1&lat=${multi.latitude}&lng=${multi.longitude}`, { waitUntil: "domcontentloaded", timeout: 240000 });
      await page.getByTestId("venue-card").first().waitFor({ timeout: 120000 });
      await sleep(2500);
      const offsets = async () => page.evaluate((name) => {
        const card = [...document.querySelectorAll('[data-testid="venue-card"]')].find((c) => c.innerText.includes(name));
        if (!card) return null;
        const sc = [...card.querySelectorAll("div")].find((d) => d.scrollWidth > d.clientWidth + 20 && /(auto|scroll)/.test(getComputedStyle(d).overflowX));
        return sc ? sc.scrollLeft : null;
      }, multi.name);
      const a = await offsets();
      const seen = new Set([a]);
      for (let i = 0; i < 10; i++) { await sleep(1000); seen.add(await offsets()); }
      if (reduced) check(`${tag}: VenueCard autoplay is OFF (photo index never moves)`, a !== null && seen.size === 1, [...seen].join(","));
      else check(`${tag}: VenueCard autoplay advances (control)`, a !== null && seen.size > 1, [...seen].join(","));
      await ctx.close();
    } else check("a venue with >= 2 photos exists for the autoplay check", false);
    // 2. Sheet slide-in: the filters sheet's button position right after opening vs settled
    {
      const { ctx, page } = await open(reduced);
      await page.goto(`${BASE}/search`, { waitUntil: "domcontentloaded", timeout: 240000 });
      await page.getByTestId("search-filters").first().waitFor({ timeout: 120000 });
      await sleep(2000);
      await page.getByTestId("search-filters").first().click();
      const tops = [];
      const t0 = Date.now();
      while (Date.now() - t0 < 1500) {
        tops.push(await page.evaluate(() => { const el = document.querySelector('[data-testid="filters-sheet"]') || document.querySelector('[data-testid="filters-apply"]'); return el ? Math.round(el.getBoundingClientRect().top) : null; }));
        await sleep(40);
      }
      const shownTops = tops.filter((x) => x !== null);
      const distinct = new Set(shownTops);
      // RN-web may take a frame or two to mount; with reduce-motion the sheet must not glide through many positions
      if (reduced) check(`${tag}: Sheet appears without a slide (<= 2 positions)`, shownTops.length > 0 && distinct.size <= 2, [...distinct].slice(0, 8).join(","));
      else check(`${tag}: Sheet slides in (control: several positions)`, distinct.size > 2, [...distinct].slice(0, 8).join(","));
      await ctx.close();
    }
    // 3. Skeleton pulse (bookings list held back)
    {
      const { ctx, page } = await open(reduced, (c) => c.route("**/api/v1/bookings/mine**", async (rt) => { await sleep(20000); await rt.continue().catch(() => {}); }));
      await page.goto(`${BASE}/bookings`, { waitUntil: "domcontentloaded", timeout: 240000 });
      await page.locator('[aria-label="Bookings load ho rahi hain"],[data-testid="skeleton-list"]').first().waitFor({ timeout: 120000 }).catch(() => {});
      const ops = new Set();
      for (let i = 0; i < 12; i++) {
        ops.add(await page.evaluate(() => { const el = document.querySelector('[aria-label="Bookings load ho rahi hain"]') || document.querySelector('[data-testid="skeleton-list"]'); if (!el) return "none"; const blocks = [...el.querySelectorAll("div")]; return blocks.map((b) => getComputedStyle(b).opacity).join("|").slice(0, 120); }));
        await sleep(150);
      }
      if (reduced) check(`${tag}: Skeleton does not pulse`, ops.size === 1 && !ops.has("none"), ops.size);
      else check(`${tag}: Skeleton pulses (control)`, ops.size > 1, ops.size);
      await ctx.close();
    }
  }
  await browser.close();
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
