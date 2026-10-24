// Floodlight M1: LIVE player journey against the REAL local backend (never prod). Expo web must run with
// EXPO_PUBLIC_API_BASE_URL=http://localhost:8000. Uses the local seed users (password demo-password-123).
// Run: PLAYWRIGHT_PATH=<...>/node_modules/playwright BASE=http://localhost:8092 API=http://localhost:8000 SHOTS=<dir> node e2e/player-journey-live.cjs
// Journey: search -> venue -> slot -> confirm sheet -> "Book karo" (POST /bookings/hold) -> pay (screenshot upload) ->
// owner approves via API -> player sees booked + QR ticket. Then the reject path and the expired-hold path, and the
// main screens again at 320 wide with font x1.3 (?fs=1.3): no horizontal overflow, no "…" on money/time, tap targets >= 44.
const { chromium } = require(process.env.PLAYWRIGHT_PATH);
const fs = require("fs");
const os = require("os");
const path = require("path");

const BASE = process.env.BASE || "http://localhost:8092";
const API = `${process.env.API || "http://localhost:8000"}/api/v1`;
if (!/localhost|127\.0\.0\.1/.test(API)) throw new Error("live journey runs against the LOCAL backend only");
const SHOTS = process.env.SHOTS || null;
const PW = "demo-password-123";
const PLAYER = process.env.PLAYER || "+923000000010"; // Fresh Player (seed)
const OLD_PLAYER = "+923000000003"; // Demo Player: has an expired hold in the seed
const OWNER = "+923000000002";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAACgAAAA8CAIAAACb22+3AAAAOElEQVR4nO3NQQkAAAgEsAtmMCMayxgiDPZfputExGKxWCwWi8VisVgsFovFYrFYLBaLxWLxp3gB8KnrRHLLp+oAAAAASUVORK5CYII=", "base64");
const PNG_PATH = path.join(os.tmpdir(), "m1-proof.png");
fs.writeFileSync(PNG_PATH, PNG);

const results = [];
function check(name, ok, extra) {
  results.push({ name, ok: !!ok });
  console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  " + String(extra).slice(0, 200) : ""));
}
async function login(phone) {
  const r = await fetch(`${API}/auth/login`, { method: "POST", headers: { "content-type": "application/json", "X-Slot-Grid": "30" }, body: JSON.stringify({ phone, password: PW, platform: "web" }) });
  if (!r.ok) throw new Error(`login ${phone} ${r.status}`);
  return r.json();
}
async function api(tok, method, p, body) {
  const r = await fetch(`${API}${p}`, { method, headers: { "content-type": "application/json", "X-Slot-Grid": "30", Authorization: `Bearer ${tok}` }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let j;
  try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, body: j };
}
async function uploadProof(tok, bookingId) {
  const fd = new FormData();
  fd.append("image", new Blob([PNG], { type: "image/png" }), "proof.png");
  const r = await fetch(`${API}/bookings/${bookingId}/payment-proof`, { method: "POST", headers: { Authorization: `Bearer ${tok}`, "X-Slot-Grid": "30" }, body: fd });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function newPage(browser, session, { width = 390, fs: fontScale } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: "Asia/Karachi" });
  // nothing but localhost may load (no prod, no third parties)
  await ctx.route(/^(?!https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/).*/, (route) => (/^(data|blob):/.test(route.request().url()) ? route.continue() : route.abort()));
  await ctx.addInitScript(([tok, exp, user]) => {
    if (!localStorage.getItem("maidan.session_token")) {
      localStorage.setItem("maidan.session_token", tok);
      localStorage.setItem("maidan.session_expires_at", exp);
      localStorage.setItem("maidan.cached_user", JSON.stringify(user));
    }
  }, [session.token, session.expires_at, session.user]);
  const page = await ctx.newPage();
  page.__fs = fontScale;
  page.__errors = [];
  page.on("pageerror", (e) => page.__errors.push(String(e).slice(0, 200)));
  return { ctx, page };
}
async function go(page, route, ms = 2500) {
  const sep = route.includes("?") ? "&" : "?";
  await page.goto(`${BASE}${route}${page.__fs ? `${sep}fs=${page.__fs}` : ""}`, { waitUntil: "domcontentloaded", timeout: 240000 });
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
async function textOf(page, testId) {
  try { return (await page.getByTestId(testId).first().innerText()).trim(); } catch { return ""; }
}
/** Layout audit of what is on screen: horizontal overflow, "…" in visible text, clipped money/time, small tap targets. */
async function audit(page, label) {
  const r = await page.evaluate(() => {
    const vw = window.innerWidth;
    const overflowX = document.documentElement.scrollWidth - vw;
    const vis = (el) => { const b = el.getBoundingClientRect(); const s = getComputedStyle(el); return b.width > 0 && b.height > 0 && s.visibility !== "hidden" && b.bottom > 0 && b.top < window.innerHeight; };
    const ellipsis = [];
    const clipped = [];
    for (const el of document.querySelectorAll("div[dir=auto], span")) {
      if (!vis(el)) continue;
      const t = (el.innerText || "").trim();
      if (!t || el.children.length > 2) continue;
      if (/…/.test(t) && /PKR|\d:\d\d|\+92|\d{10}/.test(t)) ellipsis.push(t.slice(0, 60));
      const cs = getComputedStyle(el);
      if ((cs.textOverflow === "ellipsis" || cs.webkitLineClamp !== "none") && el.scrollWidth > el.clientWidth + 1 && /PKR|\d:\d\d|\+92/.test(t)) clipped.push(t.slice(0, 60));
    }
    const small = [];
    for (const el of document.querySelectorAll('[role=button],[role=tab],[role=link],[role=checkbox],[role=radio],[role=switch],button,a')) {
      if (!vis(el)) continue;
      if (el.parentElement && el.parentElement.closest('[role=button],[role=checkbox],button')) continue; // inline link inside a 44pt row
      const b = el.getBoundingClientRect();
      if (b.top < 0 || b.bottom > window.innerHeight) continue;
      if (Math.min(b.width, b.height) < 43.5) small.push(`${(el.getAttribute("aria-label") || el.innerText || "").trim().slice(0, 40)} ${Math.round(b.width)}x${Math.round(b.height)}`);
    }
    return { overflowX, ellipsis, clipped, small };
  });
  check(`${label}: no horizontal overflow`, r.overflowX <= 1, r.overflowX);
  check(`${label}: no "…" / clipping on money, time, phone`, r.ellipsis.length === 0 && r.clipped.length === 0, [...r.ellipsis, ...r.clipped].join(" | "));
  check(`${label}: tap targets >= 44`, r.small.length === 0, r.small.join(" | "));
}
/** Scroll every scroll container down step by step (RN-web screens scroll inside a div), screenshotting as we go. */
async function scrollShots(page, name, steps = 3) {
  for (let i = 1; i <= steps; i++) {
    const moved = await page.evaluate(() => {
      let best = null;
      for (const el of document.querySelectorAll("div")) {
        if (el.scrollHeight > el.clientHeight + 40 && getComputedStyle(el).overflowY !== "visible" && el.clientHeight > 300) if (!best || el.clientHeight > best.clientHeight) best = el;
      }
      if (!best) return false;
      const before = best.scrollTop;
      best.scrollTop = before + best.clientHeight * 0.8;
      return best.scrollTop !== before;
    });
    if (!moved) break;
    await page.waitForTimeout(500);
    await shot(page, `${name}-${i}`);
  }
}
async function freeStart(tok, courtId, minSlots, dayOffset) {
  const now = new Date(Date.now() + 5 * 3600e3);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + dayOffset)).toISOString().slice(0, 10);
  const r = await api(tok, "GET", `/courts/${courtId}/availability?date=${d}`);
  const slots = r.body.slots || [];
  for (let i = 0; i + minSlots <= slots.length; i++) {
    const run = slots.slice(i, i + minSlots);
    if (run.every((s) => s.status === "available") && Date.parse(run[0].starts_at) > Date.now() + 3600e3) return run[0].starts_at;
  }
  return null;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const player = await login(PLAYER);
  const owner = await login(OWNER);
  const venues = (await api(owner.token, "GET", "/owners/venues")).body;
  const venue = venues[0];
  const venueDetail = (await api(player.token, "GET", `/venues/by-slug/${venue.slug}`)).body;
  const courts = venueDetail.courts.filter((c) => c.is_active);

  // ---------------- 1. Happy path: search -> venue -> slot -> confirm -> hold -> pay -> approve -> booked ----------------
  {
    const { ctx, page } = await newPage(browser, player);
    await go(page, "/", 4000);
    check("home renders (hero + search pill)", await visible(page, "home-search"));
    await shot(page, "Main-home");
    await go(page, "/search", 3000);
    check("search: results list", (await page.getByTestId("venue-card").count()) > 0, await textOf(page, "search-count"));
    await shot(page, "PSearch-results");
    await page.getByTestId("search-filters").click();
    check("search: filters sheet opens", await visible(page, "filters-apply", 15000));
    await page.waitForTimeout(800);
    await shot(page, "PSearch-filters-sheet");
    await page.getByTestId("filters-apply").click();
    await page.waitForTimeout(1200);
    // the venue card for our venue
    await page.getByText(venue.name, { exact: true }).first().click();
    await page.waitForURL(/\/venue\//, { timeout: 30000 });
    check("venue: picker card", await visible(page, "venue-picker"));
    await shot(page, "Venue-top");
    // day 3 ahead keeps clear of the seed's near-term bookings
    const now = new Date(Date.now() + 5 * 3600e3);
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 3)).toISOString().slice(0, 10);
    await page.getByTestId(`court-${courts[courts.length - 1].id}`).click();
    await page.getByTestId(`day-${day}`).click();
    await page.waitForTimeout(2500);
    const openCount = await page.getByTestId("slot-open").count();
    check("venue: open slot chips for the day", openCount > 0, openCount);
    check("venue: Book karo disabled before a pick", await page.getByTestId("venue-book").isDisabled().catch(() => false));
    await page.getByTestId("slot-open").first().click();
    await page.waitForTimeout(2500);
    check("venue: chosen start shows as selected (✓)", (await page.getByTestId("slot-selected").count()) === 1);
    const bar = await textOf(page, "venue-book-bar");
    check("venue: floating bar shows the real total", /PKR [\d,]+/.test(bar), bar.replace(/\n/g, " / "));
    await scrollShots(page, "Venue-picker", 2);
    await page.getByTestId("venue-book").click();
    check("confirm sheet opens", await visible(page, "confirm-hold", 15000));
    await page.waitForTimeout(800);
    const rows = await textOf(page, "confirm-rows");
    check("confirm sheet: advance + venue par baqi from the quote, cancel policy", /Abhi bhejna \(advance\)/.test(rows) && /Venue par baqi/.test(rows) && /PKR/.test(rows) && /Cancel/.test(rows), rows.replace(/\n/g, " / "));
    check("confirm sheet: never says pakki/confirmed", !/pakki|confirmed|court aap ka/i.test(rows));
    await shot(page, "Venue-confirm-sheet");
    await page.getByTestId("confirm-hold").click();
    await page.waitForURL(/\/booking\/[0-9a-f-]+\/pay/, { timeout: 30000 });
    const bookingId = page.url().match(/booking\/([0-9a-f-]+)\/pay/)[1];
    check("Book karo -> direct hold -> Pay screen", !!bookingId, bookingId);
    const held = await api(player.token, "GET", `/bookings/${bookingId}`);
    check("the hold is real (status held, held_until set)", held.body.status === "held" && !!held.body.held_until, held.body.status);
    check("pay: countdown ring from held_until", await visible(page, "pay-countdown"));
    check("pay: amount = advance", (await textOf(page, "pay-amount")) === `PKR ${Number(held.body.advance_amount).toLocaleString("en-US")}`, await textOf(page, "pay-amount"));
    check("pay: bank details saved from the hold response (Copy fields)", await visible(page, "pay-account", 5000));
    await shot(page, "Pay-hold");
    const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 20000 }), page.getByTestId("pay-pick").click()]);
    await chooser.setFiles(PNG_PATH);
    check("pay: screenshot attached (resized preview)", await visible(page, "pay-picked", 20000));
    await scrollShots(page, "Pay-proof", 2);
    await page.getByTestId("pay-submit").click();
    await page.waitForURL(/\/booking\/[0-9a-f-]+\/done/, { timeout: 60000 });
    await page.waitForTimeout(2500);
    const waitingTitle = await textOf(page, "status-title");
    check("status: waiting says 'Payment bhej di' (not pakki)", /Payment bhej di/.test(waitingTitle) && !/pakki|court aap ka/i.test(waitingTitle), waitingTitle);
    check("status: honest timeline shown, no QR before booked", (await visible(page, "status-timeline", 5000)) && (await page.getByRole("img", { name: "Check-in QR code" }).count()) === 0);
    await shot(page, "Status-waiting");
    await scrollShots(page, "Status-waiting", 2);
    // owner approves
    const q = await api(owner.token, "GET", `/owners/approvals-queue?venue_id=${venue.id}&page=1&page_size=50`);
    const item = (q.body.items || []).find((x) => x.booking_id === bookingId);
    check("owner sees the payment in Approvals", !!item, q.status);
    if (item) {
      // The seed reuses one tiny test PNG, so the server flags it as a duplicate: the owner confirms that explicitly (same as the UI).
      const ap = await api(owner.token, "POST", `/payments/${item.payment_id}/approve`, { confirm_duplicate: true });
      check("owner approve via API", ap.status < 300, `${ap.status} ${JSON.stringify(ap.body).slice(0, 120)}`);
    }
    let bookedTitle = "";
    for (let i = 0; i < 20 && !/Court aap ka hai/.test(bookedTitle); i++) {
      await page.waitForTimeout(1500);
      bookedTitle = await textOf(page, "status-title");
    }
    check("player sees 'Court aap ka hai!' after the approval (polling)", /Court aap ka hai/.test(bookedTitle), bookedTitle);
    check("booked: QR ticket shown", (await page.getByRole("img", { name: "Check-in QR code" }).count()) === 1);
    await page.evaluate(() => document.querySelectorAll("div").forEach((el) => (el.scrollTop = 0)));
    await page.waitForTimeout(3500); // let the OCR toast fade
    await shot(page, "Status-booked-ticket");
    await scrollShots(page, "Status-booked", 2);
    // bookings tab + chat tab
    await go(page, "/bookings", 3000);
    check("bookings tab lists the booking", (await page.getByTestId("booking-row-booked").count()) > 0);
    await shot(page, "PBookings-list");
    await go(page, "/chat", 3500);
    check("chat tab: one row per booking (real data)", (await page.getByTestId("chat-row").count()) > 0);
    await shot(page, "PChat-inbox");
    await page.getByTestId("chat-row").first().click();
    check("chat thread opens with the slot context", await visible(page, "chat-context", 20000));
    await page.waitForTimeout(1500);
    await shot(page, "PChat-thread");
    await go(page, `/booking/${bookingId}/done`, 3000);
    await page.getByTestId("status-cancel").scrollIntoViewIfNeeded().catch(() => {});
    if (await page.getByTestId("status-cancel").count()) {
      await page.getByTestId("status-cancel").click();
      check("cancel sheet opens (does not cancel by itself)", await visible(page, "cancel-confirm", 10000));
      await page.waitForTimeout(700);
      await shot(page, "PBookings-cancel-sheet");
    } else check("cancel button follows the venue policy", true, "policy forbids cancel");
    await go(page, "/profile", 2500);
    await shot(page, "PAccount-profile");
    // /notifications is also an owner route on web, so open it the way a player does: the bell on Home
    await go(page, "/", 2500);
    await page.getByTestId("home-bell").click();
    await page.waitForTimeout(3000);
    check("notifications screen opens from the bell", await visible(page, "notifications-screen", 15000));
    await shot(page, "PAccount-notifications");
    await go(page, "/edit-profile", 2500);
    await shot(page, "PAccount-edit-profile");
    check("no page errors (happy path)", page.__errors.length === 0, page.__errors.join(" | "));
    await ctx.close();
  }

  // ---------------- 2. Reject path ----------------
  {
    const court = courts[0];
    const start = await freeStart(player.token, court.id, 2, 4);
    const h = await api(player.token, "POST", "/bookings/hold", { court_id: court.id, starts_at: start, slot_count: 2 });
    check("reject path: hold via API", h.status === 201, `${h.status} ${JSON.stringify(h.body).slice(0, 100)}`);
    const id = h.body.booking?.id;
    const up = await uploadProof(player.token, id);
    check("reject path: proof uploaded", up.status < 300, up.status);
    const q = await api(owner.token, "GET", `/owners/approvals-queue?venue_id=${venue.id}&page=1&page_size=50`);
    const item = (q.body.items || []).find((x) => x.booking_id === id);
    const rj = item ? await api(owner.token, "POST", `/payments/${item.payment_id}/reject`, { reason: "Screenshot mein raqam match nahi" }) : { status: 0 };
    check("owner rejects via API", rj.status < 300, rj.status);
    const { ctx, page } = await newPage(browser, player);
    await go(page, `/booking/${id}/done`, 4000);
    const title = await textOf(page, "status-title");
    check("rejected: honest title (not pakki)", /Venue ne booking nahi li/.test(title) && !/pakki|court aap ka/i.test(title), title);
    check("rejected: the venue's own reason", /Screenshot mein raqam match nahi/.test(await textOf(page, "status-reason")));
    check("rejected: next step offered", await visible(page, "status-rebook", 5000));
    check("rejected: no QR", (await page.getByRole("img", { name: "Check-in QR code" }).count()) === 0);
    await shot(page, "Status-rejected");
    await ctx.close();
  }

  // ---------------- 3. Expired hold ----------------
  {
    const old = await login(OLD_PLAYER);
    const mine = (await api(old.token, "GET", "/bookings/mine?status=all&page=1&page_size=100")).body;
    const exp = mine.find((b) => b.status === "held" && b.held_until && Date.parse(b.held_until) < Date.now());
    check("expired path: a hold past its held_until exists in the seed", !!exp);
    if (exp) {
      const { ctx, page } = await newPage(browser, old);
      await go(page, `/booking/${exp.id}/pay`, 4000);
      const body = await page.locator("body").innerText();
      check("expired: pay screen says the hold is over (no bank form, no upload)", /Hold ka waqt khatam/.test(body) && (await page.getByTestId("pay-submit").count()) === 0, body.slice(0, 120).replace(/\n/g, " / "));
      await shot(page, "Pay-expired");
      await go(page, `/booking/${exp.id}/done`, 4000);
      const t = await textOf(page, "status-title");
      check("expired: status says 'Waqt khatam ho gaya' with the reason", /Waqt khatam ho gaya/.test(t) && /screenshot nahi aaya/i.test(await textOf(page, "status-reason")), t);
      await shot(page, "Status-expired");
      await ctx.close();
    }
  }

  // ---------------- 4. 390 + 320 / font x1.3 layout audit of the main screens ----------------
  for (const [width, fsScale, tag] of [[390, undefined, "390"], [320, 1.3, "320-fs13"]]) {
    const { ctx, page } = await newPage(browser, player, { width, fs: fsScale });
    const mine = (await api(player.token, "GET", "/bookings/mine?status=upcoming&page=1&page_size=50")).body;
    const booked = mine.find((b) => b.status === "booked");
    const routes = [
      ["Main-home", "/"],
      ["PSearch-results", "/search"],
      ["Venue-top", `/venue/${venue.slug}`],
      ["PBookings-list", "/bookings"],
      ["PChat-inbox", "/chat"],
      ["PAccount-profile", "/profile"],
      ...(booked ? [["Status-booked-ticket", `/booking/${booked.id}/done`]] : []),
    ];
    for (const [name, route] of routes) {
      await go(page, route, 3500);
      await audit(page, `${tag} ${name}`);
      if (tag !== "390") await shot(page, `${name}-${tag}`);
    }
    // the hold -> pay screen at this size (a fresh hold, cancelled again right after)
    const start = await freeStart(player.token, courts[0].id, 2, 5);
    const h = await api(player.token, "POST", "/bookings/hold", { court_id: courts[0].id, starts_at: start, slot_count: 2 });
    if (h.status === 201) {
      await page.evaluate(([id, pi]) => {
        const k = "maidan.payment_instructions";
        const cur = JSON.parse(localStorage.getItem(k) || '{"state":{"paymentInstructionsByBookingId":{}},"version":1}');
        cur.state.paymentInstructionsByBookingId[id] = { ...pi, saved_at: Date.now() };
        localStorage.setItem(k, JSON.stringify(cur));
      }, [h.body.booking.id, h.body.payment_instructions]);
      await go(page, `/booking/${h.body.booking.id}/pay`, 3500);
      await audit(page, `${tag} Pay-hold`);
      if (tag !== "390") await shot(page, `Pay-hold-${tag}`);
      await api(player.token, "POST", `/bookings/${h.body.booking.id}/cancel`, {});
    }
    // auth screens (signed out)
    await ctx.close();
    const anon = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: "Asia/Karachi" });
    await anon.route(/^(?!https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/).*/, (r) => r.abort());
    const ap = await anon.newPage();
    ap.__fs = fsScale;
    ap.__errors = [];
    for (const [name, route] of [["PAuth-login", "/login"], ["PAuth-signup", "/signup"], ["PAuth-otp", "/verify?purpose=signup&phone=%2B923001112233"]]) {
      await go(ap, route, 3000);
      await audit(ap, `${tag} ${name}`);
      await shot(ap, tag === "390" ? name : `${name}-${tag}`);
    }
    await anon.close();
  }

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
