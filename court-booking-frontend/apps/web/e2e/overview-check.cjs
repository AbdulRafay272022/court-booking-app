#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Owner Overview check (plain Node + Playwright, every API call mocked with page.route -- no backend needed).
 * Run against a PRODUCTION build (never `next dev`) that was built with NEXT_PUBLIC_API_BASE_URL=http://localhost:8099:
 *   BASE_URL=http://localhost:3801 node e2e/overview-check.cjs
 * For each of 360 / 768 / 1280 px in English and Roman Urdu it checks: cards and numbers, the "+N aur" popover, the slots popup,
 * the table (or the card list below 768px), filter pills, "Original booking dekhein", completion Haan (optimistic + request body),
 * completion Nahi (validation, mic, request body), a 400 and a 403 answer, date + court filters in the URL (and surviving a reload),
 * the empty and error states, no horizontal scroll and no console errors. Screenshots go to SHOT_DIR (default: %TEMP%/ovw/shots).
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadPlaywright } = require("./smoke.cjs");

const BASE = (process.env.BASE_URL || "http://localhost:3801").replace(/\/+$/, "");
const API = "http://localhost:8099";
const SHOT_DIR = process.env.SHOT_DIR || path.join(os.tmpdir(), "ovw", "shots");
const WIDTHS = (process.env.WIDTHS || "360,768,1280").split(",").map(Number);
const LANGS = (process.env.LANGS || "en,ru").split(",");
fs.mkdirSync(SHOT_DIR, { recursive: true });

const failures = [];
let checks = 0;
function ok(cond, msg) {
  checks += 1;
  if (!cond) failures.push(msg);
}

function pktToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());
}
function addDays(d, n) {
  const [y, m, dd] = d.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, dd + n));
  return t.toISOString().slice(0, 10);
}

// ---- fixture -------------------------------------------------------------------------------------------
const COURTS = Array.from({ length: 8 }, (_, i) => ({
  id: `c${i + 1}`,
  venue_id: "v1",
  name: `Court ${i + 1}`,
  sport: "Padel",
  slot_minutes: 60,
  is_active: true,
  is_indoor: true,
  has_floodlights: true,
}));
const VENUE = { id: "v1", name: "Arena Khelo", status: "approved", courts: COURTS, sports: ["Padel"], city: "Karachi", cancellation_allowed: true };
const USER = {
  id: "u1", phone: "+923000000002", name: "Owner One", email: null, city: null, gender: null, role: "owner", avatar_url: null,
  phone_verified_at: "2026-01-01T00:00:00Z", reliability_score: 1, total_bookings: 0, total_no_shows: 0, total_rejections: 0, created_at: "2026-01-01T00:00:00Z",
};
const BOOKED_BY_COURT = [9, 8, 6, 5, 4, 3, 2, 1];
const PENDING_BY_COURT = [1, 1, 1, 1, 1, 1, 0, 0];
const BLOCKED_BY_COURT = [1, 1, 1, 1, 0, 0, 0, 0];

function newState(date) {
  const at = (hhmm, plusDay = 0) => `${addDays(date, plusDay)}T${hhmm}:00+05:00`;
  const base = (over) => ({
    kind: "booked", status_key: "booked", player_phone: null, court_id: "c1", court_name: "Court 1", source: "app", checked_in: false,
    completion: null, slot_ended: false, original_booking_id: null, refund_amount: null, refund_status: null, slot_count: 2, ...over,
  });
  return {
    date,
    fail: null, // { status, code } for the NEXT completion call
    calls: [],
    overviewUrls: [],
    rows: [
      base({
        booking_id: "b1", short_code: "KH-3B9A41D7", player_name: "Usman Tariq", starts_at: at("18:00"), ends_at: at("19:00"), duration_minutes: 60,
        total: 3000, advance: 1500, due: 0, total_paid: 3000, slot_ended: true,
        completion: { result: "yes", received_pkr: 3000, reason: null, marked_at: at("19:05"), marked_by_name: "Owner One" }, checked_in: true,
      }),
      base({
        booking_id: "b2", short_code: "KH-91C07E2A", player_name: "Ayesha Khan", court_id: "c2", court_name: "Court 2", starts_at: at("20:00"), ends_at: at("21:30"), duration_minutes: 90,
        total: 4500, advance: 2000, due: 2500, total_paid: 2000, slot_ended: true,
        completion: { result: "no", received_pkr: 2000, reason: "pay kal", marked_at: at("21:35"), marked_by_name: "Owner One" },
      }),
      base({
        booking_id: "b3", short_code: "KH-D4410B6F", player_name: "Hamza Ali", starts_at: at("21:30"), ends_at: at("22:30"), duration_minutes: 60,
        total: 3000, advance: 1500, due: 1500, total_paid: 1500, slot_ended: false,
      }),
      base({
        booking_id: "b4", short_code: "KH-58AE1C03", player_name: "Sana Malik", court_id: "c4", court_name: "Court 4", starts_at: at("23:00"), ends_at: at("00:00", 1), duration_minutes: 60,
        total: 3000, advance: 3000, due: 0, total_paid: 3000, slot_ended: false,
      }),
      base({
        booking_id: "b5", short_code: "KH-0AA1B2C3", player_name: "Zara Noor", court_id: "c3", court_name: "Court 3", starts_at: at("10:00"), ends_at: at("11:00"), duration_minutes: 60,
        total: 2400, advance: 1200, due: 1200, total_paid: 1200, slot_ended: true,
      }),
      base({
        booking_id: "b6", short_code: "KH-0BB2C3D4", player_name: "Imran Shah", court_id: "c5", court_name: "Court 5", starts_at: at("11:00"), ends_at: at("12:30"), duration_minutes: 90,
        total: 4500, advance: 2000, due: 2500, total_paid: 2000, slot_ended: true,
      }),
      base({
        booking_id: "b7", short_code: "KH-0CC3D4E5", player_name: "Nida Rauf", court_id: "c6", court_name: "Court 6", starts_at: at("12:30"), ends_at: at("13:30"), duration_minutes: 60,
        total: 3000, advance: 1000, due: 2000, total_paid: 1000, slot_ended: true,
      }),
      base({
        booking_id: "b8", short_code: "KH-7F3A91C2", kind: "cancelled", status_key: "cancelled", player_name: "Bilal Raza", court_id: "c3", court_name: "Court 3",
        starts_at: at("17:00"), ends_at: at("18:00"), duration_minutes: 60, total: 2400, advance: 1200, due: 1200, total_paid: 1200, original_booking_id: "b8",
        refund_amount: 1200, refund_status: "owed", slot_ended: true,
      }),
      base({
        booking_id: "b8", short_code: "KH-7F3A91C2", kind: "refund", status_key: "refund_owed", player_name: "Bilal Raza", court_id: "c3", court_name: "Court 3",
        starts_at: at("17:00"), ends_at: at("18:00"), duration_minutes: 60, total: 2400, advance: 1200, due: 0, total_paid: 1200, original_booking_id: "b8",
        refund_amount: 1200, refund_status: "owed", slot_ended: true,
      }),
    ],
  };
}

function overviewOf(state, courtIds) {
  const rows = courtIds && courtIds.length ? state.rows.filter((r) => courtIds.includes(r.court_id)) : state.rows;
  const idx = (id) => Number(id.slice(1)) - 1;
  return {
    date: state.date,
    venue_id: "v1",
    operating_day: { start_at: `${state.date}T06:00:00+05:00`, end_at: `${addDays(state.date, 1)}T02:00:00+05:00` },
    slots: {
      total: 96, booked: 38, pending: 6, blocked: 4, free: 48, free_upcoming: 30, free_past: 18,
      by_court: COURTS.map((c, i) => ({
        court_id: c.id, court_name: c.name, total: 12, booked: BOOKED_BY_COURT[i], pending: PENDING_BY_COURT[i], blocked: BLOCKED_BY_COURT[i],
        free: 12 - BOOKED_BY_COURT[i] - PENDING_BY_COURT[i] - BLOCKED_BY_COURT[i],
      })).filter((c) => !courtIds || !courtIds.length || courtIds.includes(c.court_id) || idx(c.court_id) < 0),
    },
    bookings: {
      count: 14, cancelled: 2, refunds: { count: 2, amount: 4500 }, pending: { count: 4, awaiting_approval: 3, awaiting_payment: 1 },
      by_court: COURTS.map((c) => ({ court_id: c.id, court_name: c.name, count: 2 })),
    },
    money: { collected: 31500, due: 12000, due_bookings: 5 },
    // Round 2 (A7): pending for ANY date; `state.noPendingAll` simulates an older backend that does not send it
    ...(state.noPendingAll ? {} : { pending_all: { count: 7, awaiting_approval: 4, awaiting_payment: 3 } }),
    rows,
  };
}

function slotsOf(courtId, date) {
  const slots = [];
  const n = Number(courtId.slice(1));
  for (let i = 0; i < 24; i += 1) {
    const mins = 6 * 60 + i * 30;
    const h = Math.floor(mins / 60);
    const mm = mins % 60;
    const start = `${date}T${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+05:00`;
    const end = new Date(new Date(start).getTime() + 30 * 60000).toISOString();
    const k = (i + n) % 6;
    const status = k === 0 || k === 1 ? "booked" : k === 2 ? "held" : k === 3 ? "blocked" : "available";
    slots.push({ starts_at: new Date(start).toISOString(), ends_at: end, status, price: 1500, advance_amount: 500, held_until: null, booking_id: null, is_mine: false, reason: null, after_midnight: false });
  }
  // two after-midnight slots on court 1 (they belong to the selected operating day)
  if (n === 1) {
    for (let j = 0; j < 2; j += 1) {
      const start = new Date(new Date(`${addDays(date, 1)}T00:00:00+05:00`).getTime() + j * 30 * 60000);
      slots.push({ starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 30 * 60000).toISOString(), status: "available", price: 1500, advance_amount: 500, held_until: null, booking_id: null, is_mine: false, reason: null, after_midnight: true });
    }
  }
  return { court_id: courtId, date, slot_minutes: 30, min_booking_minutes: 60, min_slots: 2, slots };
}

// ---- mocking -------------------------------------------------------------------------------------------
async function mockApi(page, state, opts = {}) {
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
  const json = (route, status, body) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(body) });
  await page.route(`${API}/**`, async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const url = new URL(req.url());
    const p = url.pathname.replace(/^\/api\/v1/, "");
    if (p === "/auth/me") {
      return json(route, 200, { user: USER, session: { device_id: "d", device_name: null, platform: "web", last_active_at: new Date().toISOString(), expires_at: "2099-01-01T00:00:00Z" } });
    }
    if (p === "/auth/refresh") return json(route, 200, { token: "t", expires_at: "2099-01-01T00:00:00Z" });
    if (p === "/feature-flags") return json(route, 200, { flags: {} });
    if (p === "/owners/venues") return json(route, 200, [VENUE]);
    if (p === "/owners/overview") {
      state.overviewUrls.push(url.search);
      if (opts.overviewStatus && opts.overviewStatus() !== 200) return json(route, opts.overviewStatus(), { error: { code: "SERVER_ERROR", message: "boom" } });
      const ids = (url.searchParams.get("court_ids") || "").split(",").filter(Boolean);
      const o = overviewOf({ ...state, date: url.searchParams.get("date") || state.date }, ids);
      if (opts.empty && opts.empty()) o.rows = [];
      return json(route, 200, o);
    }
    let m = /^\/owners\/bookings\/([^/]+)\/completion$/.exec(p);
    if (m && req.method() === "POST") {
      const body = JSON.parse(req.postData() || "{}");
      state.calls.push({ id: m[1], body });
      if (state.fail) {
        const f = state.fail;
        state.fail = null;
        return json(route, f.status, { error: { code: f.code, message: f.code } });
      }
      if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs));
      const row = state.rows.find((r) => r.booking_id === m[1] && r.kind === "booked");
      // Round 2 contract (A8): received_now is added to what was paid; equal to the due -> stored as "yes"
      let received;
      let result = body.result;
      if (body.result === "yes") received = row.total;
      else if (typeof body.received_now === "number") {
        received = row.total_paid + body.received_now;
        if (received >= row.total) result = "yes";
      } else received = body.received_pkr;
      row.total_paid = received;
      row.due = row.total - received;
      row.completion = { result, received_pkr: received, reason: body.reason || null, marked_at: new Date().toISOString(), marked_by_name: "Owner One" };
      return json(route, 200, row);
    }
    m = /^\/courts\/([^/]+)\/availability$/.exec(p);
    if (m) return json(route, 200, slotsOf(m[1], url.searchParams.get("date") || state.date));
    return json(route, 404, { error: { code: "NOT_FOUND", message: "not mocked" } });
  });
}

async function newPage(browser, width, lang, state, opts) {
  const context = await browser.newContext({ viewport: { width, height: width < 768 ? 800 : 900 }, locale: "en-US", timezoneId: "Asia/Karachi" });
  await context.addCookies([{ name: "khelo_lang", value: lang, url: BASE }]);
  await context.addInitScript(([user]) => {
    if (!window.localStorage.getItem("maidan.session_token")) {
      window.localStorage.setItem("maidan.session_token", "test-token");
      window.localStorage.setItem("maidan.session_expires_at", "2099-01-01T00:00:00Z");
      window.localStorage.setItem("maidan.cached_user", JSON.stringify(user));
    }
  }, [USER]);
  const page = await context.newPage();
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (/Failed to load resource|net::ERR/.test(text)) return; // the unmocked 404s of other widgets
    errors.push(text);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  await mockApi(page, state, opts);
  return { page, context, errors };
}

async function noHScroll(page, label) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  ok(sw <= iw, `${label}: horizontal scroll (scrollWidth ${sw} > ${iw})`);
}

const T = {
  en: { seeSlots: "See all slots", more: /\+\d+ more/, yes: "Yes", incomplete: "Incomplete", complete: "Complete", empty: "No bookings on this day", allCourts: "All courts (8)", original: "View original booking", tooSoon: "After the slot ends", today: "Today", tomorrow: "Tomorrow" },
  ru: { seeSlots: "Sab slots dekhein", more: /\+\d+ aur/, yes: "Haan", incomplete: "Adhoora", complete: "Mukammal", empty: "Is din koi booking nahi", allCourts: "Sab courts (8)", original: "Original booking dekhein", tooSoon: "Slot khatam hone ke baad", today: "Aaj", tomorrow: "Kal" },
};

async function runOne(browser, width, lang) {
  const tag = `${width}-${lang}`;
  const L = T[lang];
  const today = pktToday();
  const state = newState(today);
  const flags = { empty: false, status: 200 };
  const { page, context, errors } = await newPage(browser, width, lang, state, { empty: () => flags.empty, overviewStatus: () => flags.status });
  const narrow = width < 768;
  try {
    await page.goto(`${BASE}/dashboard/owner/today`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="ovw-kpis"]', { timeout: 20000 });
    await page.waitForSelector('[data-testid="ovw-row"]');

    // -- structure
    ok((await page.locator("h1").count()) === 1, `${tag}: exactly one h1`);
    ok((await page.locator('[data-testid="ovw-row"]').count()) === 9, `${tag}: 9 rows (7 booked + cancelled/refund pair)`);
    ok((await page.locator(narrow ? '[data-testid="ovw-cards"]' : "table").count()) === 1, `${tag}: ${narrow ? "card list" : "table"} shown`);
    if (!narrow) ok((await page.locator("thead th").count()) === 8, `${tag}: 8 table columns`);
    ok(await page.getByText(L.allCourts).first().isVisible(), `${tag}: "${L.allCourts}" label`);
    ok((await page.locator('[data-testid="kpi-total"]').innerText()).includes("96"), `${tag}: total slots 96`);
    ok((await page.locator('[data-testid="kpi-pending-n"]').innerText()).trim() === "7", `${tag}: pending (any date) 7`);
    ok((await page.locator('[data-testid="kpi-free"], [data-testid="kpi-booked"]').count()) === 0, `${tag}: no Free / Booked slot cards`);
    ok((await page.locator('[data-testid="kpi-refunds"]').innerText()).includes("PKR 4,500"), `${tag}: refunds amount`);
    ok((await page.locator('[data-testid="kpi-collected"]').innerText()).includes("PKR 31,500"), `${tag}: collected`);
    ok((await page.locator('[data-testid="kpi-due"]').innerText()).includes("PKR 12,000"), `${tag}: due`);
    const pendingHref = await page.locator('[data-testid="kpi-pending-link"]').getAttribute("href");
    ok(pendingHref === "/dashboard/owner/approvals", `${tag}: pending card href, no date (${pendingHref})`);
    const payHref = await page.locator('[data-testid="kpi-pay-waiting"]').getAttribute("href");
    ok(payHref === `/dashboard/bookings?from=${addDays(today, -365)}&to=${addDays(today, 365)}&status=held`, `${tag}: payment waiting href, any date (${payHref})`);
    ok((await page.locator('[data-testid="ovw-history-link"]').getAttribute("href")) === `/dashboard/bookings?from=${today}&to=${today}`, `${tag}: history button href`);
    const addHref = await page.locator('[data-testid="ovw-add-booking"]').getAttribute("href");
    ok(addHref === "/dashboard/owner/walkin", `${tag}: add booking href`);
    await noHScroll(page, `${tag} loaded`);
    await page.screenshot({ path: path.join(SHOT_DIR, `overview-${tag}.png`), fullPage: true });

    // -- "+N aur" popover
    await page.locator('[data-testid="ovw-more-courts"]').click();
    const pop = page.locator('[data-testid="ovw-courts-popover"]');
    await pop.waitFor();
    ok((await pop.locator("a").count()) === 8, `${tag}: popover lists all 8 courts`);
    const firstHref = await pop.locator("a").first().getAttribute("href");
    ok(firstHref === `/dashboard/bookings?from=${today}&to=${today}&courts=c1&status=booked`, `${tag}: popover row adds one court (${firstHref})`);
    await page.screenshot({ path: path.join(SHOT_DIR, `popover-${tag}.png`) });
    await page.keyboard.press("Escape");
    ok((await pop.count()) === 0, `${tag}: Escape closes the popover`);

    // -- slots popup
    const seeBtn = page.locator('[data-testid="ovw-see-slots"]');
    await seeBtn.click();
    const dlg = page.locator('[data-testid="ovw-slots-dialog"]');
    await dlg.waitFor();
    await page.waitForSelector('[data-testid="ovw-slots-court"] li[data-slot-view]');
    await page.waitForTimeout(300);
    ok((await dlg.locator('[data-testid="ovw-slots-court"]').count()) === 8, `${tag}: slots popup has 8 court groups`);
    ok((await dlg.locator('li[data-slot-view="booked"]').count()) > 0 && (await dlg.locator('li[data-slot-view="pending"]').count()) > 0 && (await dlg.locator('li[data-slot-view="blocked"]').count()) > 0, `${tag}: slot statuses rendered`);
    ok((await dlg.locator('li[data-slot-view="past"], li[data-slot-view="free"]').count()) > 0, `${tag}: free/past slots rendered`);
    await noHScroll(page, `${tag} slots popup`);
    await page.screenshot({ path: path.join(SHOT_DIR, `slots-${tag}.png`) });
    await page.keyboard.press("Escape");
    ok((await dlg.count()) === 0, `${tag}: Escape closes slots popup`);
    ok(await seeBtn.evaluate((el) => el === document.activeElement), `${tag}: focus returns to the opener`);

    // -- filter pills
    await page.locator('[data-testid="ovw-pill-refund"]').click();
    ok((await page.locator('[data-testid="ovw-row"]').count()) === 1, `${tag}: Refund pill filters to 1 row`);
    await page.locator('[data-testid="ovw-pill-cancelled"]').click();
    ok((await page.locator('[data-testid="ovw-row"]').count()) === 1, `${tag}: Cancelled pill filters to 1 row`);
    await page.locator('[data-testid="ovw-pill-booked"]').click();
    ok((await page.locator('[data-testid="ovw-row"]').count()) === 7, `${tag}: Booked pill shows the 7 booked rows`);
    await page.locator('[data-testid="ovw-pill-all"]').click();

    // -- original booking chip
    await page.locator('[data-testid="ovw-original"]').last().click(); // on the refund row
    await page.waitForTimeout(400);
    const hl = await page.evaluate(() => {
      const el = document.getElementById("ovw-row-b8-cancelled");
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { shadow: cs.boxShadow, ring: el.className.includes("ring-4") };
    });
    ok(hl && (hl.ring || hl.shadow !== "none"), `${tag}: original row highlighted`);

    // -- completion Haan (optimistic + body)
    const zara = page.locator('[data-testid="ovw-row"]', { hasText: "Zara Noor" });
    await zara.locator("select").selectOption("yes");
    ok((await zara.getAttribute("data-tone")) === "green", `${tag}: Haan turns the row green at once`);
    await page.waitForTimeout(500);
    ok(state.calls.some((c) => c.id === "b5" && c.body.result === "yes"), `${tag}: Haan posts {result:yes}`);
    ok(await zara.getByText(L.complete, { exact: true }).first().isVisible(), `${tag}: Mukammal chip`);
    ok((await zara.innerText()).includes("2,400"), `${tag}: total shown`);

    // -- completion Nahi: dialog, validation, mic, body
    const imran = page.locator('[data-testid="ovw-row"]', { hasText: "Imran Shah" });
    await imran.locator("select").selectOption("no");
    const cd = page.locator('[data-testid="ovw-completion-dialog"]');
    await cd.waitFor();
    ok((await cd.getByRole("heading").first().innerText()).length > 3, `${tag}: Nahi dialog title`);
    await cd.locator('[data-testid="ovw-received"]').fill("99999");
    await cd.locator('[data-testid="ovw-completion-save"]').click();
    ok((await cd.locator('[data-testid="ovw-received"]').getAttribute("aria-invalid")) === "true", `${tag}: out-of-range amount rejected`);
    ok(state.calls.filter((c) => c.id === "b6").length === 0, `${tag}: nothing posted for a bad amount`);
    await cd.locator('[data-testid="ovw-received"]').fill("1,000");
    await cd.locator("textarea").fill("customer ne kaha kal dega");
    const micThere = (await cd.locator('[data-testid="voice-mic"]').count()) === 1;
    const micSupported = await page.evaluate(() => "webkitSpeechRecognition" in window || "SpeechRecognition" in window);
    ok(micThere === micSupported, `${tag}: mic shown only when speech recognition exists (shown=${micThere}, supported=${micSupported})`);
    ok((await cd.locator('[data-testid="ovw-preview"]').innerText()).includes("PKR 1,500"), `${tag}: preview shows the due that will remain (2,500 - 1,000)`);
    await noHScroll(page, `${tag} nahi dialog`);
    await page.screenshot({ path: path.join(SHOT_DIR, `nahi-${tag}.png`) });
    await cd.locator('[data-testid="ovw-completion-save"]').click();
    await cd.waitFor({ state: "detached" });
    ok(state.calls.some((c) => c.id === "b6" && c.body.result === "no" && c.body.received_now === 1000 && /kal dega/.test(c.body.reason)), `${tag}: Nahi posts received_now and reason`);
    await page.waitForTimeout(400);
    ok((await imran.getAttribute("data-tone")) === "red", `${tag}: Nahi turns the row red`);
    ok(await imran.getByText(L.incomplete, { exact: true }).first().isVisible(), `${tag}: Adhoora chip`);

    // -- error answers: 400 too early (rollback + message), then 403 (disabled + hint)
    const nida = page.locator('[data-testid="ovw-row"]', { hasText: "Nida Rauf" });
    state.fail = { status: 400, code: "COMPLETION_TOO_EARLY" };
    await nida.locator("select").selectOption("yes");
    await page.locator('[data-testid="ovw-message"]').waitFor();
    ok((await nida.getAttribute("data-tone")) === "none", `${tag}: failed Haan rolls the row back`);
    ok((await nida.locator("select").inputValue()) === "", `${tag}: select back to Choose`);
    state.fail = { status: 403, code: "FORBIDDEN" };
    await nida.locator("select").selectOption("yes");
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="ovw-completion-select"]:not([disabled])').length === 0, null, { timeout: 5000 });
    ok(await page.getByText(/permission|ijazat/i).first().isVisible(), `${tag}: 403 shows the permission message`);
    await page.screenshot({ path: path.join(SHOT_DIR, `denied-${tag}.png`), fullPage: true });

    // -- not-yet-ended rows are disabled with the hint
    const hamza = page.locator('[data-testid="ovw-row"]', { hasText: "Hamza Ali" });
    ok(await hamza.locator("select").isDisabled(), `${tag}: Slot not ended -> select disabled`);

    // -- row click opens the detail popup
    await page.locator('[data-testid="ovw-open-detail"]').first().click();
    await page.locator('[role="dialog"]').first().waitFor();
    ok(true, `${tag}: detail opens`);
    await page.keyboard.press("Escape");
    await page.locator('[role="dialog"]').first().waitFor({ state: "detached" }).catch(() => {});

    // -- date + courts in the URL
    state.overviewUrls.length = 0;
    await page.locator('[data-testid="ovw-date-trigger"]').click();
    await page.getByRole("button", { name: L.tomorrow, exact: true }).click();
    await page.waitForFunction(() => location.search.includes("date="));
    const tomorrow = addDays(today, 1);
    ok(page.url().includes(`date=${tomorrow}`), `${tag}: date in the URL`);
    await page.waitForSelector('[data-testid="ovw-kpis"]');
    ok(state.overviewUrls.some((u) => u.includes(`date=${tomorrow}`)), `${tag}: overview requested for tomorrow`);

    await page.locator('[data-testid="ovw-courts-trigger"]').click();
    const opts = page.locator('[data-testid="ovw-courts-panel"] [role="option"]');
    ok((await opts.count()) === 9, `${tag}: courts listbox has All + 8 options`);
    await page.keyboard.press("ArrowDown"); // from the autofocused "All courts" to Court 1
    await page.keyboard.press("ArrowDown"); // Court 2
    await page.keyboard.press("Space");
    await page.waitForFunction(() => location.search.includes("courts="));
    ok(/courts=c2(&|$)/.test(page.url()), `${tag}: keyboard picks Court 2 (${page.url()})`);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter"); // adds Court 3
    await page.waitForFunction(() => location.search.includes("courts=c2,c3"));
    await page.keyboard.press("Escape");
    state.overviewUrls.length = 0;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="ovw-kpis"]');
    ok(page.url().includes(`date=${tomorrow}`) && page.url().includes("courts=c2,c3"), `${tag}: filters survive a reload`);
    ok(state.overviewUrls.some((u) => u.includes("court_ids=c2,c3") || u.includes("court_ids=c2%2Cc3")), `${tag}: overview asked for the 2 courts (${state.overviewUrls.join(" | ")})`);
    ok((await page.locator('[data-testid="ovw-courts-trigger"]').innerText()).includes("2"), `${tag}: courts label shows 2`);
    ok((await page.locator('[data-testid="ovw-date-trigger"]').innerText()).length > 4, `${tag}: date label`);
    await noHScroll(page, `${tag} filtered`);

    // -- empty + error states
    flags.empty = true;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator('[data-testid="ovw-empty"]').waitFor();
    ok((await page.locator('[data-testid="ovw-empty"]').innerText()).includes(L.empty), `${tag}: empty state text`);
    flags.empty = false;
    flags.status = 500;
    await page.reload({ waitUntil: "domcontentloaded" });
    const retry = page.getByRole("button", { name: /Retry|Try again|Dobara/i });
    await retry.first().waitFor({ timeout: 25000 });
    flags.status = 200;
    await retry.first().click();
    await page.waitForSelector('[data-testid="ovw-kpis"]');
    ok(true, `${tag}: error state recovers on retry`);
    await noHScroll(page, `${tag} end`);
    ok(errors.length === 0, `${tag}: console errors: ${errors.slice(0, 3).join(" || ")}`);
  } catch (e) {
    failures.push(`${tag}: script error: ${String(e.message).split("\n")[0]}`);
    await page.screenshot({ path: path.join(SHOT_DIR, `fail-${tag}.png`), fullPage: true }).catch(() => {});
  } finally {
    await context.close();
  }
}

// the fixture and mocks are shared with e2e/round2-overview-check.cjs
module.exports = { API, COURTS, VENUE, USER, pktToday, addDays, newState, overviewOf, slotsOf, mockApi, newPage };

if (require.main === module) {
  (async () => {
    let pw;
    try {
      pw = loadPlaywright();
    } catch (e) {
      console.error(e.message);
      process.exit(2);
    }
    const browser = await pw.chromium.launch();
    for (const lang of LANGS) for (const width of WIDTHS) await runOne(browser, width, lang);
    await browser.close();
    console.log(`${checks} checks, ${failures.length} failure(s). Screenshots: ${SHOT_DIR}`);
    for (const f of failures) console.log("FAIL " + f);
    process.exit(failures.length ? 1 : 0);
  })();
}
