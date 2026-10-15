#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Dumps the VISIBLE text of every route (public, player, owner) in each language to a JSON file, for two uses:
 *  1. English regression: dump `en` before and after a change and diff (English mode must not change).
 *  2. The Roman Urdu English-word scan (e2e/ru-scan.cjs): same tokens in `en` and `ru` = left untranslated.
 * Usage: BASE_URL=http://localhost:3000 API_URL=http://localhost:8000 OUT=dump.json node e2e/text-dump.cjs
 * Logins use the seeded demo accounts (OWNER_PHONE / PLAYER_PHONE digits after +92, DEMO_PASSWORD); skip a role by leaving it unset.
 */
const fs = require("fs");
const { loadPlaywright } = require("./smoke.cjs");

const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const API = (process.env.API_URL || "http://localhost:8000").replace(/\/+$/, "");
const OUT = process.env.OUT || "dump.json";
const LANGS = (process.env.LANGS || "en,ru").split(",");
const PASSWORD = process.env.DEMO_PASSWORD || "demo-password-123";
const OWNER = process.env.OWNER_PHONE || "3000000002";
const PLAYER = process.env.PLAYER_PHONE || "3000000003";

const PUBLIC = ["/", "/features", "/for-owners", "/about", "/blog", "/contact", "/login", "/signup", "/signup?role=owner", "/search", "/forgot-password", "/verify?phone=%2B923001234567", "/reset-password?phone=%2B923001234567", "/terms", "/privacy"];
const PLAYER_ROUTES = ["/bookings", "/account", "/account?tab=bookings", "/account?tab=saved", "/account?tab=settings", "/account/phone"];
const OWNER_ROUTES = [
  "/dashboard/owner/today", "/dashboard/owner/approvals", "/dashboard/owner/ledger", "/dashboard/owner/growth",
  "/dashboard/owner/checkin", "/dashboard/owner/checkin/qr", "/dashboard/owner/checkin/manual", "/dashboard/owner/reviews", "/dashboard/owner/refunds",
  "/dashboard/owner/staff", "/dashboard/owner/premium", "/dashboard/owner/settings", "/dashboard/owner/settings#courts",
  "/venue-setup/register", "/venue-setup/courts", "/venue-setup/status", "/account",
];

async function createHold() {
  const A = API + "/api/v1";
  const H = { "Content-Type": "application/json", "X-Slot-Grid": "30" };
  const login = await (await fetch(A + "/auth/login", { method: "POST", headers: H, body: JSON.stringify({ phone: "+92" + PLAYER, password: PASSWORD }) })).json();
  const AH = { ...H, Authorization: "Bearer " + login.token };
  const list = await (await fetch(A + "/venues?per_page=50")).json();
  const ven = list.venues.find((v) => v.name === "Demo Arena") || list.venues[0];
  const detail = await (await fetch(A + "/venues/by-slug/" + ven.slug)).json();
  const court = detail.courts[0];
  const day = 4 + Math.floor(Math.random() * 40);
  const date = new Date(Date.now() + day * 864e5 + 5 * 36e5).toISOString().slice(0, 10);
  const av = await (await fetch(A + `/courts/${court.id}/availability?date=${date}`, { headers: AH })).json();
  const free = (av.slots || []).filter((s) => s.status === "available");
  const pick = free[Math.floor(Math.random() * Math.max(1, free.length - 4))];
  const res = await fetch(A + "/bookings/hold", { method: "POST", headers: AH, body: JSON.stringify({ court_id: court.id, starts_at: pick.starts_at, slot_count: av.min_slots || 2 }) });
  const j = await res.json();
  return j.booking && j.booking.id;
}

async function visibleText(page) {
  return page.evaluate(() => document.body.innerText.replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim());
}

async function login(context, phone) {
  const page = await context.newPage();
  await page.goto(BASE + "/login", { waitUntil: "networkidle" });
  await page.locator("input[type=tel]").fill(phone);
  await page.locator("input[type=password]").first().fill(PASSWORD);
  await page.locator("button[type=submit]").click();
  await page.waitForTimeout(3000);
  await page.close();
}

async function dumpRoutes(browser, lang, routes, role, result) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([{ name: "khelo_lang", value: lang, url: BASE }]);
  if (role) await login(context, role);
  const page = await context.newPage();
  for (const route of routes) {
    const key = (role ? (role === OWNER ? "owner:" : "player:") : "public:") + route.replace(/\/booking\/[0-9a-f-]{36}\//, "/booking/<id>/");
    try {
      const [path, action] = route.split("#");
      await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForTimeout(1200);
      if (action === "courts") {
        await page.getByRole("tab", { name: /courts|court/i }).first().click().catch(() => {});
        await page.waitForTimeout(1800);
      }
      // open every <details>, tab and dialog-less disclosure that is cheap to open, so hidden copy is dumped too
      await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
      (result[key] ||= {})[lang] = await visibleText(page);
    } catch (e) {
      (result[key] ||= {})[lang] = "ERROR: " + String(e.message).split("\n")[0];
    }
  }
  await context.close();
}

module.exports = { PUBLIC, PLAYER_ROUTES, OWNER_ROUTES, BASE, OWNER, PLAYER, PASSWORD, login, createHold };

if (require.main === module) (async () => {
  const pw = loadPlaywright();
  const browser = await pw.chromium.launch();
  const result = {};
  const publicRoutes = [...PUBLIC];
  try {
    const data = await (await fetch(API + "/api/v1/venues?per_page=1")).json();
    if (data.venues && data.venues[0]) publicRoutes.push("/venues/" + data.venues[0].slug);
  } catch {}
  for (const lang of LANGS) {
    await dumpRoutes(browser, lang, publicRoutes, null, result);
    if (PLAYER) {
      let bookingId = null;
      try {
        bookingId = await createHold();
      } catch {}
      const routes = [...PLAYER_ROUTES];
      if (bookingId) routes.push(`/booking/${bookingId}/chat`, `/booking/${bookingId}/pay`, `/booking/${bookingId}/done`, `/booking/${bookingId}/checkin`);
      await dumpRoutes(browser, lang, routes, PLAYER, result);
    }
    if (OWNER) await dumpRoutes(browser, lang, OWNER_ROUTES, OWNER, result);
  }
  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify(result, null, 1), "utf8");
  console.log(`wrote ${OUT}: ${Object.keys(result).length} routes x ${LANGS.join("/")}`);
})();
