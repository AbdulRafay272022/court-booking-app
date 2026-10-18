#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Bookings history + detail popup check (plain Node + Playwright). The API is MOCKED with page.route, so no backend is needed.
 * Run against a PRODUCTION build served from a COPY of apps/web (never next dev):
 *   BASE_URL=http://localhost:3802 node e2e/history-check.cjs
 * Covers en and ru at 360/768/1280: filters in the URL, presets, sorting, pagination, CSV request, detail popup, focus trap, Escape,
 * copy ID, completion popup, no horizontal scroll, no console errors.
 */
const { loadPlaywright } = require("./smoke.cjs");

const BASE = (process.env.BASE_URL || "http://localhost:3802").replace(/\/+$/, "");
const SHOTS = process.env.SHOT_DIR || require("os").tmpdir();
const ID = "3b9a41d7-1111-4222-8333-444455556666";
const VENUE = { id: "v1", name: "Arena Khelo", status: "approved", sports: ["Padel"], courts: [{ id: "c1", name: "Court 1", sport: "Padel" }, { id: "c2", name: "Court 2", sport: "Padel" }] };
const iso = (h, m = 0) => new Date(Date.UTC(2026, 9, 16, h - 5, m)).toISOString();

function row(over) {
  return {
    booking_id: ID, short_code: "KH-3B9A41D7", kind: "booked", status_key: "booked", player_name: "Usman Tariq", player_phone: null,
    court_id: "c1", court_name: "Court 1", starts_at: iso(18), ends_at: iso(19), duration_minutes: 60, slot_count: 2, total: 3000, advance: 1500,
    due: 1500, total_paid: 1500, source: "app", checked_in: false, completion: null, slot_ended: true, original_booking_id: null, refund_amount: null, refund_status: null, ...over,
  };
}
const ROWS = [row({}), row({ booking_id: "91c07e2a-0000-4000-8000-000000000001", short_code: "KH-91C07E2A", player_name: "Ayesha Khan", total: 4500, due: 2500, total_paid: 2000 })];
const DETAIL = {
  row: ROWS[0], booked_at: iso(17, 12), hold_expires_at: null, advance_required: 1500, payment_id: "p1", ocr_verdict: "match", ocr_amount: 1500,
  approval: { verdict: "approved", by_name: "Owner", at: iso(17, 20), reason: null, auto: false }, cancellation: null, refund: null, completion: null,
  timeline: [{ at: iso(17, 12), kind: "held" }, { at: iso(17, 14), kind: "proof_submitted", amount: 1500 }, { at: iso(17, 20), kind: "approved" }, { at: iso(19), kind: "mystery_kind" }],
};

async function run() {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  const fails = [];
  const check = (ok, msg) => { if (!ok) fails.push(msg); };
  for (const lang of ["en", "ru"]) {
    for (const width of [360, 768, 1280]) {
      const tag = `${lang}@${width}`;
      const ctx = await browser.newContext({ viewport: { width, height: 900 } });
      await ctx.addCookies([{ name: "khelo_lang", value: lang, url: BASE }]);
      await ctx.addInitScript(() => {
        localStorage.setItem("maidan.session_token", "t");
        localStorage.setItem("maidan.session_expires_at", new Date(Date.now() + 7 * 3600e3).toISOString());
      });
      const page = await ctx.newPage();
      const errors = [];
      const requests = [];
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      page.on("pageerror", (e) => errors.push(e.message));
      const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      await page.route("**/api/v1/auth/me", (r) => r.fulfill(json({ user: { id: "u1", role: "owner", name: "Owner", phone: "+923000000002" }, session: {} })));
      await page.route("**/api/v1/owners/venues", (r) => r.fulfill(json([VENUE])));
      await page.route("**/api/v1/owners/bookings-history/export.csv*", (r) => { requests.push(r.request().url()); r.fulfill({ status: 200, contentType: "text/csv", body: "a,b\n1,2\n" }); });
      await page.route("**/api/v1/owners/bookings-history?*", (r) => { requests.push(r.request().url()); r.fulfill(json({ items: ROWS, total: 60, page: 1, page_size: 25, totals: { count: 60, total: 180000, collected: 120000, due: 60000 } })); });
      await page.route("**/api/v1/owners/bookings/*/overview-detail", (r) => r.fulfill(json(DETAIL)));
      await page.route("**/api/v1/owners/bookings/*/completion", (r) => { requests.push("completion:" + r.request().postData()); r.fulfill(json({ ...ROWS[1], completion: { result: "no", received_pkr: 2000, reason: null, marked_at: iso(20), marked_by_name: "Owner" } })); });
      await page.route("**/api/v1/payments/p1/proof-url", (r) => r.fulfill(json({ url: "data:image/gif;base64,R0lGODlhAQABAAAAACw=", expires_in: 60 })));

      await page.goto(`${BASE}/dashboard/bookings`, { waitUntil: "networkidle" });
      await page.waitForSelector("h1");
      check((await page.locator("h1").count()) === 1, `${tag}: one h1`);
      check((await page.locator("text=Usman Tariq").count()) > 0, `${tag}: rows render`);
      const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check((await overflow()) <= 1, `${tag}: no horizontal scroll`);
      await page.screenshot({ path: `${SHOTS}/hist-${tag}.png`, fullPage: true });

      // presets and URL
      await page.getByRole("button", { name: lang === "en" ? "This month" : "Is mahine" }).click();
      await page.waitForFunction(() => location.search.includes("from=2026-10-01") || location.search.includes("from="));
      check(/from=\d{4}-\d{2}-01&to=\d{4}-\d{2}-\d{2}/.test(page.url()), `${tag}: month preset in URL`);

      // search is debounced into the URL
      await page.locator("#hist-search").fill("usman");
      await page.waitForFunction(() => location.search.includes("q=usman"));

      // sort (table only)
      const sortBtn = page.locator("th button").nth(2);
      if (await sortBtn.count()) {
        await sortBtn.click();
        await page.waitForFunction(() => decodeURIComponent(location.search).includes("sort=total:asc"));
      }

      // pagination
      await page.getByRole("button", { name: lang === "en" ? "Next" : "Agla", exact: true }).click();
      await page.waitForFunction(() => location.search.includes("page=2"));
      await page.waitForTimeout(500);
      check(requests.some((u) => u.includes("page=2")), `${tag}: page 2 requested`);

      // CSV
      await page.getByRole("button", { name: lang === "en" ? "Download CSV" : "CSV download karein" }).click();
      await page.waitForTimeout(400);
      check(requests.some((u) => u.includes("export.csv")), `${tag}: csv requested`);

      // detail popup
      await page.getByRole("button", { name: "Usman Tariq" }).first().click();
      const dlg = page.getByRole("dialog").first();
      await dlg.waitFor();
      check((await dlg.getByText("KH-3B9A41D7").count()) > 0, `${tag}: detail short code`);
      // Round 2 (A2): a row click opens the popup without writing ?booking= (that link only highlights).
      check(!/booking=/.test(page.url()), `${tag}: row click does not put booking in URL`);
      for (let i = 0; i < 25; i++) await page.keyboard.press("Tab");
      check(await page.evaluate(() => !!document.activeElement.closest('[role="dialog"]')), `${tag}: focus stays in dialog`);
      await page.screenshot({ path: `${SHOTS}/detail-${tag}.png` });
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
      check(!/booking=/.test(page.url()), `${tag}: Escape closes, URL unchanged`);

      // completion popup from the dropdown
      const sel = page.locator("select[aria-label]").first();
      if (await sel.count()) {
        await sel.selectOption("no");
        await page.getByRole("dialog").waitFor();
        await page.locator("input[inputmode=numeric]").fill("2000");
        await page.getByRole("button", { name: lang === "en" ? "Save" : "Save karein" }).click();
        await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
        check(requests.some((u) => u.startsWith("completion:") && u.includes('"received_pkr":2000')), `${tag}: completion posted`);
      }
      check((await overflow()) <= 1, `${tag}: no horizontal scroll at end`);
      // Endpoints this script does not mock (flags, badges, notifications) have no server behind the build's API base: ignore only those refusals.
      const realErrors = errors.filter((e) => !/ERR_CONNECTION_REFUSED/.test(e));
      check(realErrors.length === 0, `${tag}: console errors: ${realErrors.slice(0, 2).join(" | ")}`);
      await ctx.close();
    }
  }
  await browser.close();
  if (fails.length) {
    console.log("FAIL\n  " + fails.join("\n  "));
    process.exit(1);
  }
  console.log("PASS");
}
run().catch((e) => { console.error(e); process.exit(2); });
