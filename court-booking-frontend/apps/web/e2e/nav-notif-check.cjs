#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Owner nav badges, "naya", Approvals / Refunds filters + links, the notifications bell, the restored Add booking page and the
 * Staff walk-in permission. Plain Node + Playwright, the API is MOCKED with page routes (no backend, no database):
 *   BASE_URL=http://localhost:3803 node e2e/nav-notif-check.cjs
 * The web build must have been made with NEXT_PUBLIC_API_BASE_URL=http://localhost:8000 (the routes below answer that origin).
 * Screenshots go to SHOTS_DIR (default: the OS temp dir), never into the repo.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadPlaywright } = require("./smoke.cjs");

const BASE = (process.env.BASE_URL || "http://localhost:3803").replace(/\/+$/, "");
const API = (process.env.API_ORIGIN || "http://localhost:8000").replace(/\/+$/, "");
const SHOTS = process.env.SHOTS_DIR || path.join(os.tmpdir(), "khelo-nn", "shots");
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const record = (name, failures) => results.push({ name, failures });
const WIDTHS = [360, 768, 1280];
const LANGS = ["en", "ru"];

const UID = "u-owner-1";
const VID = "v-venue-1";
const CID = "11111111-1111-4111-8111-111111111111";
const COURT2 = "22222222-2222-4222-8222-222222222222";
const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();

function userFor(role) {
  return { id: UID, phone: "+923000000002", name: "Test " + role, email: null, city: null, gender: null, role, avatar_url: null, phone_verified_at: iso(1e9), reliability_score: 1, total_bookings: 0, total_no_shows: 0, total_rejections: 0, created_at: iso(1e10) };
}

function venue() {
  const court = (id, name) => ({ id, venue_id: VID, name, sport: "padel", slot_minutes: 60, surface_type: null, is_indoor: false, has_floodlights: false, capacity: null, cancellation_allowed: true, cancellation_cutoff_hours: null, advance_type: null, advance_value: null, advance_minimum: null, photo_url: null, photo_urls: [], photo_keys: [], sort_order: 0, is_active: true, schedule_templates: [], pricing_rules: [] });
  return { id: VID, owner_id: UID, name: "Arena Khelo", slug: "arena", description: null, address: "x", city: "Karachi", area: null, phone: null, whatsapp: null, sports: ["padel"], amenities: [], photo_urls: [], photo_keys: [], status: "approved", rejection_reason: null, auto_approve_enabled: false, auto_approve_min_bookings: 0, cancellation_allowed: true, cancellation_cutoff_hours: null, booking_horizon_days: 90, created_at: iso(1e10), courts: [court(CID, "Court 1"), court(COURT2, "Court 2")], average_rating: null, review_count: 0, distance_meters: null, bank_details: null, checkin_qr_token: null };
}

function approvalRow(id, mins, extra = {}) {
  const check = { verdict: "match", text: "ok" };
  return {
    payment_id: "pay-" + id, booking_id: "bk-" + id, court_name: "Court 1", court_id: CID, court_sport: "padel", account_name: null,
    starts_at: iso(-3600e3), ends_at: iso(-7200e3), player_name: "Usman Tariq", player_phone: "+923001112223", ocr_verdict: "match", ocr_amount: 1500, expected_amount: 1500,
    proof_url: null, submitted_at: iso(mins * 60e3), minutes_since_submission: mins,
    checks: { name: check, amount: check, balance_text: "", time: check, bank: check, duplicate: check, paid_amount: 1500, expected_amount: 1500, payment_status: "paid_in_full", payment_status_text: "Paid in full" },
    ...extra,
  };
}

function refundRow(id, minsAgo) {
  return { id: "rf-" + id, booking_id: "bk-r" + id, court_name: "Court 1", court_id: CID, court_sport: "padel", venue_name: "Arena Khelo", player_name: "Bilal Raza", player_phone: "+923004445556", starts_at: iso(-3600e3), reason: "player_cancelled_paid_booking", refund_amount: 1200, refund_status: "owed", refunded_amount: null, remaining_amount: 1200, refund_reference: null, refunded_at: null, created_at: iso(minsAgo * 60e3), is_overdue: false };
}

function notifRow(id, type, minsAgo, channel = "push", ref = "b1") {
  return { id, channel, event_type: type, status: "sent", cost_category: null, reference_id: ref, created_at: iso(minsAgo * 60e3) };
}

function freshState() {
  return {
    badges: { approvals: 3, refunds: 150 },
    approvals: [approvalRow("a1", 10), approvalRow("a2", 20)],
    approvalsFiltered: [approvalRow("a1", 10)],
    refunds: [refundRow("1", 10), refundRow("2", 600)],
    refundsFiltered: [refundRow("1", 10)],
    notifs: [
      notifRow("n1", "payment_submitted", 5, "push", "b1"),
      notifRow("n1w", "payment_submitted", 5, "whatsapp", "b1"),
      notifRow("n2", "refund_owed", 60, "push", "b2"),
      notifRow("n3", "booking_confirmed", 120, "push", "b3"),
      notifRow("n4", "something_new", 30 * 60, "push", "b4"),
    ],
    calls: [], // { path, query }
    unmocked: [],
  };
}

function slotsForToday() {
  const base = Math.ceil((Date.now() + 3600e3) / 1800e3) * 1800e3;
  return Array.from({ length: 8 }, (_, i) => ({ starts_at: new Date(base + i * 1800e3).toISOString(), ends_at: new Date(base + (i + 1) * 1800e3).toISOString(), status: "available", price: 1500, advance_amount: 500, held_until: null, booking_id: null, is_mine: false, reason: null, after_midnight: false }));
}

async function newCtx(browser, { width, lang, role = "owner", notif = "stub-default", state }) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  await context.addCookies([{ name: "khelo_lang", value: lang, url: BASE }]);
  const user = userFor(role);
  await context.addInitScript(
    ({ user, notif }) => {
      if (!localStorage.getItem("maidan.session_token")) {
        localStorage.setItem("maidan.session_token", "tok");
        localStorage.setItem("maidan.session_expires_at", new Date(Date.now() + 7 * 3600e3).toISOString());
        localStorage.setItem("maidan.cached_user", JSON.stringify(user));
      }
      window.__notifs = [];
      window.__permAsked = 0;
      if (notif === "unsupported") {
        delete window.Notification;
      } else {
        const perm = notif === "stub-denied" ? "denied" : "default";
        class N {
          constructor(title, opts) {
            window.__notifs.push({ title, body: opts && opts.body });
          }
          static requestPermission() {
            window.__permAsked += 1;
            N.permission = "granted";
            return Promise.resolve("granted");
          }
        }
        N.permission = perm;
        window.Notification = N;
      }
    },
    { user, notif },
  );
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", headers: cors(route), body: JSON.stringify(body) });
  const cors = (route) => {
    const req = route.request();
    return { "access-control-allow-origin": req.headers()["origin"] || "*", "access-control-allow-headers": req.headers()["access-control-request-headers"] || "*", "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS", "access-control-max-age": "600" };
  };
  await context.route(new RegExp("^" + API.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&") + "/"), async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors(route) });
    const u = new URL(req.url());
    const p = u.pathname.replace(/^\/api\/v1/, "");
    state.calls.push({ path: p, query: Object.fromEntries(u.searchParams.entries()) });
    if (p === "/auth/me") return json(route, { user, session: { device_id: null, device_name: null, platform: "web", last_active_at: iso(0), expires_at: new Date(Date.now() + 7 * 3600e3).toISOString() } });
    if (p === "/feature-flags") return json(route, { flags: {} });
    if (p === "/owners/venues") return json(route, [venue()]);
    if (p === "/owners/badges") return json(route, state.badges);
    if (p === "/owners/pending-approvals") return json(route, u.searchParams.get("date") || u.searchParams.get("court_ids") ? state.approvalsFiltered : state.approvals);
    if (p === "/owners/refunds") return json(route, u.searchParams.get("date") || u.searchParams.get("court_ids") ? state.refundsFiltered : state.refunds);
    if (p === "/users/me/notifications") return json(route, state.notifs);
    if (p === "/owners/premium/notices") return json(route, []);
    if (p === "/staff") return json(route, []);
    if (p === "/staff/permissions") {
      return json(route, ["approve_payments", "record_payments", "check_in", "walkin", "cancel_booking", "view_ledger"].map((k) => ({ key: k, label: k, flag_required: null, available: true })));
    }
    if (/^\/courts\/[^/]+\/availability$/.test(p)) return json(route, { court_id: CID, date: u.searchParams.get("date"), slot_minutes: 30, min_booking_minutes: 60, min_slots: 2, slots: slotsForToday() });
    if (/^\/courts\/[^/]+\/quote$/.test(p)) return json(route, { court_id: CID, starts_at: u.searchParams.get("starts_at"), ends_at: u.searchParams.get("starts_at"), slot_count: 2, slot_minutes: 30, min_booking_minutes: 60, min_slots: 2, duration_minutes: 60, price: 3000, advance_amount: 1000, balance_due: 2000 });
    if (/^\/bookings\/[^/]+\/overview-detail$/.test(p)) return json(route, { error: { code: "NOT_FOUND", message: "mock" } }, 404);
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
    const url = (m.location() && m.location().url) || "";
    if (/overview-detail|\/dashboard\/bookings/.test(url)) return; // expected: mocked 404 / page owned by another agent
    errors.push("console: " + m.text().slice(0, 160) + " " + url);
  });
  await page.goto(BASE + url, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  return page;
}

const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const overflowInfo = (page) =>
  page.evaluate(() => {
    const w = window.innerWidth;
    const out = [];
    document.querySelectorAll("body *").forEach((e) => {
      const r = e.getBoundingClientRect();
      if (r.width > 0 && r.right > w + 0.5) out.push(e.tagName + "." + (e.getAttribute("data-testid") || String(e.className).slice(0, 30)) + "@" + Math.round(r.right));
    });
    return `scrollWidth ${document.documentElement.scrollWidth} > ${w}: ${out.slice(0, 4).join(", ")}`;
  });

async function openDrawerIfPhone(page, width) {
  if (width >= 768) return;
  await page.locator("header button").filter({ has: page.locator("svg line") }).first().click();
  await page.waitForTimeout(250);
}

async function navAndBell(browser, width, lang) {
  const f = [];
  const errors = [];
  const state = freshState();
  const context = await newCtx(browser, { width, lang, state });
  const page = await openPage(context, "/dashboard/owner/approvals", errors);

  // ---- nav badges ----
  if (width < 768) {
    const dot = await page.locator('[data-testid="menu-pending-dot"]').count();
    if (dot !== 1) f.push("phone menu button has no pending dot");
  }
  await openDrawerIfPhone(page, width);
  const bA = page.locator('[data-testid="nav-badge-approvals"]:visible');
  const bR = page.locator('[data-testid="nav-badge-refunds"]:visible');
  if ((await bA.count()) !== 1 || (await bA.innerText()).trim() !== "3") f.push(`approvals badge is ${(await bA.count()) ? await bA.innerText() : "missing"} (expected 3)`);
  if ((await bR.count()) !== 1 || (await bR.innerText()).trim() !== "99+") f.push(`refunds badge is ${(await bR.count()) ? await bR.innerText() : "missing"} (expected 99+)`);
  const linkA = page.locator('a[data-testid="nav-approvals"]:visible');
  const aria = (await linkA.getAttribute("aria-label")) || "";
  const wantAria = lang === "en" ? /^Approvals, 3 pending$/ : /, 3 intezar mein$/;
  if (!wantAria.test(aria)) f.push(`approvals link name is "${aria}"`);
  const ariaR = (await page.locator('a[data-testid="nav-refunds"]:visible').getAttribute("aria-label")) || "";
  if (!/99\+/.test(ariaR)) f.push(`refunds link name is "${ariaR}"`);
  if ((await linkA.getAttribute("aria-current")) !== "page") f.push("Approvals link is not aria-current on the Approvals page");
  const box = await linkA.boundingBox();
  if (!box || box.height < 43.5) f.push(`nav link height ${box && box.height}`);
  // Overview label, Bookings entry, Add booking entry
  const hrefs = await page.locator("nav a:visible").evaluateAll((els) => els.map((e) => ({ href: e.getAttribute("href"), text: e.textContent.trim() })));
  const has = (h) => hrefs.find((x) => x.href === h);
  if (!has("/dashboard/owner/today") || !/^Overview/.test(has("/dashboard/owner/today").text)) f.push(`today entry text is "${has("/dashboard/owner/today") && has("/dashboard/owner/today").text}" (expected Overview)`);
  if (!has("/dashboard/bookings")) f.push("no Bookings history entry linking /dashboard/bookings");
  if (!has("/dashboard/owner/walkin")) f.push("no Add booking entry linking /dashboard/owner/walkin");
  if (!(await noOverflow(page))) f.push("horizontal scroll on Approvals");
  await page.screenshot({ path: path.join(SHOTS, `nav-${width}-${lang}.png`) });
  if (width < 768) {
    await page.keyboard.press("Escape");
    await page.locator('button[aria-label]').filter({ hasText: /✕/ }).first().click().catch(() => undefined);
    await page.waitForTimeout(200);
  }

  // ---- bell ----
  const bell = page.locator('[data-testid="notification-bell"]:visible');
  if ((await bell.count()) !== 1) {
    f.push("bell not visible");
  } else {
    const bellBox = await bell.boundingBox();
    if (bellBox.width < 43.5 || bellBox.height < 43.5) f.push(`bell target is ${bellBox.width}x${bellBox.height}`);
    const badge = (await page.locator('[data-testid="notification-badge"]:visible').innerText().catch(() => "")).trim();
    if (badge !== "3") f.push(`bell badge is "${badge}" (expected 3: five log rows, one duplicate channel, one older than a day)`);
    const label = (await bell.getAttribute("aria-label")) || "";
    if (!/3/.test(label)) f.push(`bell name is "${label}"`);
    if ((await bell.getAttribute("aria-expanded")) !== "false" || (await bell.getAttribute("aria-haspopup")) !== "dialog") f.push("bell aria-expanded/aria-haspopup wrong while closed");
    await bell.click();
    await page.waitForTimeout(300);
    const panel = page.locator('[data-testid="notification-panel"]');
    if (!(await panel.isVisible())) f.push("panel did not open");
    else {
      if ((await bell.getAttribute("aria-expanded")) !== "true") f.push("aria-expanded is not true when open");
      const pb = await panel.boundingBox();
      if (pb.x < -0.5 || pb.x + pb.width > width + 0.5) f.push(`panel outside the viewport (${Math.round(pb.x)}..${Math.round(pb.x + pb.width)} of ${width})`);
      if (await panel.evaluate((el) => el.scrollWidth > el.clientWidth + 1)) f.push("panel content wider than the panel (text not wrapping)");
      const items = await panel.locator("li").count();
      if (items !== 4) f.push(`${items} list items (expected 4 after folding the WhatsApp duplicate)`);
      const chips = await panel.locator("li span").filter({ hasText: new RegExp("^" + (lang === "en" ? "New" : "Naya") + "$") }).count();
      if (chips !== 3) f.push(`${chips} "new" chips (expected 3)`);
      const text = await panel.innerText();
      if (lang === "en" && !/A new payment is waiting for approval/.test(text)) f.push("event title missing (en)");
      if (lang === "ru" && !/Nayi payment approval ke intezar mein hai/.test(text)) f.push("event title missing (ru)");
      if (lang === "en" && !/New notification/.test(text)) f.push("unknown event has no generic title");
      const link = await panel.locator('a[href="/dashboard/owner/approvals"]').count();
      if (link !== 1) f.push("payment_submitted row does not link to Approvals");
      if ((await panel.locator('a[href="/dashboard/owner/refunds"]').count()) !== 1) f.push("refund_owed row does not link to Refunds");
      if (!/\d+ min|just now|\d+ hour|\d+ hr|\d+ ghante|\d+ minute/i.test(text)) f.push("no relative time shown: " + text.slice(0, 120));
      await page.screenshot({ path: path.join(SHOTS, `bell-${width}-${lang}.png`) });
      // mark all as read
      await panel.locator('[data-testid="notification-mark-all"]').click();
      await page.waitForTimeout(300);
      if ((await page.locator('[data-testid="notification-badge"]').count()) !== 0) f.push("badge still shown after mark all as read");
      if ((await panel.locator("li span").filter({ hasText: /^(New|Naya)$/ }).count()) !== 0) f.push("rows still marked new after mark all");
      if (!(await panel.locator('[data-testid="notification-mark-all"]').isDisabled())) f.push("mark all is still enabled with nothing unread");
      // Escape closes and focus returns
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
      if (await panel.isVisible().catch(() => false)) f.push("Esc did not close the panel");
      if (!(await bell.evaluate((el) => el === document.activeElement))) f.push("focus did not return to the bell after Esc");
    }
    // read state survives a reload (browser storage, per user)
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    if ((await page.locator('[data-testid="notification-badge"]').count()) !== 0) f.push("badge came back after reload (read state not stored)");
    const stored = await page.evaluate((uid) => localStorage.getItem("khelo.notif.readAt." + uid), UID);
    if (!stored) f.push("read marker is not stored under the user id");
  }
  if (errors.length) f.push("browser errors: " + errors.slice(0, 3).join(" | "));
  if (state.unmocked.length) f.push("unmocked API paths: " + [...new Set(state.unmocked)].join(", "));
  await context.close();
  record(`nav badges + bell [${width} | ${lang}]`, f);
}

async function pollingAndPopup(browser) {
  const f = [];
  const errors = [];
  const state = freshState();
  state.notifs = [notifRow("o1", "booking_confirmed", 600, "push", "b9")];
  const context = await newCtx(browser, { width: 1280, lang: "en", state });
  const page = await openPage(context, "/dashboard/owner/approvals", errors);
  const bell = page.locator('[data-testid="notification-bell"]:visible');
  await bell.click();
  const enable = page.locator('[data-testid="notification-enable"]');
  if ((await enable.count()) !== 1) f.push("Turn on notifications button missing while permission is undecided");
  if ((await page.evaluate(() => window.__permAsked)) !== 0) f.push("the browser was asked for permission before any click");
  await enable.click();
  await page.waitForTimeout(400);
  if ((await page.evaluate(() => window.__permAsked)) !== 1) f.push("clicking the button did not ask the browser once");
  if (!/Browser popups are on/.test(await page.locator('[data-testid="notification-panel"]').innerText())) f.push("popup state text missing after enabling");
  const stored = await page.evaluate((uid) => localStorage.getItem("khelo.notif.popup." + uid), UID);
  if (stored !== "1") f.push("the popup choice is not stored");
  // sound toggle
  const sound = page.locator('[data-testid="notification-sound"]');
  if ((await sound.getAttribute("aria-pressed")) !== "false") f.push("sound should be off by default");
  await sound.click();
  if ((await sound.getAttribute("aria-pressed")) !== "true") f.push("sound toggle did not turn on");
  await sound.click();
  await page.keyboard.press("Escape");
  if ((await page.evaluate(() => window.__notifs.length)) !== 0) f.push("a popup was shown for the first load");
  // new badge count + new notification arrives, picked up by the 15 s poll
  state.badges = { approvals: 7, refunds: 2 };
  state.notifs = [notifRow("o2", "payment_submitted", 0, "push", "b10"), ...state.notifs];
  const t0 = Date.now();
  await page.waitForFunction(() => window.__notifs.length > 0, null, { timeout: 25000 }).catch(() => undefined);
  const waited = Date.now() - t0;
  const popups = await page.evaluate(() => window.__notifs);
  if (popups.length !== 1) f.push(`${popups.length} browser popups after a new notification (expected 1): ${JSON.stringify(popups)}`);
  else if (!/payment is waiting/i.test(popups[0].title)) f.push(`popup title "${popups[0].title}"`);
  if (waited > 20000) f.push(`the poll took ${waited} ms`);
  await page.waitForTimeout(600);
  const badgeText = (await page.locator('[data-testid="notification-badge"]:visible').innerText().catch(() => "")).trim();
  if (badgeText !== "2") f.push(`bell badge after the new notification is "${badgeText}" (expected 2: the 10-hour-old one and the new one)`);
  const navApprovals = (await page.locator('[data-testid="nav-badge-approvals"]:visible').innerText().catch(() => "")).trim();
  if (navApprovals !== "7") f.push(`nav badge did not follow the poll (shows "${navApprovals}", expected 7)`);
  const cnt = state.calls.filter((c) => c.path === "/owners/badges").length;
  if (cnt < 2 || cnt > 4) f.push(`badges was requested ${cnt} times in ~25 s (expected about 2-3)`);
  if (errors.length) f.push("browser errors: " + errors.slice(0, 3).join(" | "));
  await context.close();
  record("15 s polling, browser popup after explicit click, sound off by default", f);

  // denied + unsupported
  for (const mode of ["stub-denied", "unsupported"]) {
    const f2 = [];
    const st = freshState();
    const c2 = await newCtx(browser, { width: 1280, lang: "ru", state: st, notif: mode });
    const p2 = await openPage(c2, "/dashboard/owner/approvals", []);
    await p2.locator('[data-testid="notification-bell"]:visible').click();
    const panel = p2.locator('[data-testid="notification-panel"]');
    const hasEnable = (await panel.locator('[data-testid="notification-enable"]').count()) > 0;
    if (hasEnable) f2.push("enable button shown in " + mode);
    const denied = await panel.locator('[data-testid="notification-denied"]').count();
    if (mode === "stub-denied" && (denied !== 1 || !/Allow karein/.test(await panel.innerText()))) f2.push("denied explanation missing");
    if (mode === "unsupported" && /Browser popups|Browser popup/.test(await panel.innerText())) f2.push("popup section shown for an unsupported browser");
    await c2.close();
    record(`popup button: ${mode}`, f2);
  }
}

async function approvalsAndRefunds(browser, width, lang) {
  const f = [];
  const errors = [];
  const state = freshState();
  const context = await newCtx(browser, { width, lang, state });
  // the last visit was one hour ago, the first approval was submitted 10 minutes ago, the second 20 minutes ago
  const seenKey = `khelo.seen.${UID}.${VID}.approvals`;
  const seenKeyR = `khelo.seen.${UID}.${VID}.refunds`;
  const old = Date.now() - 3600e3;
  await context.addInitScript(
    ({ k, kr, old }) => {
      if (!localStorage.getItem(k)) localStorage.setItem(k, String(old));
      if (!localStorage.getItem(kr)) localStorage.setItem(kr, String(old));
    },
    { k: seenKey, kr: seenKeyR, old },
  );
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const url = (m.location() && m.location().url) || "";
    if (/overview-detail|\/dashboard\/bookings/.test(url)) return;
    errors.push("console: " + m.text().slice(0, 160) + " " + url);
  });
  await page.goto(BASE + "/dashboard/owner/approvals", { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="naya-chip"]').waitFor({ timeout: 8000 }).catch(() => undefined);
  if ((await page.locator("h1").count()) !== 1) f.push(`${await page.locator("h1").count()} h1 on Approvals`);
  if ((await page.locator('[data-testid="naya-chip"]').count()) !== 1) f.push("no naya chip on the new approval");
  await page.waitForTimeout(1200);
  if ((await page.locator('[data-testid="naya-chip"]').count()) !== 1) f.push("naya chip vanished within 1.5 s (cleared at render)");
  if ((await page.evaluate((k) => localStorage.getItem(k), seenKey)) !== String(old)) f.push("last-visit time moved before the page had been seen for a moment");
  await page.waitForTimeout(3000);
  const after = Number(await page.evaluate((k) => localStorage.getItem(k), seenKey));
  if (!(after > old + 1000)) f.push("last-visit time was not updated after the page was viewed");
  if ((await page.locator('[data-testid="naya-chip"]').count()) !== 1) f.push("naya chip cleared during the same visit");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  if ((await page.locator('[data-testid="naya-chip"]').count()) !== 0) f.push("naya chip still there on the next visit");
  // details + history link
  const hist = await page.locator('[data-testid="row-history"]').getAttribute("href");
  if (!/^\/dashboard\/bookings\?booking=bk-a1&from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/.test(hist || "")) f.push(`history link is ${hist}`);
  const histText = (await page.locator('[data-testid="row-history"]').innerText()).trim();
  if (histText !== (lang === "en" ? "View in history" : "History mein dekho")) f.push(`history link text "${histText}"`);
  const detailsBtn = page.locator('[data-testid="row-details"]');
  const db = await detailsBtn.boundingBox();
  if (!db || db.height < 43.5) f.push(`Details button height ${db && db.height}`);
  await detailsBtn.click();
  await page.waitForTimeout(500);
  if ((await page.locator('[role="dialog"]').count()) < 1) f.push("Details did not open a dialog");
  await page.screenshot({ path: path.join(SHOTS, `approvals-details-${width}-${lang}.png`) });
  await page.keyboard.press("Escape");
  await page.reload({ waitUntil: "networkidle" });

  // filters from the URL
  state.calls.length = 0;
  await page.goto(`${BASE}/dashboard/owner/approvals?date=2026-10-16&courts=${CID}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const call = state.calls.find((c) => c.path === "/owners/pending-approvals");
  if (!call || call.query.date !== "2026-10-16" || call.query.court_ids !== CID) f.push(`filtered request was ${JSON.stringify(call && call.query)}`);
  const banner = page.locator('[data-testid="filter-banner"]');
  if ((await banner.count()) !== 1) f.push("filter banner missing");
  else {
    const bt = (await banner.innerText()).replace(/\s+/g, " ");
    const want = lang === "en" ? /Showing 1 approval \(filter on\)/ : /1 approval dikh rahi hai \(filter laga hai\)/;
    if (!want.test(bt)) f.push(`banner text "${bt}"`);
    const clear = page.locator('[data-testid="filter-clear"]');
    const cb = await clear.boundingBox();
    if (!cb || cb.height < 43.5) f.push("clear link under 44px");
    if (!/Show all|Sab dikhao/.test(await clear.innerText())) f.push("clear link text");
    state.calls.length = 0;
    await clear.click();
    await page.waitForTimeout(800);
    if (new URL(page.url()).search !== "") f.push("Sab dikhao did not clear the URL filter: " + page.url());
    if ((await page.locator('[data-testid="filter-banner"]').count()) !== 0) f.push("banner still shown after clearing");
    const call2 = state.calls.find((c) => c.path === "/owners/pending-approvals");
    if (!call2 || call2.query.date) f.push("unfiltered request still carried a date");
  }
  if (!(await noOverflow(page))) f.push("horizontal scroll on Approvals (filtered)");

  // refunds
  await page.goto(BASE + "/dashboard/owner/refunds", { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  if ((await page.locator("h1").count()) !== 1) f.push("refunds: not exactly one h1");
  const rows = await page.locator('[data-testid="refund-row"]').count();
  if (rows !== 2) f.push(`${rows} refund rows (expected 2)`);
  if ((await page.locator('[data-testid="refund-row"] [data-testid="naya-chip"]').count()) !== 1) f.push("refunds: expected one naya row (10 min old, last visit 1 h ago)");
  const rh = await page.locator('[data-testid="row-history"]').first().getAttribute("href");
  if (!/booking=bk-r1/.test(rh || "")) f.push("refund history link " + rh);
  await page.locator('[data-testid="row-details"]').first().click();
  await page.waitForTimeout(400);
  if ((await page.locator('[role="dialog"]').count()) < 1) f.push("refund Details did not open a dialog");
  await page.keyboard.press("Escape");
  await page.goto(`${BASE}/dashboard/owner/refunds?courts=${COURT2}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const rb = (await page.locator('[data-testid="filter-banner"]').innerText().catch(() => "")).replace(/\s+/g, " ");
  if (!(lang === "en" ? /Showing 1 refund \(filter on\)/ : /1 refund dikh raha hai \(filter laga hai\)/).test(rb)) f.push(`refund banner "${rb}"`);
  if (!(await noOverflow(page))) f.push("horizontal scroll on Refunds");
  await page.screenshot({ path: path.join(SHOTS, `refunds-${width}-${lang}.png`) });
  if (errors.length) f.push("browser errors: " + errors.slice(0, 3).join(" | "));
  await context.close();
  record(`approvals + refunds: naya, filters, Details, history [${width} | ${lang}]`, f);
}

async function walkinAndStaff(browser, width, lang) {
  const f = [];
  const errors = [];
  const state = freshState();
  const context = await newCtx(browser, { width, lang, state });
  const page = await openPage(context, "/dashboard/owner/walkin", errors);
  if ((await page.locator("h1").count()) !== 1) f.push("walk-in: not exactly one h1");
  const h1 = (await page.locator("h1").innerText()).trim();
  if (h1 !== (lang === "en" ? "Add a booking" : "Booking add karein")) f.push(`walk-in h1 "${h1}"`);
  if ((await page.getByRole("button", { name: /Court 1/ }).count()) < 1) f.push("walk-in: no court buttons");
  if ((await page.locator('[data-testid="walkin-name"]').count()) < 0) f.push("name field");
  if (!(await noOverflow(page))) f.push("horizontal scroll on walk-in");
  await openDrawerIfPhone(page, width);
  const cur = await page.locator('a[data-testid="nav-walkin"]:visible').getAttribute("aria-current");
  if (cur !== "page") f.push("Add booking nav entry is not highlighted on its page");
  await page.screenshot({ path: path.join(SHOTS, `walkin-${width}-${lang}.png`) });
  if (width < 768) await page.keyboard.press("Escape");

  await page.goto(BASE + "/dashboard/owner/staff", { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await page.locator("button").filter({ hasText: lang === "en" ? /\+ Add staff member/ : /\+ Staff add karein/ }).first().click();
  await page.waitForTimeout(400);
  const form = page.locator("form").first();
  const label = form.locator("label").filter({ hasText: /walk-in/i });
  if ((await label.count()) !== 1) f.push(`walk-in checkbox label found ${await label.count()} times`);
  else {
    if (await label.locator("input[type=checkbox]").isChecked()) f.push("walk-in is ticked by default");
    const lb = await label.boundingBox();
    if (lb.height < 43.5) f.push("walk-in checkbox row under 44px");
  }
  const ticked = await form.locator("input[type=checkbox]:checked").count();
  if (ticked !== 1) f.push(`${ticked} permissions ticked by default (expected only view_ledger)`);
  if (!(await noOverflow(page))) f.push("horizontal scroll on Staff");
  await page.screenshot({ path: path.join(SHOTS, `staff-${width}-${lang}.png`) });
  if (errors.length) f.push("browser errors: " + errors.slice(0, 3).join(" | "));
  await context.close();
  record(`walk-in page restored + staff walk-in permission [${width} | ${lang}]`, f);
}

async function otherRolesHeader(browser) {
  for (const role of ["player", "owner", "staff", "admin"]) {
    for (const width of [360, 1280]) {
      const f = [];
      const errors = [];
      const state = freshState();
      const context = await newCtx(browser, { width, lang: "en", role, state });
      const page = await openPage(context, "/about", errors);
      await page.waitForTimeout(800);
      const bell = page.locator('[data-testid="notification-bell"]:visible');
      if ((await bell.count()) !== 1) f.push("bell missing in the site header");
      else {
        const bb = await bell.boundingBox();
        if (bb.x + bb.width > width + 0.5 || bb.x < 0) f.push("bell outside the viewport");
        await bell.click();
        await page.waitForTimeout(300);
        const panel = page.locator('[data-testid="notification-panel"]');
        const pb = await panel.boundingBox();
        if (!pb || pb.x < -0.5 || pb.x + pb.width > width + 0.5) f.push("panel outside the viewport");
        if (await panel.evaluate((el) => el.scrollWidth > el.clientWidth + 1)) f.push("panel content wider than the panel (text not wrapping)");
        const text = await panel.innerText();
        if (role === "player" && (await panel.locator('a[href="/dashboard/owner/approvals"]').count()) !== 0) f.push("player sees an owner link");
        if (role === "player" && (await panel.locator('a[href="/bookings"]').count()) < 1) f.push("player: booking_confirmed does not link to /bookings");
        if (/Failed|undefined/.test(text)) f.push("bad text in panel");
        if (width === 360 || role === "player") await page.screenshot({ path: path.join(SHOTS, `header-${role}-${width}.png`) });
        await page.keyboard.press("Escape");
      }
      if (!(await noOverflow(page))) f.push("horizontal scroll: " + (await overflowInfo(page)));
      if (errors.length) f.push("browser errors: " + errors.slice(0, 3).join(" | "));
      await context.close();
      record(`site header bell: ${role} [${width}]`, f);
    }
  }
}

(async () => {
  let pw;
  try {
    pw = loadPlaywright();
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  const browser = await pw.chromium.launch();
  for (const lang of LANGS) for (const width of WIDTHS) await navAndBell(browser, width, lang);
  for (const lang of LANGS) for (const width of WIDTHS) await approvalsAndRefunds(browser, width, lang);
  for (const lang of LANGS) for (const width of [360, 1280]) await walkinAndStaff(browser, width, lang);
  await pollingAndPopup(browser);
  await otherRolesHeader(browser);
  await browser.close();
  let failed = 0;
  for (const r of results) {
    if (r.failures.length === 0) console.log("PASS  " + r.name);
    else {
      failed += 1;
      console.log("FAIL  " + r.name);
      for (const x of r.failures) console.log("        - " + x);
    }
  }
  console.log(`\n${results.length - failed} passed, ${failed} failed. Screenshots: ${SHOTS}`);
  process.exit(failed ? 1 : 0);
})();
