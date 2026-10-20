#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Owner Round 2 (W3) check: refund breakdown dialog (A10) and the readable bell (A6). The API is MOCKED (context.route), no
 * backend needed. The old Venue Settings / wizard sections (advance card, preview-only reminders card) were RETIRED after
 * Stage 2: `stage2-settings-cnic-check.cjs` covers the saveable timers card, the advance card and every "Default" hint now.
 * Stage 2: a refund whose screenshot was also credited on other bookings shows a warning chip (OwnerRefund.duplicate_proof).
 * Run against a PRODUCTION build served from a COPY of apps/web (never next dev):
 *   BASE_URL=http://localhost:3823 PLAYWRIGHT_PATH=... node e2e/round2-refunds-settings-bell-check.cjs
 * Covers en + ru at 360 / 768 / 1280.
 * QA round 2 fixes: a staff member without the refunds permission (403 NOT_STAFF_PERMITTED) sees ONE clear state
 * (no "Nothing owed right now" next to an error), and a late screenshot reads as its own bell item (kind late_payment).
 */
const { loadPlaywright } = require("./smoke.cjs");

const BASE = (process.env.BASE_URL || "http://localhost:3823").replace(/\/+$/, "");
const API = (process.env.API_URL || "http://localhost:8000").replace(/\/+$/, "");
const SHOTS = process.env.SHOT_DIR || require("os").tmpdir();
const WIDTHS = (process.env.WIDTHS || "360,768,1280").split(",").map(Number);
const LANGS = (process.env.LANGS || "en,ru").split(",");

const PKT = 5 * 3600e3;
/** Today's Pakistan date at hh:mm PKT, as a UTC ISO string. */
function pktToday(h, m = 0, dayOffset = 0) {
  const now = new Date(Date.now() + PKT);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + dayOffset, h, m) - PKT).toISOString();
}
const iso = (minsAgo) => new Date(Date.now() - minsAgo * 60e3).toISOString();

const USER = { id: "u1", role: "owner", name: "Owner Test", phone: "+923000000002", email: null, city: null, gender: null, created_at: iso(9999) };
const COURT = {
  id: "c1", venue_id: "v1", name: "Futsal 1", sport: "Futsal", slot_minutes: 60, is_indoor: false, has_floodlights: false, is_active: true,
  cancellation_allowed: true, cancellation_cutoff_hours: null, advance_type: "percent", advance_value: 50, advance_minimum: null, photo_urls: [], photo_keys: [], photos: [],
  schedule_templates: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ id: "s" + d, day_of_week: d, open_time: "06:00:00", close_time: "23:00:00", is_active: true, closes_next_day: false })),
  pricing_rules: [{ id: "p1", name: "All day", priority: 0, day_of_week: null, start_time: null, end_time: null, price_per_slot: 4000, floodlight_surcharge: 0, advance_percentage: 100, is_active: true }],
};
const VENUE = {
  id: "v1", owner_id: "u1", name: "Arena Khelo", slug: "arena-khelo", status: "approved", city: "Karachi", area: "DHA", address: "Street 1", sports: ["Futsal"],
  amenities: [], photo_urls: [], photo_keys: [], photos: [], whatsapp: null, bank_details: null, cancellation_allowed: true, cancellation_cutoff_hours: null, booking_horizon_days: 90,
  courts: [COURT], average_rating: null, review_count: 0, is_active: true, created_at: iso(9999),
};

function refund(id, over) {
  return {
    id, booking_id: "b-" + id, court_name: "Futsal 1", court_id: "c1", court_sport: "Futsal", venue_name: "Arena Khelo", player_name: "Abbas Zafar", player_phone: null,
    starts_at: pktToday(21), reason: "overpayment_excess", refund_amount: 2000, refund_status: "owed", refunded_amount: null, remaining_amount: 2000,
    refund_reference: null, refunded_at: null, created_at: iso(30), is_overdue: false, ...over,
  };
}
const REFUNDS = [
  refund("r1", { player_sent: 10000, refund_due: 2000, already_refunded: 0, payment_id: "pay1", duplicate_proof: { used_on_bookings: 2 } }),
  refund("r2", { duplicate_proof: null, player_name: "Mujtaba Anwer", player_sent: 5000, refund_due: 3000, already_refunded: 1000, refunded_amount: 1000, remaining_amount: 2000, refund_amount: 3000 }),
  refund("r3", { player_name: "Sara Khan", player_sent: 1500, refund_due: 1500, already_refunded: 1500, refunded_amount: 1500, remaining_amount: 0, refund_amount: 1500 }),
  refund("r4", { player_name: "Old Backend", refund_amount: 1200, remaining_amount: undefined, refunded_amount: null }),
];

function feedItems() {
  return [
    {
      id: "n1", event_type: "payment_submitted", kind: "payment_waiting", created_at: iso(1),
      params: { player_name: "Abbas Zafar", court_name: "Futsal 1", starts_at: pktToday(21), amount: 2000 },
      link: { kind: "approvals" }, deliveries: [{ channel: "whatsapp", status: "sent" }],
    },
    {
      id: "n2", event_type: "refund_owed", kind: "refund_owed", created_at: pktToday(12, 0, -1),
      params: { player_name: "Mujtaba Anwer", amount: 8000 }, link: { kind: "refunds" },
      deliveries: [{ channel: "whatsapp", status: "failed" }, { channel: "sms", status: "sent" }],
    },
    {
      id: "n4", event_type: "late_payment_proof", kind: "late_payment", created_at: iso(5),
      params: { player_name: "Late Larki", court_name: "Futsal 1", starts_at: pktToday(21), amount: 2000 },
      link: { kind: "approvals", booking_id: "b-late" }, deliveries: [{ channel: "push", status: "sent" }],
    },
    { id: "n3", event_type: "weird_new_event", kind: "other", created_at: pktToday(12, 0, -5), params: {}, link: { kind: "none" }, deliveries: [] },
  ];
}
const LEGACY = [
  { id: "l1", channel: "whatsapp", event_type: "payment_submitted", status: "failed", reference_id: "p1", created_at: iso(3) },
  { id: "l2", channel: "sms", event_type: "payment_submitted", status: "sent", reference_id: "p1", created_at: iso(2) },
  { id: "l3", channel: "push", event_type: "something_brand_new", status: "sent", reference_id: null, created_at: iso(50) },
];

const TEXT = {
  en: {
    partial: "Partly refunded",
    exceeds10k: "You entered 10,000, but only PKR 2,000 is owed back.",
    exceedsServer: "You entered 2,000, but only PKR 1,500 is owed back.",
    full: "Full PKR 2,000",
    none: "No refund left to send",
    success: "Refund recorded",
    dup: "This screenshot was also credited on 2 other bookings",
    bellTitle: "New payment waiting for approval",
    bellContext: "Abbas Zafar - Futsal 1 - Today 9 PM - PKR 2,000",
    bellDelivery: "Sent by WhatsApp",
    bellSms: "Sent by SMS (WhatsApp failed)",
    today: "Today",
    yesterday: "Yesterday",
    legacyTitle: "Update: Something brand new",
    bellLate: "Screenshot arrived after the hold had expired",
    bellLateContext: "Late Larki - Futsal 1 - Today 9 PM - PKR 2,000",
    noPermTitle: "You don't have permission for this",
    nothingOwed: "Nothing owed right now",
  },
  ru: {
    partial: "Hissa wapas",
    exceeds10k: "Aap ne 10,000 likha, lekin sirf PKR 2,000 wapas banta hai.",
    exceedsServer: "Aap ne 2,000 likha, lekin sirf PKR 1,500 wapas banta hai.",
    full: "Poora PKR 2,000",
    none: "Koi refund baqi nahi",
    success: "Refund record ho gaya",
    dup: "Ye screenshot 2 aur bookings par bhi credit hua",
    bellTitle: "Naya payment approval ke liye",
    bellContext: "Abbas Zafar - Futsal 1 - Aaj 9 PM - PKR 2,000",
    bellDelivery: "WhatsApp par bheja gaya",
    bellSms: "SMS par bheja gaya (WhatsApp par nahi gaya)",
    today: "Aaj",
    yesterday: "Kal",
    legacyTitle: "Update: Something brand new",
    bellLate: "Screenshot hold khatam hone ke baad aaya",
    bellLateContext: "Late Larki - Futsal 1 - Aaj 9 PM - PKR 2,000",
    noPermTitle: "Aap ke paas is kaam ki ijazat nahi",
    nothingOwed: "Abhi kuch dena nahi",
  },
};

function freshState() {
  return { markCalls: [], markMode: "exceeds-then-ok", feed: "ok", unmocked: [] };
}

async function newCtx(browser, { width, lang, state }) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  await context.addCookies([{ name: "khelo_lang", value: lang, url: BASE }]);
  await context.addInitScript((user) => {
    if (!localStorage.getItem("maidan.session_token")) {
      localStorage.setItem("maidan.session_token", "tok");
      localStorage.setItem("maidan.session_expires_at", new Date(Date.now() + 7 * 3600e3).toISOString());
      localStorage.setItem("maidan.cached_user", JSON.stringify(user));
    }
  }, USER);
  const cors = (route) => {
    const req = route.request();
    return { "access-control-allow-origin": req.headers()["origin"] || "*", "access-control-allow-headers": req.headers()["access-control-request-headers"] || "*", "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS", "access-control-max-age": "600" };
  };
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", headers: cors(route), body: JSON.stringify(body) });
  await context.route(new RegExp("^" + API.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&") + "/"), async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors(route) });
    const u = new URL(req.url());
    const p = u.pathname.replace(/^\/api\/v1/, "");
    if (p === "/auth/me") return json(route, { user: USER, session: { device_id: null, device_name: null, platform: "web", last_active_at: iso(0), expires_at: new Date(Date.now() + 7 * 3600e3).toISOString() } });
    if (p === "/feature-flags") return json(route, { flags: {} });
    if (p === "/owners/venues") return json(route, [VENUE]);
    if (p === "/owners/badges") return json(route, { approvals: 1, refunds: 4 });
    if (p === "/owners/premium/notices") return json(route, []);
    if (p === "/owners/me/permissions") return json(route, { role: "owner", venue_permissions: [{ venue_id: "v1", permissions: [] }] });
    if (p === "/owners/identity") return json(route, { status: "verified", masked: "*****-*******-1", flags: [] });
    if (p === "/users/me/web-push/config") return json(route, { enabled: false, public_key: null });
    if (p === "/owners/refunds") {
      if (state.refunds === "denied") return json(route, { error: { code: "NOT_STAFF_PERMITTED", message: "Your account isn't allowed to do this." } }, 403);
      return json(route, REFUNDS);
    }
    if (/^\/owners\/refunds\/[^/]+\/mark-refunded$/.test(p)) {
      state.markCalls.push(Date.now());
      await new Promise((r) => setTimeout(r, 300)); // slow enough for a double click to land while busy
      if (state.markMode === "exceeds-then-ok" && state.markCalls.length === 1) {
        return json(route, { error: { code: "REFUND_EXCEEDS_OWED_AMOUNT", message: "That's more than what's owed on this booking", details: { remaining: 1500, typed: 2000 } } }, 400);
      }
      return json(route, { ...REFUNDS[0], refunded_amount: 1500, remaining_amount: 0, refund_status: "refunded" });
    }
    if (/^\/payments\/[^/]+\/proof-url$/.test(p)) return json(route, { url: "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACwAAAAAAQABAAACAkQBADs=", expires_in: 300 });
    if (p === "/users/me/notifications/feed") {
      if (state.feed === "missing") return json(route, { error: { code: "NOT_FOUND", message: "Not Found" } }, 404);
      return json(route, { items: feedItems(), page: 1, page_size: 30, has_more: false });
    }
    if (p === "/users/me/notifications") return json(route, LEGACY);
    if (p === "/courts/c1") return json(route, COURT);
    if (p === "/courts/c1/blackouts") return json(route, []);
    if (p === "/courts/c1/advance-explain") {
      return json(route, { mode: "percent", value: 50, minimum: null, hourly_price: 4000, example_minutes: 60, example_total: 4000, example_advance: 2000, default_rule: { source: "pricing_rule", percentage: 100, value_if_nothing_set: 4000 } });
    }
    if (p === "/owners/approvals-queue") return json(route, { items: [], total: 0, page: 1, page_size: 50 });
    if (p === "/owners/pending-approvals") return json(route, []);
    state.unmocked.push(p);
    return json(route, { error: { code: "NOT_FOUND", message: "unmocked " + p } }, 404);
  });
  return context;
}

async function openPage(context, url, errors) {
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    if (/Failed to load resource/.test(m.text())) return; // mocked 404s (old-endpoint fallback, unmocked extras) are listed separately
    errors.push("console: " + m.text().slice(0, 200));
  });
  await page.goto(BASE + url, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  return page;
}

const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const overflowInfo = (page) =>
  page.evaluate(() => {
    const w = window.innerWidth;
    const out = [];
    document.querySelectorAll("body *").forEach((e) => {
      const r = e.getBoundingClientRect();
      if (r.width > 0 && r.right > w + 0.5) out.push(e.tagName + "." + (e.getAttribute("data-testid") || String(e.className).slice(0, 40)) + "@" + Math.round(r.right));
    });
    return out.slice(0, 5).join(", ");
  });

async function refundsCheck(browser, width, lang, f) {
  const T = TEXT[lang];
  const errors = [];
  const state = freshState();
  const context = await newCtx(browser, { width, lang, state });
  const page = await openPage(context, "/dashboard/owner/refunds", errors);
  const tag = `refunds ${lang}@${width}`;
  if ((await page.locator("h1").count()) !== 1) f.push(`${tag}: expected one h1, got ${await page.locator("h1").count()}`);
  const rows = page.locator('[data-testid="refund-row"]');
  if ((await rows.count()) !== 4) f.push(`${tag}: ${await rows.count()} rows`);
  if (!(await rows.nth(1).innerText()).includes(T.partial)) f.push(`${tag}: partial row has no "${T.partial}" chip`);
  if ((await rows.nth(0).locator('[data-testid="shot-thumb"]').count()) < 1) f.push(`${tag}: row with payment id shows no screenshot thumb`);
  if ((await rows.nth(3).locator('[data-testid="shot-thumb"]').count()) !== 0) f.push(`${tag}: row without payment id shows a thumb`);
  // Stage 2: duplicate_proof -> warning chip (icon + text) only on that row; null / missing -> nothing
  const dup = rows.nth(0).locator('[data-testid="refund-dup-chip"]');
  if ((await dup.count()) !== 1) f.push(`${tag}: duplicate_proof row has no warning chip`);
  else {
    const dt = (await dup.innerText()).trim();
    if (dt !== T.dup) f.push(`${tag}: duplicate chip text "${dt}"`);
    if ((await dup.locator("svg").count()) !== 1) f.push(`${tag}: duplicate chip has no icon`);
  }
  if ((await page.locator('[data-testid="refund-dup-chip"]').count()) !== 1) f.push(`${tag}: duplicate chip on rows without duplicate_proof`);
  if ((await overflow(page)) > 1) f.push(`${tag}: horizontal scroll: ${await overflowInfo(page)}`);
  await page.screenshot({ path: `${SHOTS}/w3-refunds-${lang}-${width}.png`, fullPage: true });

  // ---- r1: breakdown, prefill, max, chip, client + server error, no double submit, success ----
  await rows.nth(0).getByRole("button", { name: /Refund ho gaya|Mark|refund/i }).last().click();
  const dlg = page.locator('[data-testid="refund-dialog"]');
  await dlg.waitFor();
  const bd = async (id) => (await dlg.locator(`[data-testid="${id}"]`).innerText()).trim();
  if ((await bd("bd-player-sent")) !== "PKR 10,000") f.push(`${tag}: player sent = ${await bd("bd-player-sent")}`);
  if ((await bd("bd-refund-due")) !== "PKR 2,000") f.push(`${tag}: refund due = ${await bd("bd-refund-due")}`);
  if ((await bd("bd-already")) !== "PKR 0") f.push(`${tag}: already = ${await bd("bd-already")}`);
  if ((await bd("bd-remaining")) !== "PKR 2,000") f.push(`${tag}: remaining = ${await bd("bd-remaining")}`);
  const amount = dlg.locator('[data-testid="refund-amount"]');
  if ((await amount.inputValue()) !== "2000") f.push(`${tag}: amount prefilled "${await amount.inputValue()}"`);
  const focused = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute("data-testid"));
  if (focused !== "refund-amount") f.push(`${tag}: focus not on amount (on ${focused})`);
  if ((await dlg.locator('[data-testid="refund-full-chip"]').innerText()).trim() !== T.full) f.push(`${tag}: chip text "${await dlg.locator('[data-testid="refund-full-chip"]').innerText()}"`);
  await amount.fill("10000");
  const errText = (await dlg.locator('[data-testid="refund-amount-error"]').innerText()).replace(/^!\s*/, "").trim();
  if (errText !== T.exceeds10k) f.push(`${tag}: client error "${errText}"`);
  await dlg.locator('[data-testid="refund-full-chip"]').click();
  if ((await amount.inputValue()) !== "2000") f.push(`${tag}: chip did not fill the remaining`);
  if (await dlg.locator('[data-testid="refund-amount-error"]').count()) f.push(`${tag}: error stays after chip`);
  // reference required
  await dlg.locator('[data-testid="refund-submit"]').click();
  if (!(await dlg.locator('[role="alert"]').count())) f.push(`${tag}: no reference error on empty submit`);
  if (state.markCalls.length !== 0) f.push(`${tag}: submitted without a reference`);
  await dlg.locator('[data-testid="refund-reference"]').fill("TXN 123456");
  await dlg.locator('[data-testid="refund-submit"]').click();
  await dlg.locator('[data-testid="refund-server-error"]').waitFor({ timeout: 5000 }).catch(() => {});
  const srv = ((await dlg.locator('[data-testid="refund-server-error"]').innerText().catch(() => "")) || "").replace(/^!\s*/, "").trim();
  if (srv !== T.exceedsServer) f.push(`${tag}: server error "${srv}"`);
  if ((await bd("bd-remaining")) !== "PKR 1,500") f.push(`${tag}: remaining after server error = ${await bd("bd-remaining")}`);
  await dlg.locator('[data-testid="refund-full-chip"]').click();
  await dlg.locator('[data-testid="refund-submit"]').dblclick();
  await dlg.locator('[data-testid="refund-success"]').waitFor({ timeout: 5000 }).catch(() => {});
  if (state.markCalls.length !== 2) f.push(`${tag}: ${state.markCalls.length} mark-refunded calls (double submit?)`);
  if (!(await dlg.innerText()).includes(T.success)) f.push(`${tag}: no success summary`);
  if ((await overflow(page)) > 1) f.push(`${tag}: dialog horizontal scroll: ${await overflowInfo(page)}`);
  await page.screenshot({ path: `${SHOTS}/w3-refund-dialog-${lang}-${width}.png` });
  await page.keyboard.press("Escape");

  // ---- r3: remaining 0 -> no form ----
  await page.waitForTimeout(200);
  if (await dlg.count()) await dlg.getByRole("button").last().click();
  await rows.nth(2).getByRole("button").last().click();
  await dlg.waitFor();
  if (!(await dlg.innerText()).includes(T.none)) f.push(`${tag}: remaining-0 dialog has no "${T.none}"`);
  if (await dlg.locator('[data-testid="refund-amount"]').count()) f.push(`${tag}: remaining-0 dialog still has an amount form`);
  if (!(await dlg.locator('[data-testid="refund-none"]').count())) f.push(`${tag}: remaining-0 has no reason line`);
  await page.keyboard.press("Escape");
  if (await dlg.count()) f.push(`${tag}: Escape did not close the dialog`);
  for (const e of errors) f.push(`${tag}: ${e}`);
  if (state.unmocked.length) console.log(`  (${tag} unmocked: ${[...new Set(state.unmocked)].join(", ")})`);
  await context.close();
}

async function refundsDeniedCheck(browser, width, lang, f) {
  const T = TEXT[lang];
  const errors = [];
  const state = freshState();
  state.refunds = "denied";
  const context = await newCtx(browser, { width, lang, state });
  const page = await openPage(context, "/dashboard/owner/refunds", errors);
  const tag = `refunds-denied ${lang}@${width}`;
  await page.locator('[data-testid="refunds-no-permission"]').waitFor({ timeout: 15000 }).catch(() => {});
  const body = await page.locator("main").first().innerText().catch(() => page.locator("body").innerText());
  if (!(await page.locator('[data-testid="refunds-no-permission"]').count())) f.push(`${tag}: no no-permission state`);
  if (!body.includes(T.noPermTitle)) f.push(`${tag}: no "${T.noPermTitle}"`);
  if (body.includes(T.nothingOwed)) f.push(`${tag}: still says "${T.nothingOwed}" next to the error`);
  if (await page.locator('[data-testid="refunds-count"]').count()) f.push(`${tag}: count line shown`);
  if (await page.locator('[data-testid="refund-row"]').count()) f.push(`${tag}: rows shown`);
  if ((await page.locator("h1").count()) !== 1) f.push(`${tag}: one h1`);
  if ((await overflow(page)) > 1) f.push(`${tag}: horizontal scroll: ${await overflowInfo(page)}`);
  await page.screenshot({ path: `${SHOTS}/w3-refunds-denied-${lang}-${width}.png`, fullPage: true });
  for (const e of errors) if (!/403/.test(e)) f.push(`${tag}: ${e}`);
  await context.close();
}

async function bellCheck(browser, width, lang, f) {
  const T = TEXT[lang];
  const errors = [];
  const state = freshState();
  const context = await newCtx(browser, { width, lang, state });
  const page = await openPage(context, "/dashboard/owner/refunds", errors);
  const tag = `bell ${lang}@${width}`;
  const bell = page.locator('[data-testid="notification-bell"]:visible').first();
  await bell.click();
  const panel = page.locator('[data-testid="notification-panel"]:visible').first();
  await panel.waitFor();
  const txt = await panel.innerText();
  void txt;
  const titles = await panel.locator('[data-testid="notification-title"]').allInnerTexts();
  if (titles.some((x) => /^(new notification|nayi notification)/i.test(x))) f.push(`${tag}: a title says "New notification"`);
  if (!titles.some((x) => x.startsWith(T.bellTitle))) f.push(`${tag}: titles ${JSON.stringify(titles)}`);
  const ctxs = await panel.locator('[data-testid="notification-context"]').allInnerTexts();
  if (!ctxs.includes(T.bellContext)) f.push(`${tag}: contexts ${JSON.stringify(ctxs)}`);
  if (!titles.some((x) => x.startsWith(T.bellLate))) f.push(`${tag}: no late-screenshot title (${JSON.stringify(titles)})`);
  if (!ctxs.includes(T.bellLateContext)) f.push(`${tag}: late-screenshot context missing (${JSON.stringify(ctxs)})`);
  const metas = await panel.locator('[data-testid="notification-meta"]').allInnerTexts();
  if (!metas.some((m) => m.includes(T.bellDelivery))) f.push(`${tag}: no WhatsApp delivery line (${JSON.stringify(metas)})`);
  if (!metas.some((m) => m.includes(T.bellSms))) f.push(`${tag}: WhatsApp-then-SMS not one row (${JSON.stringify(metas)})`);
  const heads = await panel.locator('[data-testid="notification-day"] h3').allInnerTexts();
  if (heads.length !== 3 || heads[0].toLowerCase() !== T.today.toLowerCase() || heads[1].toLowerCase() !== T.yesterday.toLowerCase()) f.push(`${tag}: day groups ${JSON.stringify(heads)}`);
  if ((await panel.locator('[data-testid="notification-unread-dot"]').count()) < 1) f.push(`${tag}: no unread dot`);
  if (!(await panel.locator('[data-testid="notification-popup-explain"]').count()) && !(await panel.innerText()).includes("Browser popups")) f.push(`${tag}: no Browser popups section`);
  if ((await overflow(page)) > 1) f.push(`${tag}: horizontal scroll with bell open: ${await overflowInfo(page)}`);
  await page.screenshot({ path: `${SHOTS}/w3-bell-${lang}-${width}.png` });
  await panel.locator('[data-testid="notification-mark-all"]').click();
  if ((await panel.locator('[data-testid="notification-unread-dot"]').count()) !== 0) f.push(`${tag}: unread dots after "mark all"`);
  // link closes the dropdown, then navigates
  await panel.locator('[data-testid="notification-row"] a').first().click();
  await page.waitForURL(/\/dashboard\/owner\/approvals/, { timeout: 8000 }).catch(() => f.push(`${tag}: link did not navigate (url ${page.url()})`));
  if (await page.locator('[data-testid="notification-panel"]:visible').count()) f.push(`${tag}: dropdown still open after navigating`);
  for (const e of errors) f.push(`${tag}: ${e}`);
  await context.close();
}

async function bellFallbackCheck(browser, f) {
  const errors = [];
  const state = freshState();
  state.feed = "missing";
  const context = await newCtx(browser, { width: 1280, lang: "en", state });
  const page = await openPage(context, "/dashboard/owner/refunds", errors);
  await page.locator('[data-testid="notification-bell"]:visible').first().click();
  const panel = page.locator('[data-testid="notification-panel"]:visible').first();
  await panel.waitFor();
  const titles = await panel.locator('[data-testid="notification-title"]').allInnerTexts();
  if (titles.length !== 2) f.push(`fallback: expected 2 folded rows, got ${titles.length} ${JSON.stringify(titles)}`);
  if (!titles.some((x) => x.startsWith("New payment waiting for approval"))) f.push(`fallback: titles ${JSON.stringify(titles)}`);
  if (!titles.some((x) => x.startsWith(TEXT.en.legacyTitle))) f.push(`fallback: unknown event title ${JSON.stringify(titles)}`);
  if (titles.some((x) => /^new notification/i.test(x))) f.push("fallback: a title says New notification");
  for (const e of errors) f.push(`fallback: ${e}`);
  await context.close();
}

async function run() {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  const fails = [];
  for (const lang of LANGS) {
    for (const width of WIDTHS) {
      const f = [];
      await refundsCheck(browser, width, lang, f);
      await refundsDeniedCheck(browser, width, lang, f);
      await bellCheck(browser, width, lang, f);
      console.log(`${lang}@${width}: ${f.length ? "FAIL" : "ok"}`);
      fails.push(...f);
    }
  }
  await bellFallbackCheck(browser, fails);
  await browser.close();
  if (fails.length) {
    console.log("\nFAILURES:\n- " + fails.join("\n- "));
    process.exit(1);
  }
  console.log(`\nall W3 checks passed (screenshots in ${SHOTS})`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
