#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Round 2 Stage 2 (W-B) check, plain Node + Playwright, every API call mocked (no backend needed):
 *  - Web Push in the bell: every state (unsupported, iPhone hint, backend off, not asked, denied, subscribed, granted but not
 *    subscribed) with stubbed Notification / serviceWorker / PushManager, nothing asked or registered on page load, enable =
 *    prompt + /sw.js + subscribe + POST, disable = unsubscribe + DELETE, re-POST on load, the tab popup suppressed while subscribed;
 *  - /sw.js served with Cache-Control no-cache + Service-Worker-Allowed, the web manifest and its icons;
 *  - B.a duplicate screenshot: chip, the separate confirm before confirm_duplicate is sent, and the same confirm after a 409;
 *  - B.b staff permissions: buttons hidden up front on Approvals, Refunds, Overview, History and the booking popup;
 *  - B.c "PKR 31,500" / "PKR 1,231,500" on one line in the Collected / Due cards;
 *  - C.3 / C.4: "Status baqi" chip + line (-> History status_pending, any date), the History filter, the No-show confirm.
 * en + ru at 360 / 768 / 1280: one h1, no horizontal scroll, no console errors.
 * Run against a PRODUCTION build made with NEXT_PUBLIC_API_BASE_URL=http://localhost:8099:
 *   BASE_URL=http://localhost:3842 node e2e/stage2-push-noshow-check.cjs
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadPlaywright } = require("./smoke.cjs");
const { API, USER, pktToday, addDays, newState, overviewOf, mockApi } = require("./overview-check.cjs");

const BASE = (process.env.BASE_URL || "http://localhost:3842").replace(/\/+$/, "");
const SHOT_DIR = process.env.SHOT_DIR || path.join(os.tmpdir(), "stage2-wb", "shots");
const WIDTHS = (process.env.WIDTHS || "360,768,1280").split(",").map(Number);
const LANGS = (process.env.LANGS || "en,ru").split(",");
fs.mkdirSync(SHOT_DIR, { recursive: true });

const failures = [];
let checks = 0;
function ok(cond, msg) {
  checks += 1;
  if (!cond) failures.push(msg);
}

const KEY = "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";
const STAFF = { ...USER, id: "s1", name: "Staff One", role: "staff" };
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";

const T = {
  en: { pending: "Status pending", line: "5 bookings need a status", noShow: "Didn't come (No-show)", dupQ: "already used on 2 bookings. Approve anyway?", dupQ3: "already used on 3 bookings", pushOn: "On for this device", enable: "Turn on notifications", noShowSt: "No-show" },
  ru: { pending: "Status baqi", line: "5 bookings ka status baqi", noShow: "Nahi aaye (No-show)", dupQ: "pehle bhi 2 bookings par use hua hai. Phir bhi approve karein?", dupQ3: "pehle bhi 3 bookings par use hua hai", pushOn: "Is device par on hai", enable: "Notifications on karein", noShowSt: "Nahi aaye" },
};

/** Browser stand-ins for Notification / serviceWorker / PushManager (init script; cfg decides what exists). */
function pushStub(cfg) {
  const log = { requested: 0, registered: [], subscribed: 0, unsubscribed: 0, shown: 0, subOpts: null };
  window.__push = log;
  if (cfg.noNotification) {
    try {
      delete window.Notification;
    } catch {
      /* ignore */
    }
    Object.defineProperty(window, "Notification", { value: undefined, configurable: true, writable: true });
  } else {
    const N = function FakeNotification() {
      log.shown += 1;
    };
    let perm = cfg.perm || "default";
    Object.defineProperty(N, "permission", { get: () => perm });
    N.requestPermission = async () => {
      log.requested += 1;
      perm = cfg.answer || "granted";
      return perm;
    };
    Object.defineProperty(window, "Notification", { value: N, configurable: true, writable: true });
  }
  if (cfg.noPush) {
    try {
      delete window.PushManager;
    } catch {
      /* ignore */
    }
  } else if (!("PushManager" in window)) {
    window.PushManager = function PushManager() {};
  }
  if (cfg.noSW) {
    try {
      delete Navigator.prototype.serviceWorker;
    } catch {
      /* ignore */
    }
    return;
  }
  const makeSub = (endpoint) => ({
    endpoint,
    options: { applicationServerKey: null, userVisibleOnly: true },
    toJSON: () => ({ endpoint, keys: { p256dh: "BPk3y", auth: "QXV0aA" } }),
    getKey: () => null,
    unsubscribe: async () => {
      log.unsubscribed += 1;
      current = null;
      return true;
    },
  });
  let current = cfg.existing ? makeSub("https://fcm.googleapis.com/fcm/send/existing") : null;
  const pushManager = {
    getSubscription: async () => current,
    subscribe: async (o) => {
      log.subscribed += 1;
      const k = o.applicationServerKey;
      log.subOpts = { userVisibleOnly: o.userVisibleOnly, keyLen: k ? k.byteLength || k.length : 0, first: k ? new Uint8Array(k.buffer || k)[0] : -1 };
      current = makeSub(`https://fcm.googleapis.com/fcm/send/new-${log.subscribed}`);
      return current;
    },
  };
  let reg = cfg.existing ? { pushManager, scope: "/" } : undefined;
  const container = {
    getRegistration: async () => reg,
    register: async (url, opts) => {
      log.registered.push(`${url}|${opts && opts.scope}`);
      reg = { pushManager, scope: "/" };
      return reg;
    },
    ready: Promise.resolve({ pushManager }),
    addEventListener() {},
    removeEventListener() {},
  };
  Object.defineProperty(Navigator.prototype, "serviceWorker", { get: () => container, configurable: true });
}

function staffPerms(perms) {
  return { role: "staff", venue_permissions: [{ venue_id: "v1", permissions: perms }] };
}

function dupItem(id, name, over = {}) {
  const today = pktToday();
  return {
    payment_id: id,
    booking_id: `d0000000-0000-4000-8000-00000000000${id.slice(-1)}`,
    court_name: "Court 1",
    court_id: "c1",
    court_sport: "Padel",
    starts_at: `${addDays(today, 1)}T18:00:00+05:00`,
    ends_at: `${addDays(today, 1)}T19:00:00+05:00`,
    player_name: name,
    player_phone: null,
    ocr_verdict: "match",
    ocr_amount: 2000,
    expected_amount: 2000,
    proof_url: null,
    submitted_at: new Date(Date.now() - 600e3).toISOString(),
    minutes_since_submission: 10,
    checks: null,
    state: "awaiting",
    cancelled_at: null,
    has_screenshot: false,
    overpayment: null,
    duplicate: null,
    ...over,
  };
}

/** One page with every Stage 2 endpoint mocked on top of the Overview fixture (later routes run first in Playwright). */
async function openPage(browser, width, lang, S, ctxOpts = {}) {
  const context = await browser.newContext({ viewport: { width, height: width < 768 ? 800 : 900 }, locale: "en-US", timezoneId: "Asia/Karachi", ...ctxOpts });
  await context.addCookies([{ name: "khelo_lang", value: lang, url: BASE }]);
  const user = S.user || USER;
  await context.addInitScript(
    ([u, pushChoice]) => {
      if (!window.localStorage.getItem("maidan.session_token")) {
        window.localStorage.setItem("maidan.session_token", "test-token");
        window.localStorage.setItem("maidan.session_expires_at", "2099-01-01T00:00:00Z");
        window.localStorage.setItem("maidan.cached_user", JSON.stringify(u));
        if (pushChoice) window.localStorage.setItem(`khelo.push.${u.id}`, pushChoice);
        window.localStorage.setItem(`khelo.notif.popup.${u.id}`, "1");
      }
    },
    [user, S.pushChoice || null],
  );
  await context.addInitScript(pushStub, S.push || {});
  const page = await context.newPage();
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (/Failed to load resource|net::ERR/.test(text)) return;
    errors.push(text);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  await mockApi(page, S.ovw, {});
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
  const json = (route, status, body) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(body) });
  await page.route(`${API}/**`, async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const url = new URL(req.url());
    const p = url.pathname.replace(/^\/api\/v1/, "");
    const m = req.method();
    S.paths.push(`${m} ${p}`);
    if (p === "/auth/me") return json(route, 200, { user, session: { device_id: "d", device_name: null, platform: "web", last_active_at: new Date().toISOString(), expires_at: "2099-01-01T00:00:00Z" } });
    if (p === "/users/me/web-push/config") return json(route, 200, S.pushConfig || { enabled: true, public_key: KEY });
    if (p === "/users/me/web-push") {
      if (m === "POST") {
        S.pushCalls.push({ op: "post", body: JSON.parse(req.postData() || "{}") });
        return json(route, 201, {});
      }
      if (m === "DELETE") {
        S.pushCalls.push({ op: "delete", body: JSON.parse(req.postData() || "{}") });
        return route.fulfill({ status: 204, headers: cors });
      }
      return json(route, 200, { subscribed: !!S.serverSubscribed });
    }
    if (p === "/users/me/notifications/feed") return json(route, 200, { items: S.feed || [], page: 1, page_size: 30, has_more: false });
    if (p === "/owners/me/permissions") return S.perms ? json(route, 200, S.perms) : json(route, 404, { error: { code: "NOT_FOUND", message: "x" } });
    if (p === "/owners/badges") return json(route, 200, { approvals: 0, refunds: 0 });
    if (p === "/owners/overview") {
      const ids = (url.searchParams.get("court_ids") || "").split(",").filter(Boolean);
      const o = overviewOf({ ...S.ovw, date: url.searchParams.get("date") || S.ovw.date }, ids);
      o.status_pending_count = S.statusPendingCount;
      if (S.money) o.money = S.money;
      return json(route, 200, o);
    }
    if (p === "/owners/approvals-queue") return json(route, 200, { items: S.queue, total: S.queue.length, page: 1, page_size: 20 });
    let mm = /^\/payments\/([^/]+)\/approve$/.exec(p);
    if (mm) {
      const body = JSON.parse(req.postData() || "{}");
      S.approveCalls.push({ id: mm[1], body });
      const need = S.dup409[mm[1]];
      if (need && !body.confirm_duplicate) return json(route, 409, { error: { code: "DUPLICATE_PROOF_CONFIRM_REQUIRED", message: "dup", details: { used_on_bookings: need } } });
      S.queue = S.queue.filter((i) => i.payment_id !== mm[1]);
      return json(route, 200, { id: mm[1], status: "approved" });
    }
    if (p.startsWith("/owners/refunds")) {
      S.refundCalls += 1;
      return json(route, 200, []);
    }
    if (p === "/owners/bookings-history") {
      S.historyUrls.push(url.search);
      const items = S.ovw.rows;
      return json(route, 200, { items, total: items.length, page: 1, page_size: 25, totals: { count: items.length, total: 0, collected: 0, due: 0 } });
    }
    mm = /^\/bookings\/([^/]+)\/no-show$/.exec(p);
    if (mm && m === "POST") {
      S.noShowCalls.push(mm[1]);
      if (S.noShowFail) {
        const f = S.noShowFail;
        S.noShowFail = null;
        return json(route, f.status, { error: { code: f.code, message: f.code } });
      }
      for (const r of S.ovw.rows) if (r.booking_id === mm[1] && r.kind === "booked") Object.assign(r, { status_key: "no_show", status_pending: false });
      return json(route, 200, { booking: { id: mm[1], status: "no_show" } });
    }
    mm = /^\/owners\/bookings\/([^/]+)\/overview-detail$/.exec(p);
    if (mm) {
      const row = S.ovw.rows.find((r) => r.booking_id === mm[1] && r.kind === "booked") || S.ovw.rows[0];
      return json(route, 200, {
        row, booked_at: row.starts_at, hold_expires_at: null, advance_required: row.advance, payment_id: null, ocr_verdict: null, ocr_amount: null,
        approval: null, cancellation: null, refund: null, completion: row.completion, timeline: [],
      });
    }
    return route.fallback();
  });
  return { page, context, errors };
}

function newS(over = {}) {
  const today = pktToday();
  const ovw = newState(today);
  // b5 / b6 / b7: slot ended, nobody marked: the server's flag (b7 relies on the client rule, like an older backend)
  for (const r of ovw.rows) if (["b5", "b6"].includes(r.booking_id)) r.status_pending = true;
  return {
    ovw, paths: [], pushCalls: [], approveCalls: [], historyUrls: [], noShowCalls: [], refundCalls: 0, dup409: {}, statusPendingCount: 5,
    queue: [dupItem("p1", "Dua Fatima", { duplicate: { used_on_bookings: 2 } }), dupItem("p2", "Ehsan Ali")],
    ...over,
  };
}

async function noHScroll(page, label) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  ok(sw <= iw, `${label}: horizontal scroll (scrollWidth ${sw} > ${iw})`);
}

async function openBell(page) {
  const bell = page.locator('[data-testid="notification-bell"]:visible').first();
  await bell.click();
  await page.locator('[data-testid="notification-panel"]:visible').first().waitFor();
  return page.locator('[data-testid="notification-panel"]:visible').first();
}

async function gotoOverview(page) {
  await page.goto(`${BASE}/dashboard/owner/today`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="ovw-kpis"]', { timeout: 25000 });
  await page.waitForSelector('[data-testid="ovw-row"]');
}

// ---------------------------------------------------------------------------------------------------------------------------
async function pushChecks(browser, width, lang) {
  const tag = `${width}-${lang} push`;
  const L = T[lang];

  // not asked -> enable -> subscribed -> disable -> granted but not subscribed -> enable again without a prompt
  {
    const S = newS({ push: { perm: "default", answer: "granted" } });
    const { page, context, errors } = await openPage(browser, width, lang, S);
    try {
      await gotoOverview(page);
      await page.waitForTimeout(800);
      const before = await page.evaluate(() => ({ ...window.__push }));
      ok(before.requested === 0 && before.registered.length === 0 && before.subscribed === 0, `${tag}: nothing asked / registered on load (${JSON.stringify(before)})`);
      ok(!S.pushCalls.length, `${tag}: no POST on load before opt-in`);
      const panel = await openBell(page);
      const sec = panel.locator('[data-testid="push-section"]');
      ok((await sec.getAttribute("data-state")) === "not-asked", `${tag}: state not-asked (${await sec.getAttribute("data-state")})`);
      const btn = sec.locator('[data-testid="push-enable"]');
      ok((await btn.innerText()).trim() === L.enable, `${tag}: enable label "${await btn.innerText()}"`);
      const bb = await btn.boundingBox();
      ok(bb && bb.height >= 44, `${tag}: enable button 44px`);
      ok((await panel.locator('[data-testid="notification-enable"]').count()) === 0, `${tag}: tab-popup opt-in not shown next to push`);
      ok((await page.evaluate(() => window.__push.requested)) === 0, `${tag}: opening the bell asks nothing`);
      await page.screenshot({ path: path.join(SHOT_DIR, `push-notasked-${width}-${lang}.png`) });
      await btn.click();
      await sec.locator('[data-testid="push-on"]').waitFor({ timeout: 5000 });
      const after = await page.evaluate(() => ({ ...window.__push }));
      ok(after.requested === 1, `${tag}: exactly one permission prompt (${after.requested})`);
      ok(after.registered.length === 1 && after.registered[0] === "/sw.js|/", `${tag}: registered /sw.js scope / (${after.registered})`);
      ok(after.subscribed === 1 && after.subOpts && after.subOpts.userVisibleOnly === true && after.subOpts.keyLen === 65 && after.subOpts.first === 4, `${tag}: subscribe(userVisibleOnly, 65-byte key) ${JSON.stringify(after.subOpts)}`);
      const post = S.pushCalls.find((c) => c.op === "post");
      ok(post && post.body.endpoint === "https://fcm.googleapis.com/fcm/send/new-1" && post.body.keys.p256dh === "BPk3y" && post.body.keys.auth === "QXV0aA", `${tag}: POST body ${JSON.stringify(post && post.body)}`);
      ok((await sec.getAttribute("data-state")) === "subscribed", `${tag}: state subscribed`);
      ok((await sec.locator('[data-testid="push-on"]').innerText()).includes(L.pushOn), `${tag}: "${L.pushOn}"`);
      ok((await panel.getByRole("status").last().innerText()).length > 0, `${tag}: live region announces`);
      await page.screenshot({ path: path.join(SHOT_DIR, `push-subscribed-${width}-${lang}.png`) });
      await sec.locator('[data-testid="push-disable"]').click();
      await sec.locator('[data-testid="push-enable"]').waitFor({ timeout: 5000 });
      const del = S.pushCalls.find((c) => c.op === "delete");
      ok(del && del.body.endpoint === "https://fcm.googleapis.com/fcm/send/new-1", `${tag}: DELETE body ${JSON.stringify(del && del.body)}`);
      ok((await page.evaluate(() => window.__push.unsubscribed)) === 1, `${tag}: browser unsubscribe`);
      ok((await sec.getAttribute("data-state")) === "granted-not-subscribed", `${tag}: state granted-not-subscribed`);
      await sec.locator('[data-testid="push-enable"]').click();
      await sec.locator('[data-testid="push-on"]').waitFor({ timeout: 5000 });
      ok((await page.evaluate(() => window.__push.requested)) === 1, `${tag}: re-enable asks no second time`);
      await noHScroll(page, `${tag} bell open`);
      ok(errors.length === 0, `${tag}: console errors ${errors.join(" | ")}`);
    } catch (e) {
      ok(false, `${tag}: flow threw ${e.message.split("\n")[0]}`);
    } finally {
      await context.close();
    }
  }

  // denied / unsupported / backend off / iPhone not installed
  const variants = [
    { name: "denied", S: { push: { perm: "denied" } }, expect: "denied" },
    { name: "unsupported", S: { push: { noPush: true, noSW: true } }, expect: null },
    { name: "backend-off", S: { push: { perm: "default" }, pushConfig: { enabled: false, public_key: null } }, expect: null },
    { name: "ios", S: { push: { noNotification: true, noPush: true } }, expect: "ios-install", ctx: { userAgent: IPHONE_UA, hasTouch: true } },
  ];
  for (const v of variants) {
    const S = newS(v.S);
    const { page, context, errors } = await openPage(browser, width, lang, S, v.ctx || {});
    try {
      await gotoOverview(page);
      const panel = await openBell(page);
      await page.waitForTimeout(400);
      const sec = panel.locator('[data-testid="push-section"]');
      if (v.expect) {
        ok((await sec.getAttribute("data-state")) === v.expect, `${tag} ${v.name}: state ${await sec.getAttribute("data-state")}`);
        if (v.expect === "denied") ok(await sec.locator('[data-testid="push-denied"]').isVisible(), `${tag} denied: explanation text`);
        if (v.expect === "ios-install") ok(await sec.locator('[data-testid="push-ios-hint"] svg').count() === 1 && (await sec.innerText()).includes("Home Screen"), `${tag} ios: hint with icon`);
        ok((await sec.locator('[data-testid="push-enable"]').count()) === 0, `${tag} ${v.name}: no enable button`);
      } else {
        ok((await sec.count()) === 0, `${tag} ${v.name}: push section hidden`);
      }
      if (v.name === "unsupported" || v.name === "backend-off") ok((await panel.locator('[data-testid="notification-enable"]').count()) === 1, `${tag} ${v.name}: tab popup fallback still offered`);
      ok((await page.evaluate(() => (window.__push ? window.__push.requested : 0))) === 0, `${tag} ${v.name}: nothing asked`);
      if (v.name === "backend-off") ok(!S.pushCalls.length, `${tag} backend-off: no POST`);
      if (width === 360) await page.screenshot({ path: path.join(SHOT_DIR, `push-${v.name}-${width}-${lang}.png`) });
      ok(errors.length === 0, `${tag} ${v.name}: console errors ${errors.join(" | ")}`);
    } catch (e) {
      ok(false, `${tag} ${v.name}: threw ${e.message.split("\n")[0]}`);
    } finally {
      await context.close();
    }
  }

  // re-POST on load (granted + chosen on this device), no prompt, shown as subscribed
  {
    const S = newS({ push: { perm: "granted", existing: true }, pushChoice: "1" });
    const { page, context } = await openPage(browser, width, lang, S);
    try {
      await gotoOverview(page);
      for (let i = 0; i < 20 && !S.pushCalls.length; i += 1) await page.waitForTimeout(200);
      const post = S.pushCalls.find((c) => c.op === "post");
      ok(post && post.body.endpoint === "https://fcm.googleapis.com/fcm/send/existing", `${tag}: re-POST of the existing subscription on load`);
      ok((await page.evaluate(() => window.__push.requested + window.__push.subscribed)) === 0, `${tag}: re-POST asks nothing, makes no new subscription`);
      const panel = await openBell(page);
      ok((await panel.locator('[data-testid="push-section"]').getAttribute("data-state")) === "subscribed", `${tag}: shown as subscribed after reload`);
    } catch (e) {
      ok(false, `${tag} re-post: threw ${e.message.split("\n")[0]}`);
    } finally {
      await context.close();
    }
  }

  // another browser holds a subscription the server does not have for this user -> not "subscribed"
  {
    const S = newS({ push: { perm: "granted", existing: true }, serverSubscribed: false });
    const { page, context } = await openPage(browser, width, lang, S);
    try {
      await gotoOverview(page);
      await page.waitForTimeout(600);
      ok(!S.pushCalls.length, `${tag}: no POST without this user's choice`);
      ok(S.paths.some((x) => x.startsWith("GET /users/me/web-push") && !x.includes("config")), `${tag}: asks the server about THIS device`);
      const panel = await openBell(page);
      ok((await panel.locator('[data-testid="push-section"]').getAttribute("data-state")) === "granted-not-subscribed", `${tag}: foreign subscription is not "on"`);
    } catch (e) {
      ok(false, `${tag} foreign: threw ${e.message.split("\n")[0]}`);
    } finally {
      await context.close();
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
async function overviewChecks(browser, width, lang) {
  const tag = `${width}-${lang} ovw`;
  const L = T[lang];
  const today = pktToday();
  const S = newS();
  const { page, context, errors } = await openPage(browser, width, lang, S);
  try {
    await gotoOverview(page);
    ok((await page.locator("h1").count()) === 1, `${tag}: one h1`);
    const line = page.locator('[data-testid="ovw-status-pending"]');
    ok(await line.isVisible(), `${tag}: status-pending line`);
    ok((await line.innerText()).includes(L.line), `${tag}: line text "${(await line.innerText()).split("\n")[0]}"`);
    ok((await line.getAttribute("href")) === `/dashboard/bookings?from=${addDays(today, -365)}&to=${addDays(today, 365)}&status=status_pending`, `${tag}: line -> History any date status_pending (${await line.getAttribute("href")})`);
    ok((await line.locator("svg").count()) >= 1, `${tag}: line has an icon`);
    const lb = await line.boundingBox();
    ok(lb && lb.height >= 44, `${tag}: line 44px`);
    const chips = page.locator('[data-testid="ovw-row"] [data-testid="status-pending-chip"]');
    ok((await chips.count()) === 3, `${tag}: 3 status-pending chips (${await chips.count()})`);
    ok((await chips.first().innerText()).includes(L.pending) && (await chips.first().locator("svg").count()) === 1, `${tag}: chip icon + "${L.pending}"`);
    const noShowBtns = page.locator('[data-testid="ovw-row"] [data-testid="no-show-btn"]');
    ok((await noShowBtns.count()) === 3, `${tag}: No-show only on the 3 status-pending rows (${await noShowBtns.count()})`);
    ok((await page.locator('[data-testid="ovw-row"]', { hasText: "Hamza Ali" }).locator('[data-testid="no-show-btn"]').count()) === 0, `${tag}: no No-show before the slot ends`);
    ok((await page.locator('[data-testid="ovw-row"]', { hasText: "Usman Tariq" }).locator('[data-testid="no-show-btn"]').count()) === 0, `${tag}: no No-show on a completed row`);

    // PKR on one line (B.c)
    for (const id of ["kpi-collected-value", "kpi-due-value"]) {
      const el = page.locator(`[data-testid="${id}"]`);
      const r = await el.evaluate((e) => {
        const cs = getComputedStyle(e);
        const range = document.createRange();
        range.selectNodeContents(e);
        return { lines: range.getClientRects().length, h: e.getBoundingClientRect().height, fs: parseFloat(cs.fontSize), sw: e.scrollWidth, cw: e.clientWidth, ws: cs.whiteSpace, text: e.textContent };
      });
      ok(r.ws === "nowrap" && r.lines === 1 && r.h < r.fs * 1.6 && r.sw <= r.cw + 1, `${tag}: ${id} "${r.text}" on one line (${JSON.stringify(r)})`);
    }
    await noHScroll(page, `${tag} loaded`);
    await page.screenshot({ path: path.join(SHOT_DIR, `ovw-${width}-${lang}.png`), fullPage: true });

    // No-show: Back sends nothing, a 400 shows in the dialog, confirm marks it
    const row = page.locator('[data-testid="ovw-row"]', { hasText: "Zara Noor" });
    await row.locator('[data-testid="no-show-btn"]').click();
    const dlg = page.locator('[data-testid="no-show-dialog"]');
    await dlg.waitFor();
    ok((await dlg.innerText()).includes("Zara Noor"), `${tag}: dialog names the player`);
    await page.screenshot({ path: path.join(SHOT_DIR, `noshow-dialog-${width}-${lang}.png`) });
    await page.keyboard.press("Escape");
    await dlg.waitFor({ state: "detached" });
    ok(S.noShowCalls.length === 0, `${tag}: Escape/Back sends nothing`);
    S.noShowFail = { status: 400, code: "TOO_EARLY_FOR_NO_SHOW" };
    await row.locator('[data-testid="no-show-btn"]').click();
    await dlg.waitFor();
    await dlg.locator('[data-testid="no-show-confirm"]').click();
    await page.waitForFunction(() => {
      const e = document.querySelector('[data-testid="no-show-error"]');
      return e && e.textContent.trim().length > 0;
    });
    ok(await dlg.isVisible(), `${tag}: error keeps the dialog open`);
    await dlg.locator('[data-testid="no-show-confirm"]').click();
    await dlg.waitFor({ state: "detached" });
    ok(S.noShowCalls.length === 2 && S.noShowCalls[1] === "b5", `${tag}: POST /bookings/b5/no-show (${S.noShowCalls})`);
    await page.waitForFunction(() => {
      const rows = [...document.querySelectorAll('[data-testid="ovw-row"]')].filter((r) => r.textContent.includes("Zara Noor"));
      return rows.length && !rows[0].querySelector('[data-testid="status-pending-chip"]');
    }, null, { timeout: 8000 });
    const rowText = await row.innerText();
    ok(rowText.includes(lang === "ru" ? "No-show" : "No-show"), `${tag}: row now No-show`);
    ok((await row.locator("select").isEnabled()), `${tag}: a no_show row still offers Haan / Nahi`);
    ok((await page.locator('[data-testid="ovw-noshow-live"]').innerText()).includes("Zara Noor"), `${tag}: aria-live confirmation`);

    // the booking popup: chip + No-show for a pending row
    await page.locator('[data-testid="ovw-row"]', { hasText: "Imran Shah" }).locator('[data-testid="ovw-open-detail"]').click();
    const modal = page.locator('[role="dialog"]').last();
    await modal.getByText(L.pending).first().waitFor({ timeout: 8000 });
    ok((await modal.locator('[data-testid="no-show-btn"]').count()) === 1, `${tag}: popup offers No-show`);
    ok((await modal.locator('[aria-pressed]').count()) === 2, `${tag}: popup offers Haan / Nahi to the owner`);
    await page.keyboard.press("Escape");
    ok(errors.length === 0, `${tag}: console errors ${errors.join(" | ")}`);
  } catch (e) {
    ok(false, `${tag}: threw ${e.message.split("\n")[0]}`);
    await page.screenshot({ path: path.join(SHOT_DIR, `FAIL-ovw-${width}-${lang}.png`), fullPage: true }).catch(() => {});
  } finally {
    await context.close();
  }

  // big money still one line
  {
    const S2 = newS({ money: { collected: 1231500, due: 1012000, due_bookings: 9 } });
    const r2 = await openPage(browser, width, lang, S2);
    try {
      await gotoOverview(r2.page);
      for (const id of ["kpi-collected-value", "kpi-due-value"]) {
        const r = await r2.page.locator(`[data-testid="${id}"]`).evaluate((e) => {
          const range = document.createRange();
          range.selectNodeContents(e);
          return { lines: range.getClientRects().length, sw: e.scrollWidth, cw: e.clientWidth, text: e.textContent };
        });
        ok(r.lines === 1 && r.sw <= r.cw + 1, `${tag}: big ${id} "${r.text}" fits on one line (${JSON.stringify(r)})`);
      }
      await noHScroll(r2.page, `${tag} big money`);
    } finally {
      await r2.context.close();
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
async function historyChecks(browser, width, lang) {
  const tag = `${width}-${lang} hist`;
  const L = T[lang];
  const today = pktToday();
  const S = newS();
  const { page, context, errors } = await openPage(browser, width, lang, S);
  try {
    await page.goto(`${BASE}/dashboard/bookings?from=${addDays(today, -365)}&to=${addDays(today, 365)}&status=status_pending`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-booking-id]', { timeout: 25000 });
    ok((await page.locator("h1").count()) === 1, `${tag}: one h1`);
    ok(S.historyUrls.some((u) => new URLSearchParams(u).getAll("statuses").includes("status_pending")), `${tag}: request has statuses=status_pending (${S.historyUrls.slice(-1)})`);
    ok((await page.getByText(L.pending, { exact: false }).count()) >= 2, `${tag}: filter summary + chips say "${L.pending}"`);
    const chips = page.locator('[data-testid="status-pending-chip"]');
    ok((await chips.count()) === 3, `${tag}: 3 chips (${await chips.count()})`);
    const btns = page.locator('[data-testid="no-show-btn"]');
    ok((await btns.count()) === 3, `${tag}: 3 No-show buttons (${await btns.count()})`);
    await btns.first().click();
    const dlg = page.locator('[data-testid="no-show-dialog"]');
    await dlg.waitFor();
    await dlg.locator('[data-testid="no-show-confirm"]').click();
    await dlg.waitFor({ state: "detached" });
    ok(S.noShowCalls.length === 1, `${tag}: no-show POST from History`);
    ok((await page.locator('[data-testid="hist-noshow-live"]').innerText()).length > 0, `${tag}: aria-live confirmation`);
    await noHScroll(page, `${tag}`);
    await page.screenshot({ path: path.join(SHOT_DIR, `hist-${width}-${lang}.png`), fullPage: true });
    ok(errors.length === 0, `${tag}: console errors ${errors.join(" | ")}`);
  } catch (e) {
    ok(false, `${tag}: threw ${e.message.split("\n")[0]}`);
    await page.screenshot({ path: path.join(SHOT_DIR, `FAIL-hist-${width}-${lang}.png`), fullPage: true }).catch(() => {});
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
async function approvalsChecks(browser, width, lang) {
  const tag = `${width}-${lang} appr`;
  const L = T[lang];
  const S = newS();
  S.dup409.p2 = 3;
  const { page, context, errors } = await openPage(browser, width, lang, S);
  try {
    await page.goto(`${BASE}/dashboard/owner/approvals`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-card-id="p1"]', { timeout: 25000 });
    ok((await page.locator("h1").count()) === 1, `${tag}: one h1`);
    const chip = page.locator('[data-card-id="p1"] [data-testid="dup-chip"]');
    ok(await chip.isVisible(), `${tag}: duplicate chip on the flagged card`);
    ok((await chip.locator("svg").count()) === 1 && (await chip.innerText()).includes("2"), `${tag}: chip icon + count`);
    ok((await page.locator('[data-card-id="p2"] [data-testid="dup-chip"]').count()) === 0, `${tag}: no chip on the clean card`);
    await noHScroll(page, `${tag}`);
    // flagged: approve dialog -> separate confirm -> Back sends nothing
    await page.locator('[data-card-id="p1"] [data-testid="approve"]').click();
    await page.locator('[data-testid="approve-confirm"]').click();
    const dup = page.locator('[data-testid="dup-dialog"]');
    await dup.waitFor();
    ok((await dup.locator('[data-testid="dup-question"]').innerText()).includes(L.dupQ), `${tag}: question "${await dup.locator('[data-testid="dup-question"]').innerText()}"`);
    ok(S.approveCalls.length === 0, `${tag}: nothing sent before the second confirm`);
    await page.screenshot({ path: path.join(SHOT_DIR, `dup-dialog-${width}-${lang}.png`) });
    await dup.locator('[data-testid="dup-back"]').click();
    await dup.waitFor({ state: "detached" });
    ok(S.approveCalls.length === 0 && (await page.locator('[data-card-id="p1"]').count()) === 1, `${tag}: Back keeps the card, sends nothing`);
    await page.locator('[data-card-id="p1"] [data-testid="approve"]').click();
    await page.locator('[data-testid="approve-confirm"]').click();
    await dup.waitFor();
    await dup.locator('[data-testid="dup-confirm"]').click();
    await dup.waitFor({ state: "detached" });
    for (let i = 0; i < 20 && !S.approveCalls.length; i += 1) await page.waitForTimeout(100);
    ok(S.approveCalls.length === 1 && S.approveCalls[0].body.confirm_duplicate === true, `${tag}: approve with confirm_duplicate (${JSON.stringify(S.approveCalls[0])})`);
    // clean card but the server says 409: same confirm, then confirm_duplicate
    await page.locator('[data-card-id="p2"] [data-testid="approve"]').click();
    await page.locator('[data-testid="approve-confirm"]').click();
    await dup.waitFor({ timeout: 8000 });
    ok(S.approveCalls.length === 2 && !S.approveCalls[1].body.confirm_duplicate, `${tag}: first try without the flag`);
    ok((await dup.locator('[data-testid="dup-question"]').innerText()).includes(L.dupQ3), `${tag}: 409 -> same confirm with the server's count`);
    ok((await page.locator('[data-card-id="p2"]').count()) === 1, `${tag}: card back after the 409`);
    await dup.locator('[data-testid="dup-confirm"]').click();
    await dup.waitFor({ state: "detached" });
    for (let i = 0; i < 20 && S.approveCalls.length < 3; i += 1) await page.waitForTimeout(100);
    ok(S.approveCalls.length === 3 && S.approveCalls[2].body.confirm_duplicate === true, `${tag}: retried with confirm_duplicate`);
    ok(errors.length === 0, `${tag}: console errors ${errors.join(" | ")}`);
  } catch (e) {
    ok(false, `${tag}: threw ${e.message.split("\n")[0]}`);
    await page.screenshot({ path: path.join(SHOT_DIR, `FAIL-appr-${width}-${lang}.png`), fullPage: true }).catch(() => {});
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
async function permissionChecks(browser, width, lang) {
  const tag = `${width}-${lang} perms`;
  const today = pktToday();
  // 1) staff with view_ledger only: every action hidden up front
  {
    const S = newS({ user: STAFF, perms: staffPerms(["view_ledger"]) });
    const { page, context, errors } = await openPage(browser, width, lang, S);
    try {
      await page.goto(`${BASE}/dashboard/owner/approvals`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector('[data-card-id="p1"]', { timeout: 25000 });
      await page.waitForTimeout(300);
      ok((await page.locator('[data-testid="approve"], [data-testid="reject"]').count()) === 0, `${tag}: no Approve / Reject for staff without approve_payments`);
      ok((await page.locator('[data-testid="appr-no-permission"]').count()) >= 1, `${tag}: the no-permission note instead`);
      ok(S.approveCalls.length === 0, `${tag}: nothing sent`);

      await page.goto(`${BASE}/dashboard/owner/refunds`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector('[data-testid="refunds-no-permission"]', { timeout: 25000 });
      ok(S.refundCalls === 0, `${tag}: refunds list never requested (${S.refundCalls})`);
      ok((await page.locator("h1").count()) === 1, `${tag}: refunds one h1`);

      await gotoOverview(page);
      await page.waitForTimeout(300);
      ok((await page.locator('[data-testid="ovw-completion-select"]').count()) === 0, `${tag}: no Haan / Nahi dropdown`);
      ok((await page.locator('[data-testid="no-show-btn"]').count()) === 0, `${tag}: no No-show buttons`);
      ok((await page.locator('[data-testid="status-pending-chip"]').count()) === 3, `${tag}: chips still shown (information)`);
      await page.locator('[data-testid="ovw-row"]', { hasText: "Imran Shah" }).locator('[data-testid="ovw-open-detail"]').click();
      const modal = page.locator('[role="dialog"]').last();
      await modal.getByText(/KH-0BB2C3D4/).first().waitFor({ timeout: 8000 });
      await page.waitForTimeout(300);
      ok((await modal.locator('[aria-pressed]').count()) === 0 && (await modal.locator('[data-testid="no-show-btn"]').count()) === 0, `${tag}: popup without Haan / Nahi / No-show`);
      await page.keyboard.press("Escape");

      await page.goto(`${BASE}/dashboard/bookings?from=${addDays(today, -365)}&to=${addDays(today, 365)}`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector('[data-booking-id]', { timeout: 25000 });
      await page.waitForTimeout(300);
      ok((await page.locator('[data-booking-id] select').count()) === 0, `${tag}: History without Haan / Nahi`);
      ok((await page.locator('[data-testid="no-show-btn"]').count()) === 0, `${tag}: History without No-show`);
      ok(errors.length === 0, `${tag}: console errors ${errors.join(" | ")}`);
    } catch (e) {
      ok(false, `${tag} view-only: threw ${e.message.split("\n")[0]}`);
      await page.screenshot({ path: path.join(SHOT_DIR, `FAIL-perms-${width}-${lang}.png`), fullPage: true }).catch(() => {});
    } finally {
      await context.close();
    }
  }
  // 2) staff with approve_payments + check_in: Approve and No-show yes, completion dropdown no
  {
    const S = newS({ user: STAFF, perms: staffPerms(["view_ledger", "approve_payments", "check_in"]) });
    const { page, context } = await openPage(browser, width, lang, S);
    try {
      await page.goto(`${BASE}/dashboard/owner/approvals`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector('[data-card-id="p1"] [data-testid="approve"]', { timeout: 25000 });
      ok(true, "approve visible");
      await gotoOverview(page);
      await page.waitForSelector('[data-testid="no-show-btn"]', { timeout: 8000 });
      ok((await page.locator('[data-testid="no-show-btn"]').count()) === 3, `${tag}: No-show for check_in staff`);
      ok((await page.locator('[data-testid="ovw-completion-select"]').count()) === 0, `${tag}: still no dropdown without record_payments`);
    } catch (e) {
      ok(false, `${tag} partial: threw ${e.message.split("\n")[0]}`);
    } finally {
      await context.close();
    }
  }
}

async function staticChecks() {
  const sw = await fetch(`${BASE}/sw.js`);
  const body = await sw.text();
  ok(sw.status === 200, `sw.js status ${sw.status}`);
  ok((sw.headers.get("cache-control") || "").includes("no-cache"), `sw.js cache-control "${sw.headers.get("cache-control")}"`);
  ok(sw.headers.get("service-worker-allowed") === "/", `sw.js Service-Worker-Allowed "${sw.headers.get("service-worker-allowed")}"`);
  ok(/javascript/.test(sw.headers.get("content-type") || ""), `sw.js content-type "${sw.headers.get("content-type")}"`);
  ok(["push", "notificationclick", "pushsubscriptionchange"].every((e) => body.includes(`"${e}"`)), "sw.js has the three handlers");
  const mf = await fetch(`${BASE}/manifest.webmanifest`);
  ok(mf.status === 200, `manifest status ${mf.status}`);
  const m = await mf.json().catch(() => ({}));
  ok(m.name === "Khelo" && m.display === "standalone" && m.start_url === "/", `manifest fields ${JSON.stringify({ n: m.name, d: m.display, s: m.start_url })}`);
  for (const icon of m.icons || []) {
    const r = await fetch(`${BASE}${icon.src}`);
    ok(r.status === 200, `manifest icon ${icon.src} ${r.status}`);
  }
  for (const f of ["/brand/khelo-icon-192.png", "/brand/khelo-badge-96.png"]) ok((await fetch(`${BASE}${f}`)).status === 200, `${f} served`);
  const home = await (await fetch(`${BASE}/login`)).text();
  ok(/rel="manifest"/.test(home), "pages link the manifest");
  ok(/rel="apple-touch-icon"/.test(home), "pages link an apple-touch-icon");
}

async function popupSuppression(browser) {
  // subscribed here + the tab popup opted in earlier: a new feed row must not open a second, tab-open popup
  const S = newS({ push: { perm: "granted", existing: true }, pushChoice: "1", feed: [] });
  const { page, context } = await openPage(browser, 1280, "en", S);
  try {
    await gotoOverview(page);
    await page.waitForTimeout(1500);
    S.feed = [{ id: "n1", event_type: "payment_submitted", kind: "payment_submitted", created_at: new Date().toISOString(), params: { player_name: "Ali" }, link: { kind: "approvals" }, deliveries: [] }];
    await page.waitForTimeout(16500); // one poll
    const shown = await page.evaluate(() => window.__push.shown);
    ok(shown === 0, `popup suppressed while subscribed (shown ${shown})`);
    const feedCalls = S.paths.filter((x) => x.endsWith("/users/me/notifications/feed")).length;
    ok(feedCalls >= 2, `feed polled (${feedCalls})`);
  } finally {
    await context.close();
  }
}

async function main() {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  try {
    await staticChecks();
    for (const lang of LANGS) {
      for (const width of WIDTHS) {
        await pushChecks(browser, width, lang);
        await overviewChecks(browser, width, lang);
        await historyChecks(browser, width, lang);
        await approvalsChecks(browser, width, lang);
        await permissionChecks(browser, width, lang);
        console.log(`done ${width}-${lang}: ${checks} checks, ${failures.length} failures so far`);
      }
    }
    if (!process.env.SKIP_POLL) await popupSuppression(browser);
  } finally {
    await browser.close();
  }
  console.log(`\n${checks} checks, ${failures.length} failures. Screenshots: ${SHOT_DIR}`);
  for (const f of failures) console.log(`FAIL ${f}`);
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
