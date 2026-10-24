// Floodlight QA (Phase E): end-to-end journeys on the LOCAL backend with BOTH apps driven through the UI (never prod).
// Expo web must run with EXPO_PUBLIC_API_BASE_URL=http://localhost:8000.
// Run: PLAYWRIGHT_PATH=<...>/node_modules/playwright BASE=http://localhost:8095 API=http://localhost:8000 SHOTS=<dir> node e2e/qa-journey-live.cjs
// 1. player: search -> venue -> slot -> confirm -> "Book karo" (direct hold) -> pay screenshot -> waiting
//    owner (Approvals UI): approve (+ duplicate confirm) -> player (same open page, polling) sees booked + QR
// 2. reject: player holds + pays in the UI, owner rejects in the UI with a reason -> player sees the honest reason
// 3. expiry: owner timer set to the 5 min minimum for one hold (restored at once), the hold runs out -> pay + status say so
// 4. walk-in in the owner UI; 5. check-in by manual booking ID in the owner UI (the booking from 1)
// 6. staff without permission: only permitted tabs, deep link -> one "Ijazat nahi" screen, view_ledger staff -> settings read-only
// Test players are created through the local API (signup + DEV_FIXED_OTP) on first run.
const { chromium } = require(process.env.PLAYWRIGHT_PATH);
const fs = require("fs");
const os = require("os");
const path = require("path");

const BASE = process.env.BASE || "http://localhost:8095";
const API = `${process.env.API || "http://localhost:8000"}/api/v1`;
if (!/localhost|127\.0\.0\.1/.test(API)) throw new Error("QA journeys run against the LOCAL backend only");
const SHOTS = process.env.SHOTS || null;
const SKIP_EXPIRY = process.env.SKIP_EXPIRY === "1";
const PW = "demo-password-123";
const OTP = process.env.OTP || "111111";
const OWNER = "+923000000002";
const P_HAPPY = { phone: "+923000000031", name: "QA Journey Player", email: "qa.journey@example.com" };
const P_REJECT = { phone: "+923000000032", name: "QA Reject Player", email: "qa.reject@example.com" };
const P_EXPIRY = { phone: "+923000000033", name: "QA Expiry Player", email: "qa.expiry@example.com" };
const STAFF_PAYMENTS = "+923000000020"; // record_payments only
const STAFF_LEDGER = "+923000000021"; // view_ledger + check_in
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAACgAAAA8CAIAAACb22+3AAAAOElEQVR4nO3NQQkAAAgEsAtmMCMayxgiDPZfputExGKxWCwWi8VisVgsFovFYrFYLBaLxWLxp3gB8KnrRHLLp+oAAAAASUVORK5CYII=", "base64");
const PNG_PATH = path.join(os.tmpdir(), "qa-proof.png");
fs.writeFileSync(PNG_PATH, PNG);

const results = [];
function check(name, ok, extra) {
  results.push({ name, ok: !!ok });
  console.log((ok ? "PASS " : "FAIL ") + name + (extra !== undefined && extra !== "" ? "  " + String(extra).slice(0, 220) : ""));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function req(tok, method, p, body) {
  const r = await fetch(`${API}${p}`, { method, headers: { "content-type": "application/json", "X-Slot-Grid": "30", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let j;
  try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, body: j };
}
async function login(phone) {
  const r = await req(null, "POST", "/auth/login", { phone, password: PW, platform: "web" });
  if (r.status !== 200) throw new Error(`login ${phone} ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  return r.body;
}
async function ensurePlayer(p) {
  const l = await req(null, "POST", "/auth/login", { phone: p.phone, password: PW, platform: "web" });
  if (l.status === 200) return l.body;
  const s = await req(null, "POST", "/auth/signup", { phone: p.phone, name: p.name, email: p.email, city: "karachi", gender: "male", password: PW, confirm_password: PW, role: "player", terms_accepted: true });
  if (s.status >= 300 && s.body?.error?.code !== "SIGNUP_ALREADY_PENDING") throw new Error(`signup ${p.phone} ${s.status} ${JSON.stringify(s.body).slice(0, 200)}`);
  const v = await req(null, "POST", "/auth/verify-signup-otp", { phone: p.phone, otp: OTP });
  if (v.status >= 300) throw new Error(`verify ${p.phone} ${v.status} ${JSON.stringify(v.body).slice(0, 200)}`);
  return login(p.phone);
}
/** A player may always cancel held / payment_submitted: keep each QA player to ONE pending card in Approvals. */
async function clearPending(tok) {
  const mine = (await req(tok, "GET", "/bookings/mine?status=upcoming&page=1&page_size=100")).body;
  for (const b of Array.isArray(mine) ? mine : mine.items || []) if (b.status === "held" || b.status === "payment_submitted") await req(tok, "POST", `/bookings/${b.id}/cancel`, {});
}
async function newPage(browser, session) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: "Asia/Karachi", locale: "en-US" });
  await ctx.route(/^(?!https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/).*/, (route) => (/^(data|blob):/.test(route.request().url()) ? route.continue() : route.abort()));
  if (session) {
    await ctx.addInitScript(([tok, exp, user]) => {
      if (!localStorage.getItem("maidan.session_token")) {
        localStorage.setItem("maidan.session_token", tok);
        localStorage.setItem("maidan.session_expires_at", exp);
        localStorage.setItem("maidan.cached_user", JSON.stringify(user));
      }
    }, [session.token, session.expires_at, session.user]);
  }
  const page = await ctx.newPage();
  page.__errors = [];
  page.on("pageerror", (e) => page.__errors.push(String(e).slice(0, 200)));
  page.on("request", (r) => { if (!/^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/|data:|blob:)/.test(r.url())) page.__errors.push("external request " + r.url().slice(0, 80)); });
  return { ctx, page };
}
async function go(page, route, ms = 2500) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 240000 });
  try { await page.waitForLoadState("networkidle", { timeout: 15000 }); } catch {}
  await page.waitForTimeout(ms);
}
async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}
async function visible(page, testId, timeout = 30000) {
  try { await page.getByTestId(testId).first().waitFor({ state: "visible", timeout }); return true; } catch { return false; }
}
async function vis(loc) { const n = await loc.count(); for (let i = 0; i < n; i++) if (await loc.nth(i).isVisible()) return loc.nth(i); return null; }
async function textOf(page, testId) { try { return (await page.getByTestId(testId).first().innerText()).trim(); } catch { return ""; } }
async function waitFor(fn, t = 20000, step = 400) { const t0 = Date.now(); while (Date.now() - t0 < t) { if (await fn()) return true; await sleep(step); } return false; }
function pktDate(offset) { const n = new Date(Date.now() + 5 * 3600e3); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + offset)).toISOString().slice(0, 10); }
async function freeStart(tok, courtId, minSlots, dayOffset) {
  const r = await req(tok, "GET", `/courts/${courtId}/availability?date=${pktDate(dayOffset)}`);
  const slots = r.body.slots || [];
  for (let i = 0; i + minSlots <= slots.length; i++) {
    const run = slots.slice(i, i + minSlots);
    if (run.every((s) => s.status === "available") && Date.parse(run[0].starts_at) > Date.now() + 3600e3) return run[0].starts_at;
  }
  return null;
}
const ownerDetail = async (tok, id) => (await req(tok, "GET", `/owners/bookings/${id}/overview-detail`)).body;

/** Player UI: venue page -> pick a free start -> confirm sheet -> Book karo -> pay -> attach screenshot -> submit. Returns the booking id. */
async function playerBooksAndPays(page, tok, venue, courts, tag) {
  await go(page, "/search", 3500);
  check(`${tag}: search lists venue cards`, (await page.getByTestId("venue-card").count()) > 0);
  if (tag === "happy") await shot(page, "J1-search");
  await (await vis(page.getByText(venue.name, { exact: true }))).click();
  await page.waitForURL(/\/venue\//, { timeout: 30000 });
  check(`${tag}: venue page`, await visible(page, "venue-picker"));
  if (tag === "happy") await shot(page, "J1-venue");
  const court = tag === "happy" ? courts[courts.length - 1] : courts[0];
  await page.getByTestId(`court-${court.id}`).click();
  let picked = false;
  for (const off of [3, 4, 5, 6, 2]) {
    const d = pktDate(off);
    if (!(await page.getByTestId(`day-${d}`).count())) continue;
    await page.getByTestId(`day-${d}`).click();
    await page.waitForTimeout(2500);
    if ((await page.getByTestId("slot-open").count()) > 0) { picked = true; break; }
  }
  check(`${tag}: open slot chips for a day`, picked);
  if (!picked) return null;
  await page.getByTestId("slot-open").first().click();
  await page.waitForTimeout(2000);
  check(`${tag}: start selected (tick)`, (await page.getByTestId("slot-selected").count()) === 1);
  check(`${tag}: floating bar total from the server`, /PKR [\d,]+/.test(await textOf(page, "venue-book-bar")));
  if (tag === "happy") await shot(page, "J1-slot-picked");
  await page.getByTestId("venue-book").click();
  check(`${tag}: confirm sheet`, await visible(page, "confirm-hold", 15000));
  await page.waitForTimeout(800);
  const rows = await textOf(page, "confirm-rows");
  check(`${tag}: confirm sheet never says pakki/confirmed`, !/pakki|confirmed|court aap ka/i.test(rows));
  // the sheet's primary is the player orange (Sheet context re-provided)
  const bg = await page.getByTestId("confirm-hold").evaluate((el) => getComputedStyle(el).backgroundColor);
  check(`${tag}: confirm sheet primary is player orange`, bg === "rgb(255, 106, 43)", bg);
  if (tag === "happy") await shot(page, "J1-confirm-sheet");
  await page.getByTestId("confirm-hold").click();
  await page.waitForURL(/\/booking\/[0-9a-f-]+\/pay/, { timeout: 30000 });
  const id = page.url().match(/booking\/([0-9a-f-]+)\/pay/)[1];
  const held = await req(tok, "GET", `/bookings/${id}`);
  check(`${tag}: Book karo made a real hold (POST /bookings/hold)`, held.body.status === "held" && !!held.body.held_until, held.body.status);
  check(`${tag}: pay countdown`, await visible(page, "pay-countdown"));
  if (tag === "happy") await shot(page, "J1-pay");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 20000 }), page.getByTestId("pay-pick").click()]);
  await chooser.setFiles(PNG_PATH);
  check(`${tag}: screenshot attached`, await visible(page, "pay-picked", 20000));
  await page.getByTestId("pay-submit").click();
  await page.waitForURL(/\/booking\/[0-9a-f-]+\/done/, { timeout: 60000 });
  await page.waitForTimeout(2500);
  const t = await textOf(page, "status-title");
  check(`${tag}: waiting status is honest (not pakki)`, /Payment bhej di/.test(t) && !/pakki|court aap ka/i.test(t), t);
  check(`${tag}: no QR before booked`, (await page.getByRole("img", { name: "Check-in QR code" }).count()) === 0);
  if (tag === "happy") await shot(page, "J1-waiting");
  return id;
}

/** Owner UI (Approvals): the card of `playerName` -> Approve or Reject. */
async function ownerActs(browser, owner, playerName, action, bookingId) {
  const { ctx, page } = await newPage(browser, owner);
  await go(page, "/approvals", 5000);
  await page.getByTestId("approvals-count").first().waitFor({ timeout: 120000 });
  let card = null;
  await waitFor(async () => { card = await vis(page.getByLabel(`${playerName} approval`, { exact: true })); return !!card; }, 30000, 1000);
  check(`owner ${action}: the player's card is in Approvals`, !!card);
  if (!card) { await ctx.close(); return; }
  await card.scrollIntoViewIfNeeded();
  if (action === "approve") {
    await shot(page, "J1-owner-approvals");
    await card.getByRole("button", { name: "Approve", exact: true }).click();
    await page.waitForTimeout(1200);
    const sheetBtn = await vis(page.getByRole("button", { name: "Approve karein" }));
    check("owner approve: approve sheet opens", !!sheetBtn);
    if (sheetBtn) {
      const bg = await sheetBtn.evaluate((el) => getComputedStyle(el).backgroundColor);
      check("owner approve: sheet primary is owner teal (never orange)", bg === "rgb(14, 124, 116)", bg);
      await shot(page, "J1-owner-approve-sheet");
      await sheetBtn.click();
      await page.waitForTimeout(2000);
      if (await page.getByTestId("duplicate-confirm").count()) {
        check("owner approve: duplicate screenshot gets its own confirm", true);
        await shot(page, "J1-owner-duplicate-confirm");
        await (await vis(page.getByRole("button", { name: "Phir bhi approve karein" }))).click();
      }
    }
    const ok = await waitFor(async () => (await ownerDetail(owner.token, bookingId)).row?.status_key === "booked", 20000);
    check("owner approve: booking is booked on the server", ok);
  } else {
    await card.getByRole("button", { name: "Reject", exact: true }).click();
    await page.waitForTimeout(1200);
    const radio = await vis(page.getByRole("radio", { name: "Screenshot parha nahi ja raha" }));
    check("owner reject: reason radios", !!radio);
    if (radio) {
      await radio.click();
      await page.waitForTimeout(500);
      const checkedNow = await page.evaluate(() => [...document.querySelectorAll('[role="radio"][aria-checked="true"]')].map((e) => e.getAttribute("aria-label")));
      check("owner reject: chosen reason has aria-checked=true (only that one)", checkedNow.length === 1 && /Screenshot parha nahi ja raha/.test(checkedNow[0] || ""), JSON.stringify(checkedNow));
      await shot(page, "J2-owner-reject-sheet");
      const rb = await vis(page.getByRole("button", { name: "Reject karein" }));
      const bg = await rb.evaluate((el) => getComputedStyle(el).backgroundColor);
      check("owner reject: confirm is a danger button, not orange", bg !== "rgb(255, 106, 43)", bg);
      await rb.click();
    }
    const ok = await waitFor(async () => (await ownerDetail(owner.token, bookingId)).row?.status_key === "cancelled", 20000);
    check("owner reject: booking cancelled on the server", ok);
  }
  check(`owner ${action}: no page errors / external requests`, page.__errors.length === 0, page.__errors.join(" | "));
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const owner = await login(OWNER);
  const venue = (await req(owner.token, "GET", "/owners/venues")).body[0];
  const venueDetail = (await req(owner.token, "GET", `/venues/by-slug/${venue.slug}`)).body;
  const courts = venueDetail.courts.filter((c) => c.is_active);
  const pHappy = await ensurePlayer(P_HAPPY);
  const pReject = await ensurePlayer(P_REJECT);
  const pExpiry = await ensurePlayer(P_EXPIRY);
  for (const p of [pHappy, pReject, pExpiry]) await clearPending(p.token);

  // ---- 3 (started first). Expiry: one hold under the 5-minute minimum timer, then the timer goes straight back ----
  let expiryId = null;
  if (!SKIP_EXPIRY) {
    const before = (await req(owner.token, "GET", `/owners/venues/${venue.id}/timers`)).body.values;
    const set = await req(owner.token, "PUT", `/owners/venues/${venue.id}/timers`, { ...before, hold_minutes: 5 });
    check("expiry: owner timer set to the 5 min minimum (temporarily)", set.status === 200, set.status);
    const start = await freeStart(pExpiry.token, courts[0].id, 2, 6);
    const h = await req(pExpiry.token, "POST", "/bookings/hold", { court_id: courts[0].id, starts_at: start, slot_count: 2 });
    const restore = await req(owner.token, "PUT", `/owners/venues/${venue.id}/timers`, before);
    check("expiry: timer restored right after the hold", restore.status === 200 && JSON.stringify(restore.body.values) === JSON.stringify(before), JSON.stringify(restore.body.values));
    check("expiry: 5 min hold created", h.status === 201, h.status);
    expiryId = h.body.booking?.id;
    if (expiryId) {
      // keep the bank details like the app does after its own hold
      fs.writeFileSync(path.join(os.tmpdir(), "qa-expiry.json"), JSON.stringify({ id: expiryId, pi: h.body.payment_instructions, held_until: h.body.booking.held_until }));
    }
  }

  // ---- 1. Happy path ----
  let happyId = null;
  {
    const { ctx, page } = await newPage(browser, pHappy);
    happyId = await playerBooksAndPays(page, pHappy.token, venue, courts, "happy");
    if (happyId) {
      await ownerActs(browser, owner, P_HAPPY.name, "approve", happyId);
      let t = "";
      await waitFor(async () => { t = await textOf(page, "status-title"); return /Court aap ka hai/.test(t); }, 40000, 1500);
      check("happy: player sees 'Court aap ka hai!' after the owner's UI approval (polling)", /Court aap ka hai/.test(t), t);
      check("happy: QR ticket shown only now", (await page.getByRole("img", { name: "Check-in QR code" }).count()) === 1);
      await page.waitForTimeout(3500);
      await shot(page, "J1-booked-qr");
      const b = await req(pHappy.token, "GET", `/bookings/${happyId}`);
      check("happy: server status booked", b.body.status === "booked", b.body.status);
    }
    check("happy: no page errors / external requests (player)", page.__errors.length === 0, page.__errors.join(" | "));
    await ctx.close();
  }

  // ---- 2. Reject path ----
  {
    const { ctx, page } = await newPage(browser, pReject);
    const id = await playerBooksAndPays(page, pReject.token, venue, courts, "reject");
    if (id) {
      await ownerActs(browser, owner, P_REJECT.name, "reject", id);
      let t = "";
      await waitFor(async () => { t = await textOf(page, "status-title"); return /Venue ne booking nahi li/.test(t); }, 40000, 1500);
      check("reject: player sees 'Venue ne booking nahi li' (polling)", /Venue ne booking nahi li/.test(t) && !/pakki|court aap ka/i.test(t), t);
      const reason = await textOf(page, "status-reason");
      check("reject: player sees the venue's own reason", /Screenshot parha nahi ja raha/.test(reason), reason);
      check("reject: next step offered + no QR", (await visible(page, "status-rebook", 5000)) && (await page.getByRole("img", { name: "Check-in QR code" }).count()) === 0);
      await shot(page, "J2-player-rejected");
    }
    check("reject: no page errors / external requests (player)", page.__errors.length === 0, page.__errors.join(" | "));
    await ctx.close();
  }

  // ---- 4. Walk-in (owner UI) ----
  let walkinId = null;
  {
    const { ctx, page } = await newPage(browser, owner);
    await go(page, "/walkin", 5000);
    await page.getByText("Walk-in booking").first().waitFor({ timeout: 120000 });
    await (await vis(page.getByRole("button", { name: /^Kal/ }))).click();
    await page.waitForTimeout(2500);
    const open = page.getByRole("button", { name: /, khaali$/ });
    const n = await open.count();
    check("walk-in: free slots offered for tomorrow", n > 0, n);
    if (n > 0) {
      await open.nth(Math.min(6, n - 1)).click();
      await page.waitForTimeout(1500);
      const name = `QA Walkin ${Date.now() % 100000}`;
      await page.getByTestId("walkin-name").fill(name);
      await page.waitForTimeout(600);
      const bg = await page.getByTestId("walkin-save").evaluate((el) => getComputedStyle(el).backgroundColor);
      check("walk-in: save button is owner teal", bg === "rgb(14, 124, 116)", bg);
      await shot(page, "J4-walkin-form");
      await page.getByTestId("walkin-save").click();
      await page.waitForTimeout(3500);
      const day = pktDate(1);
      const h = await req(owner.token, "GET", `/owners/bookings-history?date_from=${day}&date_to=${day}&q=${encodeURIComponent(name)}&page=1&page_size=20`);
      const row = (h.body.items || []).find((r) => r.player_name === name);
      walkinId = row && row.booking_id;
      check("walk-in: booking created on the server", !!row);
      check("walk-in: screen closed after save", !/walkin/.test(page.url()), page.url());
    }
    await ctx.close();
  }

  // ---- 5. Check-in by manual booking ID (owner UI), the booking the player just got approved ----
  {
    const { ctx, page } = await newPage(browser, owner);
    await go(page, "/checkin-scan", 5000);
    await page.getByTestId("checkin-code").first().waitFor({ timeout: 120000 });
    const target = happyId || walkinId;
    await page.getByTestId("checkin-code").fill(target);
    await page.getByTestId("checkin-submit").click();
    await waitFor(async () => (await page.getByTestId("checkin-done").count()) > 0 || (await page.getByTestId("checkin-error").count()) > 0, 15000);
    await shot(page, "J5-checkin-done");
    const d = (await ownerDetail(owner.token, target)).row;
    const err = (await page.getByTestId("checkin-error").count()) ? await page.getByTestId("checkin-error").innerText() : "";
    check("check-in: manual full booking ID checks the booking in", (await page.getByTestId("checkin-done").count()) === 1 && d && d.checked_in === true, err);
    await ctx.close();
  }

  // ---- 6. Staff without permission ----
  {
    const s = await login(STAFF_PAYMENTS);
    const { ctx, page } = await newPage(browser, s);
    await go(page, "/", 6000);
    await waitFor(async () => (await page.getByTestId("owner-tabbar").count()) > 0, 60000);
    const tabs = (await page.getByTestId("owner-tabbar").getByRole("tab").allInnerTexts()).map((t) => t.trim().split(/\n/).pop());
    check("staff (record_payments): only the Aur tab, no walk-in FAB", tabs.join("|") === "Aur" && (await page.getByTestId("owner-fab-walkin").count()) === 0, tabs.join("|"));
    await shot(page, "J6-staff-limited");
    for (const route of ["/approvals", "/ledger", "/walkin"]) {
      await go(page, route, 4000);
      const ok = await waitFor(async () => (await page.getByTestId("no-access").count()) > 0, 30000);
      check(`staff (record_payments): deep link ${route} -> one "Ijazat nahi" screen`, ok && (await page.getByText("Ye hissa aap ke liye band hai").count()) === 1);
    }
    await shot(page, "J6-staff-ijazat-nahi");
    await ctx.close();
  }
  {
    const s = await login(STAFF_LEDGER);
    const { ctx, page } = await newPage(browser, s);
    await go(page, "/", 6000);
    await waitFor(async () => (await page.getByTestId("owner-tabbar").count()) > 0, 60000);
    const tabs = (await page.getByTestId("owner-tabbar").getByRole("tab").allInnerTexts()).map((t) => t.trim().split(/\n/).pop());
    // owner-access: Overview / Approvals / Ledger read through view_ledger; no walkin permission -> no FAB
    check("staff (view_ledger + check_in): Aaj, Approvals, Paisa, Aur and no walk-in FAB", tabs.join("|") === "Aaj|Approvals|Paisa|Aur" && (await page.getByTestId("owner-fab-walkin").count()) === 0, tabs.join("|"));
    await go(page, "/walkin", 4000);
    check("staff (view_ledger): deep link /walkin -> Ijazat nahi", await waitFor(async () => (await page.getByTestId("no-access").count()) > 0, 30000));
    await go(page, "/venue-settings", 6000);
    await waitFor(async () => (await page.getByTestId("venue-settings-read-only-note").count()) > 0, 60000);
    const editable = await page.evaluate(() => [...document.querySelectorAll("input,textarea")].filter((e) => e.getBoundingClientRect().width > 0 && !e.readOnly && !e.disabled).length);
    const saves = await page.getByText(/^Save /).count();
    check("staff (view_ledger): venue settings read-only (note, no editable input, no Save)", editable === 0 && saves === 0, `editable=${editable} saves=${saves}`);
    await shot(page, "J6-staff-settings-readonly");
    await ctx.close();
  }

  // ---- 3 (finish). Expiry ----
  if (expiryId) {
    const { held_until, pi } = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), "qa-expiry.json"), "utf8"));
    const { ctx, page } = await newPage(browser, pExpiry);
    await go(page, "/", 2000);
    await page.evaluate(([id, p]) => {
      const k = "maidan.payment_instructions";
      const cur = JSON.parse(localStorage.getItem(k) || '{"state":{"paymentInstructionsByBookingId":{}},"version":1}');
      cur.state.paymentInstructionsByBookingId[id] = { ...p, saved_at: Date.now() };
      localStorage.setItem(k, JSON.stringify(cur));
    }, [expiryId, pi]);
    await go(page, `/booking/${expiryId}/pay`, 3500);
    check("expiry: pay screen live with a countdown before the end", await visible(page, "pay-countdown", 20000));
    await shot(page, "J3-pay-before-expiry");
    const wait = Date.parse(held_until) - Date.now() + 8000;
    console.log(`expiry: waiting ${Math.round(wait / 1000)} s for the real hold to run out`);
    if (wait > 0) await sleep(wait);
    let body = "";
    await waitFor(async () => { body = await page.locator("body").innerText(); return /Hold ka waqt khatam/.test(body); }, 30000, 1000);
    check("expiry: the OPEN pay screen flips to 'Hold ka waqt khatam' (no upload)", /Hold ka waqt khatam/.test(body) && (await page.getByTestId("pay-submit").count()) === 0, body.slice(0, 120).replace(/\n/g, " / "));
    await shot(page, "J3-pay-expired");
    await go(page, `/booking/${expiryId}/done`, 4000);
    const t = await textOf(page, "status-title");
    check("expiry: status says 'Waqt khatam ho gaya' with the reason", /Waqt khatam ho gaya/.test(t) && /screenshot nahi aaya/i.test(await textOf(page, "status-reason")), t);
    const b = await req(pExpiry.token, "GET", `/bookings/${expiryId}`);
    check("expiry: server no longer holds it", b.body.status !== "held" || Date.parse(b.body.held_until) < Date.now(), b.body.status);
    await shot(page, "J3-status-expired");
    await ctx.close();
  }

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
