#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Round 2 Stage 2 (agent W-A) check: venue timers card (Settings + wizard "Advanced", same fields), "Default: X" hints with
 * "Default par wapas" / "Abhi default chal raha hai", the CNIC wizard step / Settings card / owner banner, and the admin
 * CNIC page. The API is MOCKED (context.route), no backend needed.
 * Run against a PRODUCTION build served from a COPY of apps/web (never next dev):
 *   BASE_URL=http://localhost:3841 PLAYWRIGHT_PATH=... node e2e/stage2-settings-cnic-check.cjs
 * Covers en + ru at 360 / 768 / 1280 (env WIDTHS / LANGS to narrow).
 */
const { loadPlaywright } = require("./smoke.cjs");

const BASE = (process.env.BASE_URL || "http://localhost:3841").replace(/\/+$/, "");
const API = (process.env.API_URL || "http://localhost:8000").replace(/\/+$/, "");
const SHOTS = process.env.SHOT_DIR || require("os").tmpdir();
const WIDTHS = (process.env.WIDTHS || "360,768,1280").split(",").map(Number);
const LANGS = (process.env.LANGS || "en,ru").split(",");

const iso = (minsAgo) => new Date(Date.now() - minsAgo * 60e3).toISOString();
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const CNIC_DIGITS = "3520212345671";
const CNIC_MASK = "35202-1234567-1";

const OWNER = { id: "u1", role: "owner", name: "Owner Test", phone: "+923000000002", email: null, city: null, gender: null, created_at: iso(9999) };
const ADMIN = { ...OWNER, id: "a1", role: "admin", name: "Admin Test" };
const COURT = {
  id: "c1", venue_id: "v1", name: "Futsal 1", sport: "Futsal", slot_minutes: 60, is_indoor: false, has_floodlights: false, is_active: true,
  cancellation_allowed: true, cancellation_cutoff_hours: null, advance_type: null, advance_value: null, advance_minimum: null, photo_urls: [], photo_keys: [], photos: [],
  schedule_templates: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ id: "s" + d, day_of_week: d, open_time: "06:00:00", close_time: "23:00:00", is_active: true, closes_next_day: false })),
  pricing_rules: [{ id: "p1", name: "All day", priority: 0, day_of_week: null, start_time: null, end_time: null, price_per_slot: 4000, floodlight_surcharge: 0, advance_percentage: 100, is_active: true }],
};
const VENUE = {
  id: "v1", owner_id: "u1", name: "Arena Khelo", slug: "arena-khelo", status: "approved", city: "Karachi", area: "DHA", address: "Street 1", sports: ["Futsal"],
  amenities: [], photo_urls: [], photo_keys: [], photos: [], whatsapp: null, bank_details: null, cancellation_allowed: true, cancellation_cutoff_hours: 24, booking_horizon_days: 90,
  courts: [COURT], average_rating: null, review_count: 0, is_active: true, created_at: iso(9999),
};
const DEFAULTS = { hold_minutes: 15, reminders_enabled: true, first_reminder_after_min: 10, repeat_every_min: 30, max_reminders: 5, auto_cancel_enabled: true, auto_cancel_after_min: 120 };
const NULLS = { hold_minutes: null, reminders_enabled: null, first_reminder_after_min: null, repeat_every_min: null, max_reminders: null, auto_cancel_enabled: null, auto_cancel_after_min: null };

const ADMIN_ROWS = [
  { user_id: "o1", owner_name: "Abbas Zafar", phone_last4: "4571", status: "submitted", masked: "*****-*******-1", flags: ["duplicate_cnic"], submitted_at: iso(60) },
  { user_id: "o2", owner_name: "Mujtaba Anwer", phone_last4: "1234", status: "verified", masked: "*****-*******-7", flags: [], submitted_at: iso(600) },
  { user_id: "o3", owner_name: "No Card Yet", phone_last4: "9999", status: "missing", masked: null, flags: [], submitted_at: null },
];

const TEXT = {
  en: {
    defaultHold: "Default: 15 minutes",
    running: "Using the default now",
    reset: "Back to default",
    offWarning: "If you switch this off, a booking that is never approved keeps its slot blocked.",
    previewDefault: "Reminders at 10, 40, 70, 100 minutes. Final warning at 115, cancel at 120.",
    previewOff: "Auto-cancel is off.",
    saved: "Settings saved.",
    fullNote: "full amount for now",
    slotSettings: "Default: 1 hour",
    banner: "Give your CNIC",
    cnicSaved: "CNIC submitted.",
    logged: "This view is logged",
    verified: "Verified.",
    cnicInvalid: "The CNIC number must have 13 digits",
  },
  ru: {
    defaultHold: "Default: 15 minute",
    running: "Abhi default chal raha hai",
    reset: "Default par wapas",
    offWarning: "Band karne par approve na hone wali booking ka slot band rahega.",
    previewDefault: "Reminder 10, 40, 70, 100 minute par. 115 par aakhri warning, 120 par cancel.",
    previewOff: "Auto-cancel band hai.",
    saved: "Settings save ho gayin.",
    fullNote: "abhi poori raqam",
    slotSettings: "Default: 1 ghanta",
    banner: "CNIC dein",
    cnicSaved: "CNIC jama ho gaya.",
    logged: "Ye view log hota hai",
    verified: "Tasdeeq ho gaya.",
    cnicInvalid: "CNIC number 13 hindse ka hona chahiye",
  },
};

function freshState(over = {}) {
  return {
    user: OWNER,
    identity: { status: "missing", masked: null, flags: [] },
    timers: { values: { ...NULLS, hold_minutes: 20 }, defaults: DEFAULTS, effective: { ...DEFAULTS, hold_minutes: 20 } },
    calls: [],
    timerPuts: [],
    identityPosts: [],
    adminFullCalls: 0,
    adminFilters: [],
    unmocked: [],
    ...over,
  };
}

async function newCtx(browser, { width, lang, state }) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  await context.addCookies([{ name: "khelo_lang", value: lang, url: BASE }]);
  await context.addInitScript(
    ({ user, draft }) => {
      if (!localStorage.getItem("maidan.session_token")) {
        localStorage.setItem("maidan.session_token", "tok");
        localStorage.setItem("maidan.session_expires_at", new Date(Date.now() + 7 * 3600e3).toISOString());
        localStorage.setItem("maidan.cached_user", JSON.stringify(user));
        if (draft) localStorage.setItem("maidan.venue-setup-draft", JSON.stringify(draft));
      }
    },
    { user: state.user, draft: state.draft || null },
  );
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
    const m = req.method();
    state.calls.push(`${m} ${p}`);
    if (p === "/auth/me") return json(route, { user: state.user, session: { device_id: null, device_name: null, platform: "web", last_active_at: iso(0), expires_at: new Date(Date.now() + 7 * 3600e3).toISOString() } });
    if (p === "/feature-flags") return json(route, { flags: { split_payments: false } });
    if (p === "/owners/venues") return json(route, state.noVenues ? [] : [VENUE]);
    if (p === "/owners/me/permissions") return json(route, { role: "staff", venue_permissions: [{ venue_id: "v1", permissions: ["view_ledger"] }] });
    if (p === "/owners/badges") return json(route, { approvals: 0, refunds: 0 });
    if (p === "/owners/premium/notices") return json(route, []);
    if (p === "/owners/identity" && m === "GET") return json(route, state.identity);
    if (p === "/owners/identity" && m === "POST") {
      const body = req.postDataBuffer() ? req.postDataBuffer().toString("latin1") : "";
      state.identityPosts.push(body);
      if (state.identityFailOnce && state.identityPosts.length === 1) return json(route, { error: { code: "CNIC_INVALID", message: "bad" } }, 422);
      state.identity = { status: "submitted", masked: "*****-*******-1", flags: [] };
      return json(route, state.identity);
    }
    if (/^\/owners\/venues\/[^/]+\/timers$/.test(p)) {
      if (m === "PUT") {
        const values = JSON.parse(req.postData() || "{}");
        state.timerPuts.push(values);
        const eff = {};
        for (const k of Object.keys(DEFAULTS)) eff[k] = values[k] ?? DEFAULTS[k];
        state.timers = { values, defaults: DEFAULTS, effective: eff };
      }
      return json(route, state.timers);
    }
    if (p === "/courts/c1") return json(route, COURT);
    if (p === "/courts/c1/blackouts") return json(route, []);
    if (p === "/courts/c1/advance-explain") {
      return json(route, { mode: "default", value: null, minimum: null, hourly_price: 4000, example_minutes: 60, example_total: 4000, example_advance: 4000, default_rule: { source: "pricing_rule", percentage: 100, value_if_nothing_set: 4000 } });
    }
    if (p === "/owners/today" || p.startsWith("/owners/overview")) return json(route, { error: { code: "NOT_FOUND", message: "n/a" } }, 404);
    // wizard submit
    if (p === "/venues" && m === "POST") return json(route, { venue: { ...VENUE, id: "v9", status: "pending", courts: [] } }, 201);
    if (p === "/venues/v9/courts" && m === "POST") return json(route, { court: { ...COURT, id: "c9", venue_id: "v9" } }, 201);
    if (/^\/courts\/c9\/(schedule|pricing)$/.test(p)) return json(route, []);
    if (p === "/courts/c9" && m === "PATCH") return json(route, { ...COURT, id: "c9", venue_id: "v9" });
    if (p === "/venues/v9") return json(route, { ...VENUE, id: "v9", status: "pending", courts: [{ ...COURT, id: "c9", venue_id: "v9" }] });
    // admin
    if (p === "/admin/owner-identities") {
      const filter = u.searchParams.get("filter") || "all";
      state.adminFilters.push(filter);
      const items = filter === "duplicates" ? ADMIN_ROWS.filter((r) => r.flags.length) : filter === "missing" ? ADMIN_ROWS.filter((r) => r.status === "missing") : filter === "unverified" ? ADMIN_ROWS.filter((r) => r.status === "submitted") : ADMIN_ROWS;
      return json(route, { items, total: items.length, page: 1, page_size: 50 });
    }
    if (p === "/admin/owner-identities/o1") {
      state.adminFullCalls += 1;
      return json(route, { ...ADMIN_ROWS[0], number: CNIC_DIGITS, front_url: "data:image/png;base64," + PNG.toString("base64"), back_url: "data:image/png;base64," + PNG.toString("base64"), verified_at: null });
    }
    if (p === "/admin/owner-identities/o1/verify" && m === "POST") {
      return json(route, { ...ADMIN_ROWS[0], status: "verified", number: CNIC_DIGITS, front_url: "data:image/png;base64," + PNG.toString("base64"), back_url: "data:image/png;base64," + PNG.toString("base64"), verified_at: iso(0) });
    }
    state.unmocked.push(`${m} ${p}`);
    return json(route, { error: { code: "NOT_FOUND", message: "unmocked " + p } }, 404);
  });
  return context;
}

async function openPage(context, url, errors) {
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    if (/Failed to load resource/.test(msg.text())) return;
    errors.push("console: " + msg.text().slice(0, 200));
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

/** Visible buttons / links / text inputs in `scope` are at least 44px tall and have an accessible name. */
async function badTargets(page, scope) {
  return page.evaluate((sel) => {
    const bad = [];
    document.querySelectorAll(sel).forEach((root) =>
      root.querySelectorAll("button, a[href], input:not([type=hidden]), summary").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        const t = el.getAttribute("type");
        if (t === "radio" || t === "checkbox" || t === "file") return; // the wrapping label is the target
        const name = (el.getAttribute("aria-label") || el.textContent || (el.labels && el.labels[0] && el.labels[0].textContent) || el.getAttribute("aria-labelledby") || "").trim();
        if (r.height < 44 - 0.5) bad.push(`${el.tagName}:${name.slice(0, 24)}@${Math.round(r.height)}`);
        if (!name) bad.push(`${el.tagName}: no name`);
      }),
    );
    return bad;
  }, scope);
}

/** The CNIC must never reach web storage. */
async function cnicInStorage(page) {
  return page.evaluate(
    ({ a, b }) => {
      const all = [];
      for (const s of [localStorage, sessionStorage]) for (let i = 0; i < s.length; i++) all.push(s.getItem(s.key(i)) || "");
      return all.some((v) => v.includes(a) || v.includes(b));
    },
    { a: CNIC_DIGITS, b: CNIC_MASK },
  );
}

async function settingsCheck(browser, width, lang, f) {
  const T = TEXT[lang];
  const errors = [];
  const state = freshState();
  const context = await newCtx(browser, { width, lang, state });
  const page = await openPage(context, "/dashboard/owner/settings", errors);
  const tag = `settings ${lang}@${width}`;
  if ((await page.locator("h1").count()) !== 1) f.push(`${tag}: expected one h1`);

  // ---- banner: owner with no CNIC ----
  const banner = page.locator('[data-testid="cnic-banner"]');
  if (!(await banner.count())) f.push(`${tag}: no CNIC banner for a missing CNIC`);
  else if (!(await banner.innerText()).includes(T.banner)) f.push(`${tag}: banner text "${await banner.innerText()}"`);

  // ---- timers card ----
  const card = page.locator('[data-testid="timers-card"]');
  await card.waitFor({ timeout: 8000 }).catch(() => {});
  const hint = (k) => card.locator(`[data-testid="default-hint-${k}"]`);
  if (!(await card.count())) f.push(`${tag}: no timers card`);
  else {
    await card.locator('[data-testid="timer-hold_minutes"]').waitFor({ timeout: 8000 }).catch(() => f.push(`${tag}: timers never loaded`));
    if ((await card.locator('[data-testid="timer-hold_minutes"]').inputValue()) !== "20") f.push(`${tag}: hold not seeded from values (20)`);
    const holdHint = await hint("hold_minutes").innerText();
    if (!holdHint.includes(T.defaultHold)) f.push(`${tag}: hold hint "${holdHint}"`);
    if ((await hint("hold_minutes").getAttribute("data-state")) !== "differs") f.push(`${tag}: hold hint state`);
    if (!(await card.locator('[data-testid="default-reset-hold_minutes"]').count())) f.push(`${tag}: no reset link for a changed hold`);
    // unset fields show the running marker
    for (const k of ["first_reminder_after_min", "repeat_every_min", "max_reminders", "auto_cancel_after_min", "reminders_enabled", "auto_cancel_enabled"]) {
      if (!(await card.locator(`[data-testid="default-running-${k}"]`).count())) f.push(`${tag}: ${k} has no "${T.running}" marker`);
    }
    const prev = (await card.locator('[data-testid="timer-preview-text"]').innerText()).trim();
    if (prev !== T.previewDefault) f.push(`${tag}: default preview "${prev}"`);
    // auto-cancel OFF -> the owner's warning, preview says off
    await card.locator('[data-testid="timer-auto_cancel_enabled"]').uncheck();
    const off = card.locator('[data-testid="timer-autocancel-off"]');
    if (!(await off.count()) || !(await off.innerText()).includes(T.offWarning)) f.push(`${tag}: no auto-cancel OFF warning`);
    if (!(await card.locator('[data-testid="timer-preview-text"]').innerText()).includes(T.previewOff)) f.push(`${tag}: preview not live after auto-cancel off`);
    if (!(await card.locator('[data-testid="default-reset-auto_cancel_enabled"]').count())) f.push(`${tag}: no reset for auto-cancel off`);
    // validation
    await card.locator('[data-testid="timer-hold_minutes"]').fill("2");
    if ((await card.locator('[data-testid="timer-hold_minutes"]').getAttribute("aria-invalid")) !== "true") f.push(`${tag}: hold 2 not flagged`);
    // Default par wapas -> null
    await card.locator('[data-testid="default-reset-hold_minutes"]').click();
    if ((await hint("hold_minutes").getAttribute("data-state")) !== "unset") f.push(`${tag}: hold reset did not unset`);
    if ((await card.locator('[data-testid="timer-hold_minutes"]').inputValue()) !== "15") f.push(`${tag}: hold box after reset shows "${await card.locator('[data-testid="timer-hold_minutes"]').inputValue()}"`);
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/s2-timers-${lang}-${width}.png` });
    await card.getByRole("button", { name: lang === "ru" ? "Ye settings save karein" : "Save these settings" }).click();
    await card.locator('[data-testid="timers-message"]').waitFor({ timeout: 8000 }).catch(() => {});
    const put = state.timerPuts[0];
    if (!put) f.push(`${tag}: no PUT timers`);
    else if (put.hold_minutes !== null || put.auto_cancel_enabled !== false || put.first_reminder_after_min !== null) f.push(`${tag}: PUT body ${JSON.stringify(put)}`);
    const msg = (await card.locator('[data-testid="timers-message"]').innerText().catch(() => "")).trim();
    if (!msg.includes(T.saved)) f.push(`${tag}: save message "${msg}"`);
    const bad = await badTargets(page, '[data-testid="timers-card"]');
    if (bad.length) f.push(`${tag}: timers targets ${bad.join(", ")}`);
  }

  // ---- cancellation hints (cutoff 24 differs from the default "no limit") ----
  if ((await page.locator('[data-testid="default-hint-cancellation_cutoff_hours"]').getAttribute("data-state")) !== "differs") f.push(`${tag}: cutoff hint should differ`);
  if ((await page.locator('[data-testid="default-hint-cancellation_allowed"]').getAttribute("data-state")) !== "same") f.push(`${tag}: allowed hint should be same`);

  // ---- identity card: missing -> type, pick photos, submit ----
  const idc = page.locator('[data-testid="identity-card"]');
  if (!(await idc.count())) f.push(`${tag}: no identity card`);
  else {
    const num = idc.locator('[data-testid="cnic-number"]');
    await num.fill("35202");
    await num.pressSequentially("12345671");
    if ((await num.inputValue()) !== CNIC_MASK) f.push(`${tag}: mask "${await num.inputValue()}"`);
    await idc.locator('[data-testid="cnic-front-input"]').setInputFiles({ name: "front.png", mimeType: "image/png", buffer: PNG });
    await idc.locator('[data-testid="cnic-back-input"]').setInputFiles({ name: "back.png", mimeType: "image/png", buffer: PNG });
    if ((await idc.locator('[data-testid="cnic-front"] img').count()) !== 1 || (await idc.locator('[data-testid="cnic-back"] img').count()) !== 1) f.push(`${tag}: no photo previews`);
    // a wrong file type is refused
    await idc.locator('[data-testid="cnic-front-input"]').setInputFiles({ name: "x.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF") });
    if (!(await idc.locator('[data-testid="cnic-front"] [role="alert"]').count())) f.push(`${tag}: pdf not refused`);
    if (await cnicInStorage(page)) f.push(`${tag}: CNIC found in web storage`);
    await idc.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/s2-cnic-settings-${lang}-${width}.png` });
    await idc.getByRole("button", { name: lang === "ru" ? "CNIC jama karein" : "Submit CNIC" }).click();
    await idc.locator('[data-testid="cnic-message"]').waitFor({ timeout: 8000 }).catch(() => {});
    if (state.identityPosts.length !== 1) f.push(`${tag}: ${state.identityPosts.length} identity POSTs`);
    else if (!state.identityPosts[0].includes(CNIC_MASK) && !state.identityPosts[0].includes(CNIC_DIGITS)) f.push(`${tag}: POST has no number`);
    if (!(await idc.innerText()).includes(T.cnicSaved)) f.push(`${tag}: no saved message`);
    if ((await idc.locator('[data-testid="cnic-status"]').getAttribute("data-status")) !== "submitted") f.push(`${tag}: status not submitted after POST`);
    if ((await idc.locator('[data-testid="cnic-masked"]').innerText()) !== "*****-*******-1") f.push(`${tag}: masked value`);
    if (await page.locator('[data-testid="cnic-banner"]').count()) f.push(`${tag}: banner still shown after submitting`);
    const bad = await badTargets(page, '[data-testid="identity-card"]');
    if (bad.length) f.push(`${tag}: identity targets ${bad.join(", ")}`);
  }
  if ((await overflow(page)) > 1) f.push(`${tag}: venue tab horizontal scroll: ${await overflowInfo(page)}`);
  await page.screenshot({ path: `${SHOTS}/s2-settings-venue-${lang}-${width}.png`, fullPage: true });

  // ---- courts tab: slot length + advance defaults ----
  await page.locator("#settings-tab-courts").click();
  await page.locator('[data-testid="default-hint-slot_minutes"]').waitFor({ timeout: 8000 }).catch(() => {});
  const slot = page.locator('[data-testid="default-hint-slot_minutes"]');
  if (!(await slot.count())) f.push(`${tag}: no slot default hint`);
  else {
    if (!(await slot.innerText()).includes(T.slotSettings)) f.push(`${tag}: slot hint "${await slot.innerText()}" (settings = backend 60)`);
    if ((await slot.getAttribute("data-state")) !== "same") f.push(`${tag}: slot 60 should equal the settings default`);
  }
  const adv = page.locator('[data-testid="default-hint-advance"]');
  if (!(await adv.count())) f.push(`${tag}: no advance default hint`);
  else {
    if (!(await adv.innerText()).includes(T.fullNote)) f.push(`${tag}: advance hint lacks "${T.fullNote}" with split_payments off`);
    if ((await adv.getAttribute("data-state")) !== "unset") f.push(`${tag}: advance hint state`);
  }
  if ((await overflow(page)) > 1) f.push(`${tag}: courts tab horizontal scroll: ${await overflowInfo(page)}`);
  for (const e of errors) f.push(`${tag}: ${e}`);
  if (state.unmocked.length) console.log(`  (${tag} unmocked: ${[...new Set(state.unmocked)].join(", ")})`);
  await context.close();
}

async function bannerCheck(browser, width, lang, f) {
  const errors = [];
  const state = freshState();
  const context = await newCtx(browser, { width, lang, state });
  const page = await openPage(context, "/dashboard/owner/settings", errors);
  const tag = `banner ${lang}@${width}`;
  const banner = page.locator('[data-testid="cnic-banner"]');
  if (!(await banner.count())) f.push(`${tag}: no banner`);
  else {
    const bad = await badTargets(page, '[data-testid="cnic-banner"]');
    if (bad.length) f.push(`${tag}: targets ${bad.join(", ")}`);
    await page.locator('[data-testid="cnic-banner-dismiss"]').click();
    if (await banner.count()) f.push(`${tag}: banner not dismissed`);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    if (await page.locator('[data-testid="cnic-banner"]').count()) f.push(`${tag}: dismissal not kept for the session`);
  }
  // staff never see it
  const staffState = freshState({ user: { ...OWNER, role: "staff" } });
  const staffCtx = await newCtx(browser, { width, lang, state: staffState });
  const sp = await openPage(staffCtx, "/dashboard/owner/settings", []);
  if (await sp.locator('[data-testid="cnic-banner"]').count()) f.push(`${tag}: staff sees the CNIC banner`);
  if (await sp.locator('[data-testid="identity-card"]').count()) f.push(`${tag}: staff sees the identity card`);
  // staff without the settings permission: a read-only summary, no inputs, no error
  await sp.locator('[data-testid="timers-card-readonly"]').waitFor({ timeout: 8000 }).catch(() => f.push(`${tag}: staff has no read-only timers summary`));
  if (await sp.locator('[data-testid="timers-card"]').count()) f.push(`${tag}: staff without permission sees the editable timers card`);
  await staffCtx.close();
  for (const e of errors) f.push(`${tag}: ${e}`);
  await context.close();
}

async function wizardCheck(browser, width, lang, f) {
  const T = TEXT[lang];
  const errors = [];
  const draft = {
    state: { name: "Wizard Arena", address: "Street 9", city: "Karachi", area: "DHA", latitude: 24.8, longitude: 67.0, sports: ["Futsal"], whatsapp: "", bankName: "", accountTitle: "", accountNumber: "", amenities: [] },
    version: 4,
  };
  const state = freshState({ draft, noVenues: true, identityFailOnce: true });
  const context = await newCtx(browser, { width, lang, state });
  const page = await openPage(context, "/venue-setup/courts", errors);
  const tag = `wizard ${lang}@${width}`;
  if ((await page.locator("h1").count()) !== 1) f.push(`${tag}: expected one h1`);
  // slot length default in the wizard = its prefill (90)
  const slot = page.locator('[data-testid="default-hint-slot_minutes"]');
  if ((await slot.getAttribute("data-state").catch(() => null)) !== "same") f.push(`${tag}: wizard slot hint should match the 90 prefill`);
  await page.locator('input[placeholder="2500"]').first().fill("4000");
  const send = page.getByRole("button", { name: lang === "ru" ? /review/i : /review/i }).last();
  if ((await send.getAttribute("aria-disabled")) !== "true") f.push(`${tag}: send enabled without a CNIC`);
  if (!(await page.locator('[data-testid="wizard-cnic-needed"]').count())) f.push(`${tag}: no "CNIC needed" note`);

  // Advanced: same timers fields as Settings
  const advd = page.locator('[data-testid="wizard-advanced"]');
  await advd.locator("summary").click();
  const fields = advd.locator('[data-testid="timers-fields"]');
  if (!(await fields.count())) f.push(`${tag}: no timers fields under Advanced`);
  else {
    if (!(await fields.locator('[data-testid="default-running-hold_minutes"]').count())) f.push(`${tag}: wizard hold not "default running"`);
    await fields.locator('[data-testid="timer-hold_minutes"]').fill("25");
    if (!(await fields.locator('[data-testid="default-reset-hold_minutes"]').count())) f.push(`${tag}: wizard hold has no reset`);
    const prev = (await fields.locator('[data-testid="timer-preview-text"]').innerText()).trim();
    if (prev !== T.previewDefault) f.push(`${tag}: wizard preview "${prev}"`);
  }

  // CNIC step
  const step = page.locator('[data-testid="wizard-cnic"]');
  const num = step.locator('[data-testid="cnic-number"]');
  await num.fill("3520212345");
  await num.blur();
  if (!(await step.innerText()).includes(T.cnicInvalid)) f.push(`${tag}: no invalid CNIC message for 10 digits`);
  await num.fill(CNIC_DIGITS);
  if ((await num.inputValue()) !== CNIC_MASK) f.push(`${tag}: wizard mask "${await num.inputValue()}"`);
  await step.locator('[data-testid="cnic-front-input"]').setInputFiles({ name: "front.png", mimeType: "image/png", buffer: PNG });
  await step.locator('[data-testid="cnic-back-input"]').setInputFiles({ name: "back.png", mimeType: "image/png", buffer: PNG });
  if ((await send.getAttribute("aria-disabled")) !== "false") f.push(`${tag}: send still disabled with a full CNIC`);
  if (await cnicInStorage(page)) f.push(`${tag}: CNIC found in web storage (wizard)`);
  if ((await overflow(page)) > 1) f.push(`${tag}: horizontal scroll: ${await overflowInfo(page)}`);
  const bad = await badTargets(page, '[data-testid="wizard-cnic"], [data-testid="timers-fields"]');
  if (bad.length) f.push(`${tag}: targets ${bad.join(", ")}`);
  await page.screenshot({ path: `${SHOTS}/s2-wizard-${lang}-${width}.png`, fullPage: true });

  // first send: the identity POST fails (CNIC_INVALID) after the venue exists -> clear message, venue not recreated on retry
  await send.click();
  await page.locator('[data-testid="wizard-step-error"]').waitFor({ timeout: 10000 }).catch(() => f.push(`${tag}: no step error after CNIC_INVALID`));
  const errText = await page.locator('[data-testid="wizard-step-error"]').innerText().catch(() => "");
  if (!errText.includes(T.cnicInvalid)) f.push(`${tag}: step error "${errText}"`);
  await send.click();
  await page.waitForURL(/\/venue-setup\/status/, { timeout: 10000 }).catch(() => f.push(`${tag}: no redirect to status after retry`));
  const seq = state.calls.filter((c) => /^(POST \/venues|PUT \/owners\/venues\/v9\/timers|POST \/owners\/identity)$/.test(c));
  const venueCreates = seq.filter((c) => c === "POST /venues").length;
  if (venueCreates !== 1) f.push(`${tag}: venue created ${venueCreates} times`);
  const firstPut = seq.indexOf("PUT /owners/venues/v9/timers");
  const firstId = seq.indexOf("POST /owners/identity");
  if (!(seq[0] === "POST /venues" && firstPut > 0 && firstId > firstPut)) f.push(`${tag}: call order ${JSON.stringify(seq)}`);
  const put = state.timerPuts[0];
  if (!put || put.hold_minutes !== 25 || put.max_reminders !== null) f.push(`${tag}: wizard PUT ${JSON.stringify(put)}`);
  // after success the drafts are cleared (timers) and the CNIC was never stored
  const left = await page.evaluate(() => localStorage.getItem("khelo.venue-setup-timers") || "");
  if (left.includes("25")) f.push(`${tag}: timers draft not cleared`);
  if (await cnicInStorage(page)) f.push(`${tag}: CNIC in storage after submit`);
  for (const e of errors) f.push(`${tag}: ${e}`);
  if (state.unmocked.length) console.log(`  (${tag} unmocked: ${[...new Set(state.unmocked)].join(", ")})`);
  await context.close();
}

async function adminCheck(browser, width, lang, f) {
  const T = TEXT[lang];
  const errors = [];
  const state = freshState({ user: ADMIN });
  const context = await newCtx(browser, { width, lang, state });
  const page = await openPage(context, "/dashboard/admin/identities", errors);
  const tag = `admin ${lang}@${width}`;
  if ((await page.locator("h1").count()) !== 1) f.push(`${tag}: expected one h1`);
  if (!(await page.locator('[data-testid="identities-logged-note"]').innerText()).includes(T.logged)) f.push(`${tag}: no logged note`);
  await page.locator('[data-testid="identities-filter-all"]').click();
  await page.locator('[data-testid="identity-row"]').nth(2).waitFor({ timeout: 8000 }).catch(() => {});
  if ((await page.locator('[data-testid="identity-row"]').count()) !== 3) f.push(`${tag}: rows ${await page.locator('[data-testid="identity-row"]').count()}`);
  if ((await page.locator('[data-testid="identity-duplicate"]').count()) !== 1) f.push(`${tag}: duplicate chip count`);
  if ((await page.content()).includes(CNIC_DIGITS)) f.push(`${tag}: full number in the list`);
  await page.locator('[data-testid="identities-filter-duplicates"]').click();
  await page.waitForTimeout(300);
  if (!state.adminFilters.includes("duplicates")) f.push(`${tag}: duplicates filter not sent`);
  if ((await page.locator('[data-testid="identity-row"]').count()) !== 1) f.push(`${tag}: duplicates filter rows`);
  if (state.adminFullCalls !== 0) f.push(`${tag}: full endpoint called before the click`);
  if ((await overflow(page)) > 1) f.push(`${tag}: horizontal scroll: ${await overflowInfo(page)}`);
  await page.screenshot({ path: `${SHOTS}/s2-admin-list-${lang}-${width}.png`, fullPage: true });

  await page.locator('[data-testid="identity-view-full"]').first().click();
  const full = page.locator('[data-testid="identity-full"]');
  await full.locator('[data-testid="identity-full-number"]').waitFor({ timeout: 8000 }).catch(() => f.push(`${tag}: full view never loaded`));
  if ((await full.locator('[data-testid="identity-full-number"]').innerText().catch(() => "")) !== CNIC_MASK) f.push(`${tag}: full number`);
  if (!(await full.locator('[data-testid="identity-full-logged"]').innerText()).includes(T.logged)) f.push(`${tag}: no logged note in full view`);
  if (state.adminFullCalls !== 1) f.push(`${tag}: full endpoint calls ${state.adminFullCalls}`);
  await page.screenshot({ path: `${SHOTS}/s2-admin-full-${lang}-${width}.png` });
  await full.locator('[data-testid="identity-photo-front"]').click();
  await page.waitForTimeout(300);
  const dialogs = await page.locator('[role="dialog"]').count();
  if (dialogs < 2) f.push(`${tag}: lightbox did not open (${dialogs} dialogs)`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  if (!(await full.isVisible())) f.push(`${tag}: Escape on the lightbox also closed the full view`);
  await full.locator('[data-testid="identity-verify"]').click();
  await full.locator('[data-testid="identity-verify-message"]').waitFor({ timeout: 8000 }).catch(() => {});
  if (!(await full.innerText()).includes(T.verified)) f.push(`${tag}: no verified message`);
  if (state.adminFullCalls !== 1) f.push(`${tag}: full endpoint re-called (${state.adminFullCalls}); each call is logged`);
  const bad = await badTargets(page, '[data-testid="identity-full"]');
  if (bad.length) f.push(`${tag}: targets ${bad.join(", ")}`);
  for (const e of errors) f.push(`${tag}: ${e}`);
  if (state.unmocked.length) console.log(`  (${tag} unmocked: ${[...new Set(state.unmocked)].join(", ")})`);
  await context.close();
}

async function run() {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  const fails = [];
  for (const lang of LANGS) {
    for (const width of WIDTHS) {
      const f = [];
      await settingsCheck(browser, width, lang, f);
      await bannerCheck(browser, width, lang, f);
      await wizardCheck(browser, width, lang, f);
      await adminCheck(browser, width, lang, f);
      console.log(`${lang}@${width}: ${f.length ? "FAIL" : "ok"}`);
      fails.push(...f);
    }
  }
  await browser.close();
  if (fails.length) {
    console.log("\nFAILURES:\n- " + fails.join("\n- "));
    process.exit(1);
  }
  console.log(`\nall stage2 settings/CNIC checks passed (screenshots in ${SHOTS})`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
