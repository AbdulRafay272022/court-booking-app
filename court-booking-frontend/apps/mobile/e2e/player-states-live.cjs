// Floodlight M1: PStates board on the real player screens (local backend; failures are injected in the browser only).
// Skeleton (a slow /bookings/mine), ErrorState (a 500), OfflineBanner (/health unreachable), NotFound (unknown venue).
// Run: PLAYWRIGHT_PATH=<...> BASE=http://localhost:8092 API=http://localhost:8000 SHOTS=<dir> node e2e/player-states-live.cjs
const { chromium } = require(process.env.PLAYWRIGHT_PATH);
const fs = require("fs");
const path = require("path");
const BASE = process.env.BASE || "http://localhost:8092";
const API = `${process.env.API || "http://localhost:8000"}/api/v1`;
if (!/localhost|127\.0\.0\.1/.test(API)) throw new Error("local backend only");
const SHOTS = process.env.SHOTS || null;
const results = [];
const check = (n, ok, x) => { results.push(ok); console.log((ok ? "PASS " : "FAIL ") + n + (x ? "  " + String(x).slice(0, 160) : "")); };

(async () => {
  const r = await fetch(`${API}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: "+923000000010", password: "demo-password-123", platform: "web" }) });
  const s = await r.json();
  const browser = await chromium.launch({ headless: true });
  async function page(setup) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: "Asia/Karachi" });
    await ctx.route(/^(?!https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/).*/, (rt) => (/^(data|blob):/.test(rt.request().url()) ? rt.continue() : rt.abort()));
    await ctx.addInitScript(([tok, exp, user]) => {
      localStorage.setItem("maidan.session_token", tok);
      localStorage.setItem("maidan.session_expires_at", exp);
      localStorage.setItem("maidan.cached_user", JSON.stringify(user));
    }, [s.token, s.expires_at, s.user]);
    if (setup) await setup(ctx);
    return { ctx, p: await ctx.newPage() };
  }
  const shot = async (p, n) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, `${n}.png`) }); } };

  {
    const { ctx, p } = await page((c) => c.route("**/api/v1/bookings/mine**", async (rt) => { await new Promise((z) => setTimeout(z, 15000)); await rt.continue(); }));
    await p.goto(`${BASE}/bookings`, { waitUntil: "domcontentloaded", timeout: 240000 });
    await p.waitForTimeout(6000);
    const body = await p.locator("body").innerText();
    check("loading: skeleton cards, never a fake 0", (await p.getByLabel("Bookings load ho rahi hain").count()) > 0 && !/Aane wali · 0/.test(body));
    await shot(p, "PStates-skeleton");
    await ctx.close();
  }
  {
    const { ctx, p } = await page((c) => c.route("**/api/v1/bookings/mine**", (rt) => rt.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL", message: "boom" } }) })));
    await p.goto(`${BASE}/bookings`, { waitUntil: "domcontentloaded", timeout: 240000 });
    await p.getByTestId("error-retry").first().waitFor({ timeout: 60000 }).catch(() => {});
    const body = await p.locator("body").innerText();
    check("error: ErrorState with 'Dobara koshish' + plain 5xx copy", (await p.getByTestId("error-retry").count()) > 0 && /Kuch gadbad ho gayi/.test(body) && /Server mein abhi masla hai/.test(body), body.slice(0, 120).replace(/\n/g, " / "));
    await shot(p, "PStates-error");
    await ctx.close();
  }
  {
    const { ctx, p } = await page((c) => c.route("**/health", (rt) => rt.abort()));
    await p.goto(`${BASE}/bookings`, { waitUntil: "domcontentloaded", timeout: 240000 });
    await p.getByTestId("offline-banner").first().waitFor({ timeout: 60000 }).catch(() => {});
    check("offline: inline banner 'Internet nahi hai' + Retry", (await p.getByTestId("offline-banner").count()) > 0 && /Internet nahi hai/.test(await p.locator("body").innerText()));
    await p.waitForTimeout(1500);
    await shot(p, "PStates-offline");
    await ctx.close();
  }
  {
    const { ctx, p } = await page();
    await p.goto(`${BASE}/venue/this-venue-does-not-exist`, { waitUntil: "domcontentloaded", timeout: 240000 });
    await p.getByTestId("not-found").first().waitFor({ timeout: 60000 }).catch(() => {});
    check("404: NotFound 'Out!' with Home button", (await p.getByTestId("not-found").count()) > 0 && /Out!/.test(await p.locator("body").innerText()));
    await shot(p, "PStates-404");
    await ctx.close();
  }
  await browser.close();
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
