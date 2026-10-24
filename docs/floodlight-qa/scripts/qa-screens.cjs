// Floodlight QA (Phase E): every board's screens on the Expo web build against the LOCAL backend, side by side with
// the board, plus the automated checks on every screen visited.
// Run (from anywhere): PLAYWRIGHT_PATH=<pw>/node_modules/playwright BASE=http://localhost:8095 node docs/floodlight-qa/scripts/qa-screens.cjs [390|320|all]
// Output: docs/floodlight-qa/boards/<Board>-board*.png, <Board>-app-<screen>.png, <Board>-side.png, index.html,
//         docs/floodlight-qa/qa-results-<width>.json (findings per screen).
// LOCAL ONLY: the browser may contact localhost only (photos on the S3 domain are blocked, so photo areas stay empty).
const { chromium } = require(process.env.PLAYWRIGHT_PATH);
const fs = require("fs");
const os = require("os");
const path = require("path");
const { renderBoard } = require("./board-render.cjs");
const { audit } = require("./qa-audit.cjs");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const BOARDS = path.join(ROOT, "design", "khelo-mobile-floodlight");
const OUT = path.join(ROOT, "docs", "floodlight-qa", "boards");
const BASE = process.env.BASE || "http://localhost:8095";
const API = `${process.env.API || "http://localhost:8000"}/api/v1`;
if (!/localhost|127\.0\.0\.1/.test(API)) throw new Error("local backend only");
const MODE = process.argv[2] || "all";
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
const PW = "demo-password-123";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAACgAAAA8CAIAAACb22+3AAAAOElEQVR4nO3NQQkAAAgEsAtmMCMayxgiDPZfputExGKxWCwWi8VisVgsFovFYrFYLBaLxWLxp3gB8KnrRHLLp+oAAAAASUVORK5CYII=", "base64");
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(tok, method, p, body) {
  const r = await fetch(`${API}${p}`, { method, headers: { "content-type": "application/json", "X-Slot-Grid": "30", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, body: j };
}
const sessions = {};
async function login(phone) {
  if (sessions[phone]) return sessions[phone];
  const r = await req(null, "POST", "/auth/login", { phone, password: PW, platform: "web" });
  if (r.status !== 200) throw new Error(`login ${phone} ${r.status}`);
  return (sessions[phone] = r.body);
}
async function uploadProof(tok, id) {
  const fd = new FormData();
  fd.append("image", new Blob([PNG], { type: "image/png" }), "proof.png");
  const r = await fetch(`${API}/bookings/${id}/payment-proof`, { method: "POST", headers: { Authorization: `Bearer ${tok}`, "X-Slot-Grid": "30" }, body: fd });
  return r.status;
}
function pktDate(off) { const n = new Date(Date.now() + 5 * 3600e3); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + off)).toISOString().slice(0, 10); }
async function freeStart(tok, courtId, minSlots, off) {
  const slots = (await req(tok, "GET", `/courts/${courtId}/availability?date=${pktDate(off)}`)).body.slots || [];
  for (let i = 0; i + minSlots <= slots.length; i++) { const run = slots.slice(i, i + minSlots); if (run.every((s) => s.status === "available") && Date.parse(run[0].starts_at) > Date.now() + 3600e3) return run[0].starts_at; }
  return null;
}

async function context(browser, phone, width, fsScale, setup) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: "Asia/Karachi", locale: "en-US" });
  await ctx.route(/^(?!https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/).*/, (r) => (/^(data|blob):/.test(r.request().url()) ? r.continue() : r.abort()));
  const s = phone ? await login(phone) : null;
  await ctx.addInitScript(([tok, exp, user, f, extra]) => {
    if (tok && !localStorage.getItem("maidan.session_token")) { localStorage.setItem("maidan.session_token", tok); localStorage.setItem("maidan.session_expires_at", exp); localStorage.setItem("maidan.cached_user", JSON.stringify(user)); }
    if (f) sessionStorage.setItem("fl.fs", f);
    if (extra) for (const [k, v] of Object.entries(extra)) if (!localStorage.getItem(k + ".qa")) { localStorage.setItem(k, v); localStorage.setItem(k + ".qa", "1"); }
  }, [s && s.token, s && s.expires_at, s && s.user, fsScale ? String(fsScale) : null, (setup && setup.storage) || null]);
  if (setup && setup.route) await setup.route(ctx);
  const page = await ctx.newPage();
  page.__errors = [];
  page.on("pageerror", (e) => page.__errors.push(String(e).slice(0, 160)));
  return { ctx, page };
}
async function settle(page, ms = 2500) { try { await page.waitForLoadState("networkidle", { timeout: 12000 }); } catch {} await page.waitForTimeout(ms); }
/** Grow the viewport to the full length of the screen's main scroll view (boards are drawn full length too). */
async function expand(page, width) {
  const extra = await page.evaluate(() => {
    let best = null;
    for (const el of document.querySelectorAll("div")) {
      const cs = getComputedStyle(el);
      if (el.scrollHeight > el.clientHeight + 20 && /(auto|scroll)/.test(cs.overflowY) && el.clientHeight > 200 && el.checkVisibility()) if (!best || el.scrollHeight - el.clientHeight > best.scrollHeight - best.clientHeight) best = el;
    }
    return best ? best.scrollHeight - best.clientHeight : 0;
  });
  const h = Math.min(844 + extra, 5200);
  if (h > 844) { await page.setViewportSize({ width, height: h }); await page.waitForTimeout(1500); }
  return h;
}
async function reset(page, width) { await page.setViewportSize({ width, height: 844 }); await page.waitForTimeout(300); }
async function vis(loc) { const n = await loc.count(); for (let i = 0; i < n; i++) if (await loc.nth(i).isVisible()) return loc.nth(i); return null; }
async function tapTestId(page, id) { const el = await vis(page.getByTestId(id)); if (!el) throw new Error("no " + id); await el.click(); }

// ------------------------------------------------------------------------------------------------------------------
// Screens per board. who: phone | null (signed out). sheet: true = overlay (no full-length grow). main: in the 320 run.
function specs(d) {
  const P = "+923000000003"; // Demo Player (seed: bookings, chat rows)
  const O = "+923000000002"; // owner
  return [
    { board: "PAuth", id: "login", who: null, route: "/login", main: true },
    { board: "PAuth", id: "signup", who: null, route: "/signup", main: true },
    { board: "PAuth", id: "otp", who: null, route: "/verify?purpose=signup&phone=%2B923001112233", main: true },
    { board: "Main", id: "home", who: P, route: "/", main: true },
    { board: "PSearch", id: "results", who: P, route: "/search", main: true },
    { board: "PSearch", id: "filters-sheet", who: P, route: "/search", sheet: true, act: async (p) => { await tapTestId(p, "search-filters"); await p.getByTestId("filters-apply").first().waitFor({ timeout: 15000 }); await p.waitForTimeout(900); } },
    { board: "PSearch", id: "no-results", who: P, route: "/search?area=Nowhere%20QA&sport=tennis" },
    { board: "VenueCard", id: "list-card", who: P, route: "/search", main: true, verify: cardVerify },
    { board: "VenueCard", id: "amenities-sheet", who: P, route: "/search", sheet: true, main: true, act: async (p) => { await tapTestId(p, "venue-card-amenities"); await p.waitForTimeout(1200); }, verify: sheetVerify },
    { board: "Venue", id: "venue", who: P, route: `/venue/${d.slug}`, main: true },
    { board: "Venue", id: "slot-picked", who: d.pPick, route: `/venue/${d.slug}`, act: async (p) => { await pickSlot(p, d); } },
    { board: "Venue", id: "confirm-sheet", who: d.pPick, route: `/venue/${d.slug}`, sheet: true, act: async (p) => { await pickSlot(p, d); await tapTestId(p, "venue-book"); await p.getByTestId("confirm-hold").first().waitFor({ timeout: 15000 }); await p.waitForTimeout(900); } },
    { board: "Pay", id: "pay", who: d.pHold, route: d.holdId ? `/booking/${d.holdId}/pay` : null, storage: d.holdStorage, main: true },
    { board: "Status", id: "waiting", who: d.pSubmitted, route: d.submittedId ? `/booking/${d.submittedId}/done` : null },
    { board: "Status", id: "booked", who: d.pBooked, route: d.bookedId ? `/booking/${d.bookedId}/done` : null, main: true },
    { board: "Status", id: "rejected", who: d.pRejected, route: d.rejectedId ? `/booking/${d.rejectedId}/done` : null },
    { board: "PChat", id: "inbox", who: P, route: "/chat", main: true },
    { board: "PChat", id: "thread", who: P, route: "/chat", act: async (p) => { const r = await vis(p.getByTestId("chat-row")); if (r) { await r.click(); await p.getByTestId("chat-context").first().waitFor({ timeout: 20000 }).catch(() => {}); await p.waitForTimeout(1500); } } },
    { board: "PBookings", id: "list", who: P, route: "/bookings", main: true },
    { board: "PBookings", id: "detail", who: d.pBooked, route: d.bookedId ? `/booking/${d.bookedId}/done` : null },
    { board: "PBookings", id: "cancel-sheet", who: d.pSubmitted, route: d.submittedId ? `/booking/${d.submittedId}/done` : null, sheet: true, act: async (p) => { const b = await vis(p.getByTestId("status-cancel")); if (b) { await b.scrollIntoViewIfNeeded(); await b.click(); await p.getByTestId("cancel-confirm").first().waitFor({ timeout: 10000 }).catch(() => {}); await p.waitForTimeout(900); } } },
    { board: "PAccount", id: "profile", who: P, route: "/profile", main: true },
    { board: "PAccount", id: "notifications", who: P, route: "/", act: async (p) => { await tapTestId(p, "home-bell"); await p.getByTestId("notifications-screen").first().waitFor({ timeout: 15000 }).catch(() => {}); await p.waitForTimeout(1500); } },
    { board: "PAccount", id: "edit-profile", who: P, route: "/edit-profile" },
    { board: "PStates", id: "skeleton", who: P, route: "/bookings", wait: 5000, routeSetup: (c) => c.route("**/api/v1/bookings/mine**", async (rt) => { await sleep(30000); await rt.continue().catch(() => {}); }) },
    { board: "PStates", id: "error", who: P, route: "/bookings", routeSetup: (c) => c.route("**/api/v1/bookings/mine**", (rt) => rt.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL", message: "boom" } }) })) },
    { board: "PStates", id: "offline", who: P, route: "/bookings", wait: 6000, routeSetup: (c) => c.route("**/health", (rt) => rt.abort()) },
    { board: "PStates", id: "404", who: P, route: "/venue/this-venue-does-not-exist" },
    // ---------------- owner ----------------
    { board: "OwnerToday", id: "aaj", who: O, owner: true, route: "/today", main: true },
    { board: "Approvals", id: "list", who: O, owner: true, route: "/approvals", main: true },
    { board: "OSheets", id: "booking-detail", who: O, owner: true, route: "/history?status=booked", sheet: true, act: async (p) => { const c = p.locator('[data-testid$="-booked"]').first(); if (await c.count()) { await c.getByRole("button").first().click(); await p.waitForTimeout(2500); } } },
    { board: "OSheets", id: "reject-sheet", who: O, owner: true, route: "/approvals", sheet: true, act: async (p) => { const card = await vis(p.getByTestId("approval-card")); if (card) { await card.getByRole("button", { name: "Reject", exact: true }).click(); await p.waitForTimeout(1500); } } },
    { board: "OSheets", id: "adhoora", who: O, owner: true, route: "/history?status=booked", sheet: true, act: async (p) => { const cards = p.locator('[data-testid$="-booked"]'); const n = await cards.count(); for (let i = 0; i < Math.min(n, 8); i++) { await cards.nth(i).getByRole("button").first().click(); await p.waitForTimeout(2000); const kam = await vis(p.getByRole("button", { name: "Kam mila" })); if (kam) { await kam.click(); await p.waitForTimeout(2200); return; } const close = await vis(p.getByRole("button", { name: "Band karein" })); if (close) { await close.click(); await p.waitForTimeout(1200); } } } },
    { board: "OWalkin", id: "walkin", who: O, owner: true, route: "/walkin", main: true },
    { board: "OWalkin", id: "checkin", who: O, owner: true, route: "/checkin-scan" },
    { board: "OPaisa", id: "ledger", who: O, owner: true, route: "/ledger", main: true },
    { board: "OPaisa", id: "refunds", who: O, owner: true, route: "/refunds" },
    { board: "OPaisa", id: "history", who: O, owner: true, route: "/history" },
    { board: "OwnerMore", id: "aur", who: O, owner: true, route: "/more", main: true },
    { board: "OGrowthTeam", id: "growth", who: O, owner: true, route: "/growth" },
    { board: "OGrowthTeam", id: "reviews", who: O, owner: true, route: "/reviews" },
    { board: "OGrowthTeam", id: "staff", who: O, owner: true, route: "/staff" },
    { board: "OGrowthTeam", id: "premium", who: O, owner: true, route: "/premium" },
    { board: "OSettings", id: "venue", who: O, owner: true, route: "/venue-settings", main: true },
    { board: "OSettings", id: "courts", who: O, owner: true, route: "/venue-settings", act: async (p) => { const t = await vis(p.getByTestId("settings-section").getByRole("tab").nth(1)); if (t) { await t.click(); await p.waitForTimeout(2500); } } },
    { board: "OWizard", id: "step1", who: "+923000000011", owner: true, route: "/venue-setup/register" },
    { board: "OWizard", id: "step2", who: "+923000000011", owner: true, route: "/venue-setup/courts" },
    { board: "OWizard", id: "pending", who: "+923000000012", owner: true, route: d.pendingVenue ? `/venue-setup/pending?venueId=${d.pendingVenue}` : null },
    { board: "OWizard", id: "rejected", who: "+923000000013", owner: true, route: d.rejectedVenue ? `/venue-setup/rejected?venueId=${d.rejectedVenue}` : null },
    { board: "OStaffView", id: "limited", who: "+923000000020", owner: true, route: "/more" },
    { board: "OStaffView", id: "ijazat-nahi", who: "+923000000020", owner: true, route: "/approvals" },
    { board: "OwnerMore", id: "notifications", who: O, owner: true, route: "/today", act: async (p) => { const b = await vis(p.getByRole("button", { name: /^Notifications/ })); if (b) { await b.click(); await p.waitForTimeout(2500); } } },
  ];
}
/** VenueCard (mobile STEP 3): card inside the screen, Amenities chip inside its card and not cut. */
async function cardVerify(p) {
  return p.evaluate(() => {
    const out = [];
    for (const c of document.querySelectorAll('[data-testid="venue-card"]')) {
      const r = c.getBoundingClientRect();
      if (!r.width) continue;
      if (r.left < -1 || r.right > window.innerWidth + 1) out.push("card outside the screen: " + c.innerText.slice(0, 30));
      const chip = c.querySelector('[data-testid="venue-card-amenities"]');
      if (chip) {
        const cr = chip.getBoundingClientRect();
        if (cr.right > r.right + 1 || cr.left < r.left - 1) out.push("chip cut: " + chip.innerText);
        for (const t of chip.querySelectorAll("div")) if (t.scrollWidth > t.clientWidth + 1 && getComputedStyle(t).overflow === "hidden") out.push("chip text clipped: " + chip.innerText);
      }
    }
    return { problems: out, cards: document.querySelectorAll('[data-testid="venue-card"]').length };
  });
}
/** AmenitiesSheet: fully on screen (title at the top inside the viewport, the owner note reachable without leaving the screen). */
async function sheetVerify(p) {
  return p.evaluate(() => {
    const out = [];
    const sheet = [...document.querySelectorAll('[data-testid="amenities-sheet"]')].find((e) => e.getBoundingClientRect().height > 0);
    if (!sheet) return { problems: ["sheet not open"] };
    const r = sheet.getBoundingClientRect();
    if (r.top < 0) out.push("sheet top above the screen " + Math.round(r.top));
    if (r.left < -1 || r.right > window.innerWidth + 1) out.push("sheet wider than the screen");
    const fits = sheet.scrollHeight <= sheet.clientHeight + 2;
    const note = [...sheet.querySelectorAll("div")].find((d) => /venue owner ne khud/.test(d.textContent) && d.children.length === 0);
    if (fits && note && note.getBoundingClientRect().bottom > window.innerHeight + 1) out.push("owner note below the screen");
    return { problems: out, scrolls: !fits };
  });
}

async function pickSlot(p, d) {
  await p.getByTestId(`court-${d.courts[0].id}`).first().click().catch(() => {});
  for (const off of [4, 5, 6, 3]) {
    const day = await vis(p.getByTestId(`day-${pktDate(off)}`));
    if (!day) continue;
    await day.click();
    await p.waitForTimeout(2200);
    const s = await vis(p.getByTestId("slot-open"));
    if (s) { await s.click(); await p.waitForTimeout(1800); return; }
  }
}

// Extra board renders: interactive states the board itself can show.
const BOARD_VARIANTS = {
  Status: [{ suffix: "", props: { stage: "waiting" } }, { suffix: "-booked", props: { stage: "booked" } }],
  Venue: [{ suffix: "" }, { suffix: "-sheet", state: { sheet: true } }],
};

async function prepare() {
  const owner = await login("+923000000002");
  const venue = (await req(owner.token, "GET", "/owners/venues")).body[0];
  const detail = (await req(owner.token, "GET", `/venues/by-slug/${venue.slug}`)).body;
  const courts = detail.courts.filter((c) => c.is_active);
  const d = { slug: venue.slug, courts, cleanup: [] };
  const qa = { journey: "+923000000031", reject: "+923000000032", expiry: "+923000000033" };
  // booked (from the journey run) / rejected (journey reject player) / waiting (fresh proof) / held (fresh hold)
  const listOf = async (phone, status) => { const s = await login(phone); const r = (await req(s.token, "GET", `/bookings/mine?status=${status}&page=1&page_size=100`)).body; return Array.isArray(r) ? r : r.items || []; };
  try {
    const up = await listOf(qa.journey, "upcoming");
    const booked = up.find((b) => b.status === "booked");
    if (booked) { d.bookedId = booked.id; d.pBooked = qa.journey; }
  } catch {}
  if (!d.bookedId) { const up = await listOf("+923000000003", "upcoming"); const b = up.find((x) => x.status === "booked"); if (b) { d.bookedId = b.id; d.pBooked = "+923000000003"; } }
  try {
    const all = await listOf(qa.reject, "all");
    const rj = all.find((b) => b.status === "cancelled" && b.cancelled_by === "owner");
    if (rj) { d.rejectedId = rj.id; d.pRejected = qa.reject; }
  } catch {}
  // fresh hold + proof for "waiting", fresh hold for "pay" (both cancelled again at the end)
  try {
    const s = await login(qa.expiry);
    const st = await freeStart(s.token, courts[0].id, 2, 7);
    const h = await req(s.token, "POST", "/bookings/hold", { court_id: courts[0].id, starts_at: st, slot_count: 2 });
    if (h.status === 201) {
      d.holdId = h.body.booking.id; d.pHold = qa.expiry; d.cleanup.push([s.token, d.holdId]);
      d.holdStorage = { "maidan.payment_instructions": JSON.stringify({ state: { paymentInstructionsByBookingId: { [d.holdId]: { ...h.body.payment_instructions, saved_at: Date.now() } } }, version: 1 }) };
    }
    const st2 = await freeStart(s.token, courts[courts.length - 1].id, 2, 8);
    const h2 = await req(s.token, "POST", "/bookings/hold", { court_id: courts[courts.length - 1].id, starts_at: st2, slot_count: 2 });
    if (h2.status === 201 && [200, 201].includes(await uploadProof(s.token, h2.body.booking.id))) { d.submittedId = h2.body.booking.id; d.pSubmitted = qa.expiry; d.cleanup.push([s.token, d.submittedId]); }
  } catch (e) { console.log("prepare holds:", e.message); }
  d.pPick = qa.reject;
  try { d.pendingVenue = (await req((await login("+923000000012")).token, "GET", "/owners/venues")).body[0]?.id; } catch {}
  try { d.rejectedVenue = (await req((await login("+923000000013")).token, "GET", "/owners/venues")).body[0]?.id; } catch {}
  return d;
}

function summarize(a) {
  return {
    textPairs: a.textPairs, textFails: a.textFails.length, uiPairs: a.uiPairs, uiFails: a.uiFails.length, small: a.small.length,
    whiteOnOrange: a.whiteOnOrange.length, orangePrimary: a.orangePrimary.length, unlabeled: a.unlabeled.length, clipped: a.clipped.length + a.ellipsis.length, overflowX: a.overflowX,
  };
}

async function run(width) {
  const fsScale = width === 320 ? 1.3 : null;
  const tag = width === 320 ? "320-fs13" : "390";
  const browser = await chromium.launch({ headless: true });
  const d = await prepare();
  const results = [];
  let list = specs(d).filter((s) => !ONLY || ONLY.has(s.board));
  if (width === 320) list = list.filter((s) => s.main);
  for (const s of list) {
    if (!s.route) { results.push({ board: s.board, id: s.id, skipped: "no data for this state on the local DB" }); console.log("SKIP", s.board, s.id); continue; }
    const { ctx, page } = await context(browser, s.who, width, fsScale, { storage: s.storage, route: s.routeSetup });
    let audited = null, err = null, h = 844;
    try {
      await page.goto(BASE + s.route, { waitUntil: "domcontentloaded", timeout: 240000 });
      await settle(page, s.wait || 3500);
      if (s.act) await s.act(page);
      if (!s.sheet) h = await expand(page, width);
      const file = path.join(OUT, `${s.board}-app-${s.id}${width === 320 ? "-320-fs13" : ""}.png`);
      await page.screenshot({ path: file });
      audited = await audit(page, { owner: !!s.owner });
      if (s.verify) audited.verify = await s.verify(page);
      // sheets: audit the screen under them too? the sheet is what the board shows; the page below is audited on its own spec.
    } catch (e) { err = String(e).slice(0, 200); }
    const row = { board: s.board, id: s.id, route: s.route, width, height: h, owner: !!s.owner, error: err, pageErrors: page.__errors, ...(audited ? { summary: summarize(audited), detail: audited } : {}) };
    results.push(row);
    console.log(`${err ? "ERR " : "OK  "} ${tag} ${s.board}/${s.id} ${err || JSON.stringify(row.summary)}`);
    await ctx.close();
  }
  for (const [tok, id] of d.cleanup) await req(tok, "POST", `/bookings/${id}/cancel`, {});
  fs.writeFileSync(path.join(ROOT, "docs", "floodlight-qa", `qa-results-${tag}.json`), JSON.stringify(results, null, 1));
  if (width === 390) await boardsAndCompose(browser, results);
  await browser.close();
  return results;
}

async function boardsAndCompose(browser, results) {
  const boards = [...new Set(results.map((r) => r.board))];
  const index = [];
  for (const b of boards) {
    const file = path.join(BOARDS, `${b}.dc.html`);
    const variants = BOARD_VARIANTS[b] || [{ suffix: "" }];
    const boardImgs = [];
    for (const v of variants) {
      const out = path.join(OUT, `${b}-board${v.suffix}.png`);
      const info = await renderBoard(browser, file, { out, props: v.props, state: v.state });
      if (info.err) console.log("board error", b, info.err);
      boardImgs.push(path.basename(out));
    }
    const apps = results.filter((r) => r.board === b && !r.skipped && !r.error).map((r) => ({ img: `${b}-app-${r.id}.png`, id: r.id }));
    const skipped = results.filter((r) => r.board === b && (r.skipped || r.error)).map((r) => `${r.id}: ${r.skipped || r.error}`);
    // side-by-side composite
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:24px;background:#E9ECEB;font:600 15px system-ui}h2{margin:0 0 12px}.row{display:flex;gap:28px;align-items:flex-start}.col{display:flex;flex-direction:column;gap:8px}.col img{display:block;border-radius:12px;box-shadow:0 2px 10px rgba(0,0,0,.12)}.lab{font:700 13px system-ui;color:#333}</style></head><body>
<h2>${b}: board (left) vs app on Expo web, local backend, 390 wide (right)</h2><div class="row">
<div class="col">${boardImgs.map((i) => `<div class="lab">BOARD ${i.replace(".png", "")}</div><img src="${i}">`).join("")}</div>
${apps.map((a) => `<div class="col"><div class="lab">APP ${a.id}</div><img src="${a.img}" style="width:390px"></div>`).join("")}
</div>${skipped.length ? `<p>Not shown (no data): ${skipped.join("; ")}</p>` : ""}</body></html>`;
    const htmlFile = path.join(OUT, `${b}-side.html`);
    fs.writeFileSync(htmlFile, html);
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.route(/^(?!file:|data:).*/, (r) => r.abort());
    await page.goto("file:///" + htmlFile.replace(/\\/g, "/"));
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `${b}-side.png`), fullPage: true });
    await ctx.close();
    fs.unlinkSync(htmlFile);
    index.push({ b, boardImgs, apps, skipped });
  }
  const idx = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Floodlight QA boards</title>
<style>body{margin:0;padding:16px;font:15px system-ui;background:#F4F6F5;color:#0C1F1D}h1{font-size:22px}section{margin:24px 0}h2{font-size:18px}.row{display:flex;gap:20px;overflow-x:auto;align-items:flex-start;padding-bottom:8px}.col{flex:none}.col img{width:390px;display:block;border-radius:10px;box-shadow:0 1px 6px rgba(0,0,0,.12)}.lab{font-weight:700;font-size:12px;margin:4px 0}</style></head><body>
<h1>Floodlight QA: every board next to the app (Expo web, local backend, 390 wide)</h1>
<p>Composite per board: <code>&lt;Board&gt;-side.png</code>. Mismatch table: <a href="../README.md">README.md</a>. Photos are empty locally (seed photo URLs point at S3, blocked in QA).</p>
${index.map((x) => `<section><h2>${x.b} <a href="${x.b}-side.png">(composite)</a></h2><div class="row">${x.boardImgs.map((i) => `<div class="col"><div class="lab">BOARD</div><img src="${i}" style="width:auto;max-width:none"></div>`).join("")}${x.apps.map((a) => `<div class="col"><div class="lab">APP ${a.id}</div><img src="${a.img}"></div>`).join("")}</div>${x.skipped.length ? `<p>Not shown: ${x.skipped.join("; ")}</p>` : ""}</section>`).join("\n")}
</body></html>`;
  fs.writeFileSync(path.join(OUT, "index.html"), idx);
}

(async () => {
  const widths = MODE === "all" ? [390, 320] : [Number(MODE)];
  for (const w of widths) {
    const r = await run(w);
    const tot = r.filter((x) => x.summary).reduce((a, x) => { for (const [k, v] of Object.entries(x.summary)) a[k] = (a[k] || 0) + v; return a; }, {});
    console.log(`\n== ${w}: screens ${r.filter((x) => x.summary).length}, skipped ${r.filter((x) => x.skipped).length}, errors ${r.filter((x) => x.error).length}`);
    console.log(JSON.stringify(tot));
  }
})().catch((e) => { console.error(e); process.exit(2); });
