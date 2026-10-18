#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Owner Round 2 (W2) check: Overview cards (A7), "Nahi" received-now semantics (A8) and the free voice textarea (A9).
 * Plain Node + Playwright, every API call mocked (fixture shared with e2e/overview-check.cjs), and the browser's speech
 * recogniser replaced by a scripted stub, so continuous listening can be driven: auto-restart on onend until stopped, interim
 * text, Urdu script -> Roman Urdu, the timer, permission denied, and a Firefox-like browser without the API.
 * Run against a PRODUCTION build made with NEXT_PUBLIC_API_BASE_URL=http://localhost:8099:
 *   BASE_URL=http://localhost:3822 node e2e/round2-overview-check.cjs
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadPlaywright } = require("./smoke.cjs");
const { pktToday, addDays, newState, newPage } = require("./overview-check.cjs");

const SHOT_DIR = process.env.SHOT_DIR || path.join(os.tmpdir(), "ovw-r2", "shots");
const WIDTHS = (process.env.WIDTHS || "360,768,1280").split(",").map(Number);
const LANGS = (process.env.LANGS || "en,ru").split(",");
const BASE = (process.env.BASE_URL || "http://localhost:3822").replace(/\/+$/, "");
fs.mkdirSync(SHOT_DIR, { recursive: true });

const failures = [];
let checks = 0;
function ok(cond, msg) {
  checks += 1;
  if (!cond) failures.push(msg);
}

// What Chrome's ur-PK recogniser returns (Urdu script), kept ASCII with unicode escapes.
const UR_INTERIM = "\u06a9\u0633\u0679\u0645\u0631 \u0646\u06d2";
const UR_FINAL = "\u06a9\u0633\u0679\u0645\u0631 \u0646\u06d2 \u06a9\u06c1\u0627 \u0628\u0627\u0642\u06cc \u067e\u06cc\u0633\u06c1 \u06a9\u0644 \u062f\u06d2 \u06af\u0627";
const UR_NUMBER = "\u062f\u0648 \u06c1\u0632\u0627\u0631 \u067e\u0627\u0646\u0686 \u0633\u0648";

const T = {
  en: { scope: "All dates", approval: "Approval (4)", payment: "Waiting for payment (3)", dayHint: "Slots on this day", freeLine: "Free: 30 coming", listening: "Listening", denied: /permission/i, unsupported: /Chrome or Edge/, optional: /optional/i, full: /Complete/, reasonErr: /reason/i },
  ru: { scope: "Sab dino ki", approval: "Approval (4)", payment: "Payment ke intezar (3)", dayHint: "Is din ke slots", freeLine: "Khali: 30 aane wale", listening: "Sun raha hoon", denied: /ijazat/i, unsupported: /Chrome ya Edge/, optional: /agar chahein/i, full: /Mukammal/, reasonErr: /Wajah/i },
};

/** Stub for the Web Speech API: records starts/stops and lets the test emit results, errors and ends. */
function speechStub() {
  const log = { instances: [], starts: 0, stops: 0, lastLang: "", cfg: null };
  window.__speech = log;
  class FakeRecognition {
    constructor() {
      this.lang = "";
      this.continuous = false;
      this.interimResults = false;
      this.onresult = null;
      this.onerror = null;
      this.onend = null;
      log.instances.push(this);
    }
    start() {
      log.starts += 1;
      log.lastLang = this.lang;
      log.cfg = { continuous: this.continuous, interim: this.interimResults };
    }
    stop() {
      log.stops += 1;
      setTimeout(() => this.onend && this.onend(), 20);
    }
  }
  window.webkitSpeechRecognition = FakeRecognition;
  window.SpeechRecognition = FakeRecognition;
  const cur = () => log.instances[log.instances.length - 1];
  window.__emit = (results, resultIndex) => {
    const list = results.map(([t, f]) => ({ isFinal: f, 0: { transcript: t } }));
    cur().onresult({ resultIndex: resultIndex || 0, results: list });
  };
  window.__end = () => cur().onend && cur().onend();
  window.__err = (code) => cur().onerror && cur().onerror({ error: code });
}

function noSpeech() {
  delete window.webkitSpeechRecognition;
  delete window.SpeechRecognition;
  try {
    Object.defineProperty(window, "webkitSpeechRecognition", { value: undefined, configurable: true, writable: true });
    Object.defineProperty(window, "SpeechRecognition", { value: undefined, configurable: true, writable: true });
  } catch {
    /* ignore */
  }
}

async function noHScroll(page, label) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  ok(sw <= iw, `${label}: horizontal scroll (scrollWidth ${sw} > ${iw})`);
}

async function openNahi(page, name) {
  const row = page.locator('[data-testid="ovw-row"]', { hasText: name });
  await row.locator("select").selectOption("no");
  const cd = page.locator('[data-testid="ovw-completion-dialog"]');
  await cd.waitFor();
  return { row, cd };
}

async function runOne(browser, width, lang) {
  const tag = `${width}-${lang}`;
  const L = T[lang];
  const today = pktToday();
  const state = newState(today);
  const { page, context, errors } = await newPage(browser, width, lang, state, {});
  await context.addInitScript(speechStub);
  const narrow = width < 768;
  try {
    await page.goto(`${BASE}/dashboard/owner/today`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="ovw-kpis"]', { timeout: 20000 });
    await page.waitForSelector('[data-testid="ovw-row"]');
    ok((await page.locator("h1").count()) === 1, `${tag}: one h1`);

    // ---- A7 layout
    const order = await page.$$eval('[data-testid="ovw-kpis"] [data-testid^="kpi-"]', (els) =>
      els.map((e) => e.getAttribute("data-testid")).filter((id) => /^kpi-(total|pending|bookings|cancelled|refunds|collected|due)$/.test(id)),
    );
    ok(JSON.stringify(order) === JSON.stringify(["kpi-total", "kpi-pending", "kpi-bookings", "kpi-cancelled", "kpi-refunds", "kpi-collected", "kpi-due"]), `${tag}: card order ${order.join(",")}`);
    ok((await page.locator('[data-testid="kpi-free"], [data-testid="kpi-booked"]').count()) === 0, `${tag}: Free/Booked cards removed`);
    const tb = await page.locator('[data-testid="kpi-total"]').boundingBox();
    const pb = await page.locator('[data-testid="kpi-pending"]').boundingBox();
    if (narrow) ok(pb.y >= tb.y + tb.height - 1, `${tag}: Pending stacks under Total on a phone`);
    else ok(Math.abs(pb.y - tb.y) < 4 && pb.x > tb.x + tb.width - 1, `${tag}: Pending sits beside Total in the top row`);

    // legend: four 44px buttons with the right targets
    const legend = page.locator('[data-testid="kpi-legend"] li > *');
    ok((await legend.count()) === 4, `${tag}: 4 legend items`);
    for (let i = 0; i < 4; i += 1) {
      const b = await legend.nth(i).boundingBox();
      ok(b && b.height >= 44, `${tag}: legend item ${i} is ${b && Math.round(b.height)}px high`);
    }
    ok((await page.locator('[data-testid="kpi-legend-booked"]').getAttribute("href")) === `/dashboard/bookings?from=${today}&to=${today}&status=booked`, `${tag}: Booked -> History booked that day`);
    ok((await page.locator('[data-testid="kpi-legend-pending"]').getAttribute("href")) === `/dashboard/owner/approvals?date=${today}`, `${tag}: Pending -> Approvals that day`);
    ok((await page.locator('[data-testid="kpi-legend-pending"]').innerText()).includes(L.dayHint), `${tag}: bar Pending says "${L.dayHint}"`);
    ok((await page.locator('[data-testid="kpi-free-line"]').innerText()).includes(L.freeLine), `${tag}: free split line`);
    ok(await page.locator('[data-testid="ovw-more-courts"]').isVisible(), `${tag}: +N aur in the court breakdown`);

    // pending (any date) card
    ok((await page.locator('[data-testid="kpi-pending-scope"]').innerText()).includes(L.scope), `${tag}: "${L.scope}" subtitle`);
    ok((await page.locator('[data-testid="kpi-pending-n"]').innerText()).trim() === "7", `${tag}: any-date pending count`);
    ok((await page.locator('[data-testid="kpi-pending-approval"]').innerText()).includes(L.approval), `${tag}: Approval (N)`);
    ok((await page.locator('[data-testid="kpi-pay-waiting"]').innerText()).includes(L.payment), `${tag}: Payment ke intezar (M)`);
    ok((await page.locator('[data-testid="kpi-pending-approval"]').getAttribute("href")) === "/dashboard/owner/approvals", `${tag}: Approval link has no date`);
    ok((await page.locator('[data-testid="kpi-pay-waiting"]').getAttribute("href")) === `/dashboard/bookings?from=${addDays(today, -365)}&to=${addDays(today, 365)}&status=held`, `${tag}: payment-waiting link spans all dates`);
    await noHScroll(page, `${tag} cards`);
    await page.locator('[data-testid="ovw-kpis"]').screenshot({ path: path.join(SHOT_DIR, `cards-${tag}.png`) });

    // Free -> slots popup filtered to free; filter switch
    await page.locator('[data-testid="kpi-legend-free"]').click();
    const dlg = page.locator('[data-testid="ovw-slots-dialog"]');
    await dlg.waitFor();
    await page.waitForSelector('[data-testid="ovw-slots-court"] li[data-slot-view]');
    await page.waitForTimeout(300);
    ok((await dlg.locator('[data-testid="ovw-slots-filter-free"]').getAttribute("aria-pressed")) === "true", `${tag}: popup opened on the Free filter`);
    const views = await dlg.locator("li[data-slot-view]").evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute("data-slot-view")))]);
    ok(views.length > 0 && views.every((v) => v === "free" || v === "past"), `${tag}: only free slots shown (${views.join(",")})`);
    await dlg.locator('[data-testid="ovw-slots-filter-booked"]').click();
    const booked = await dlg.locator("li[data-slot-view]").evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute("data-slot-view")))]);
    ok(booked.length === 1 && booked[0] === "booked", `${tag}: Booked filter (${booked.join(",")})`);
    await dlg.locator('[data-testid="ovw-slots-filter-all"]').click();
    const all = await dlg.locator("li[data-slot-view]").evaluateAll((els) => new Set(els.map((e) => e.getAttribute("data-slot-view"))).size);
    ok(all >= 4, `${tag}: All filter shows every state`);
    await noHScroll(page, `${tag} slots popup`);
    await page.screenshot({ path: path.join(SHOT_DIR, `slots-filter-${tag}.png`) });
    await page.keyboard.press("Escape");
    await page.locator('[data-testid="kpi-legend-blocked"]').click();
    await dlg.waitFor();
    ok((await dlg.locator('[data-testid="ovw-slots-filter-blocked"]').getAttribute("aria-pressed")) === "true", `${tag}: Blocked opens the Blocked filter`);
    await page.keyboard.press("Escape");

    // ---- A8 + A9 on Imran (total 4,500, paid 2,000, due 2,500)
    let { row: imran, cd } = await openNahi(page, "Imran Shah");
    ok((await cd.locator('[data-testid="ovw-received"]').inputValue()) === "0", `${tag}: amount defaults to 0`);
    await cd.locator('[data-testid="ovw-completion-save"]').click();
    ok(await cd.locator('[data-testid="ovw-reason-error"]').isVisible(), `${tag}: reason required while due remains`);
    ok(state.calls.filter((c) => c.id === "b6").length === 0, `${tag}: nothing posted without a reason`);
    await cd.locator('[data-testid="ovw-received"]').fill("2600");
    await cd.locator('[data-testid="ovw-completion-save"]').click();
    ok((await cd.locator('[data-testid="ovw-received"]').getAttribute("aria-invalid")) === "true", `${tag}: more than the due is refused`);
    await cd.locator('[data-testid="ovw-received"]').fill("1000");
    ok((await cd.locator('[data-testid="ovw-preview"]').innerText()).includes("PKR 1,500"), `${tag}: live line says Due PKR 1,500`);
    ok((await cd.locator('[data-testid="ovw-preview"]').innerText()).includes("PKR 3,000"), `${tag}: live line shows paid 3,000`);

    // voice: start, interim, final Urdu -> Roman, auto-restart, timer, stop
    const mic = cd.locator('[data-testid="voice-mic"]');
    ok((await mic.count()) === 1, `${tag}: mic shown when speech recognition exists`);
    const micBox = await mic.boundingBox();
    ok(micBox && micBox.height >= 44, `${tag}: mic is 44px`);
    await mic.click();
    ok((await mic.getAttribute("aria-pressed")) === "true", `${tag}: mic pressed`);
    let sp = await page.evaluate(() => window.__speech);
    ok(sp.starts === 1 && sp.cfg.continuous === true && sp.cfg.interim === true && sp.lastLang === "ur-PK", `${tag}: continuous ur-PK with interim (${JSON.stringify(sp.cfg)} ${sp.lastLang})`);
    ok(await cd.locator('[data-testid="voice-dot"]').isVisible(), `${tag}: red dot`);
    ok((await cd.locator('[data-testid="voice-listening"]').innerText()).includes(L.listening), `${tag}: listening text`);
    await page.evaluate((t) => window.__emit([[t, false]]), UR_INTERIM);
    ok((await cd.locator('[data-testid="voice-interim"]').innerText()).trim() === "customer ne", `${tag}: interim shown live in Roman Urdu`);
    await page.evaluate((t) => window.__emit([[t, true]]), UR_FINAL);
    const textarea = cd.locator("textarea");
    ok((await textarea.inputValue()) === "customer ne kaha baqi paisa kal dega", `${tag}: Urdu final -> Roman Urdu (${await textarea.inputValue()})`);
    await page.evaluate(() => window.__end()); // Chrome ends after a pause...
    sp = await page.evaluate(() => window.__speech);
    ok(sp.starts === 2 && (await mic.getAttribute("aria-pressed")) === "true", `${tag}: restarted on onend, still listening (starts=${sp.starts})`);
    await page.evaluate((t) => window.__emit([[t, true]]), UR_NUMBER);
    ok((await textarea.inputValue()) === "customer ne kaha baqi paisa kal dega 2500", `${tag}: numbers spoken in Urdu become digits (${await textarea.inputValue()})`);
    await page.waitForTimeout(2300);
    const timer = (await cd.locator('[data-testid="voice-timer"]').innerText()).trim();
    ok(/^0:0[2-9]$/.test(timer), `${tag}: timer runs (${timer})`);
    await noHScroll(page, `${tag} listening`);
    await page.screenshot({ path: path.join(SHOT_DIR, `voice-listening-${tag}.png`) });
    await mic.click();
    await page.waitForTimeout(100);
    sp = await page.evaluate(() => window.__speech);
    ok((await mic.getAttribute("aria-pressed")) === "false" && sp.stops >= 1 && sp.starts === 2, `${tag}: tap again stops, no restart after the end (starts=${sp.starts})`);
    ok((await cd.locator('[data-testid="voice-dot"]').count()) === 0, `${tag}: dot gone after stop`);
    // text stays editable
    await textarea.fill("customer ne kaha baqi paisa kal dega");
    // English toggle, then permission denied
    await cd.locator('[data-testid="voice-lang-en"]').click();
    await mic.click();
    sp = await page.evaluate(() => window.__speech);
    ok(sp.lastLang === "en-IN", `${tag}: English toggle uses en-IN`);
    await page.evaluate(() => window.__err("not-allowed"));
    await page.evaluate(() => window.__end());
    ok(await cd.locator('[data-testid="voice-error"]').waitFor({ timeout: 3000 }).then(() => true, () => false), `${tag}: permission denied message`);
    ok(L.denied.test(await cd.locator('[data-testid="voice-error"]').innerText()), `${tag}: denied text is clear`);
    sp = await page.evaluate(() => window.__speech);
    ok(sp.starts === 3 && (await mic.getAttribute("aria-pressed")) === "false", `${tag}: denied stops listening (starts=${sp.starts})`);
    await page.screenshot({ path: path.join(SHOT_DIR, `voice-denied-${tag}.png`) });

    // save with an instant row update (server slowed down)
    state.delayMs = 1500;
    await cd.locator('[data-testid="ovw-completion-save"]').click();
    await page.waitForFunction(() => {
      const r = [...document.querySelectorAll('[data-testid="ovw-row"]')].find((e) => e.textContent.includes("Imran Shah"));
      return r && r.textContent.includes("3,000") && r.textContent.includes("1,500");
    }, null, { timeout: 1200 }).catch(() => {});
    const instant = await imran.textContent();
    ok(instant.includes("3,000") && instant.includes("1,500"), `${tag}: row updates at once (paid 3,000, due 1,500)`);
    await cd.waitFor({ state: "detached", timeout: 10000 });
    state.delayMs = 0;
    const call = state.calls.find((c) => c.id === "b6");
    ok(call && call.body.result === "no" && call.body.received_now === 1000 && call.body.received_pkr === 3000 && /baqi paisa kal dega/.test(call.body.reason || ""), `${tag}: POST received_now 1000 (${JSON.stringify(call && call.body)})`);
    await page.waitForTimeout(400);
    ok((await imran.getAttribute("data-tone")) === "red", `${tag}: Adhoora (due remains)`);

    // Zara: 1,200 = the whole due -> Mukammal, no reason needed
    ({ cd } = await openNahi(page, "Zara Noor"));
    await cd.locator('[data-testid="ovw-received-full"]').click();
    ok((await cd.locator('[data-testid="ovw-preview"]').getAttribute("data-outcome")) === "yes", `${tag}: entering the whole due -> Mukammal`);
    ok(L.full.test(await cd.locator('[data-testid="ovw-preview"]').innerText()), `${tag}: Mukammal message`);
    ok(L.optional.test(await cd.locator('[data-testid="voice-textarea"] label').innerText()), `${tag}: reason optional when nothing stays due`);
    await cd.locator('[data-testid="ovw-completion-save"]').click();
    await cd.waitFor({ state: "detached", timeout: 10000 });
    const zcall = state.calls.find((c) => c.id === "b5");
    ok(zcall && zcall.body.received_now === 1200 && !zcall.body.reason, `${tag}: POST received_now 1200 without reason`);
    await page.waitForTimeout(400);
    ok((await page.locator('[data-testid="ovw-row"]', { hasText: "Zara Noor" }).getAttribute("data-tone")) === "green", `${tag}: Zara row green (Mukammal)`);

    // Nida: 0 + reason -> money unchanged; a failed save rolls the row back
    const nidaRow = page.locator('[data-testid="ovw-row"]', { hasText: "Nida Rauf" });
    ({ cd } = await openNahi(page, "Nida Rauf"));
    await cd.locator("textarea").fill("kal dega");
    state.fail = { status: 500, code: "SERVER_ERROR" };
    await cd.locator('[data-testid="ovw-completion-save"]').click();
    await cd.locator('[data-testid="ovw-completion-error"]:not(.sr-only)').waitFor();
    ok((await nidaRow.getAttribute("data-tone")) === "none", `${tag}: failed save rolls the row back`);
    await cd.locator('[data-testid="ovw-completion-save"]').click();
    await cd.waitFor({ state: "detached", timeout: 10000 });
    const ncall = state.calls.filter((c) => c.id === "b7").pop();
    ok(ncall && ncall.body.received_now === 0 && ncall.body.received_pkr === 1000 && ncall.body.reason === "kal dega", `${tag}: POST received_now 0 + reason`);
    await page.waitForTimeout(400);
    const nt = await nidaRow.innerText();
    ok((await nidaRow.getAttribute("data-tone")) === "red" && nt.includes("1,000") && nt.includes("2,000"), `${tag}: 0 + reason leaves paid 1,000 / due 2,000, Adhoora`);
    await noHScroll(page, `${tag} end`);
    ok(errors.length === 0, `${tag}: console errors: ${errors.slice(0, 3).join(" || ")}`);
  } catch (e) {
    failures.push(`${tag}: script error: ${String(e.message).split("\n")[0]}`);
    await page.screenshot({ path: path.join(SHOT_DIR, `fail-${tag}.png`), fullPage: true }).catch(() => {});
  } finally {
    await context.close();
  }
}

/** Older backend (no pending_all) and a browser without the speech API (Firefox). */
async function runFallbacks(browser, width, lang) {
  const tag = `${width}-${lang}-fallback`;
  const L = T[lang];
  const state = newState(pktToday());
  state.noPendingAll = true;
  const { page, context, errors } = await newPage(browser, width, lang, state, {});
  await context.addInitScript(noSpeech);
  try {
    await page.goto(`${BASE}/dashboard/owner/today`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="ovw-kpis"]', { timeout: 20000 });
    await page.waitForSelector('[data-testid="ovw-row"]');
    ok(await page.locator('[data-testid="kpi-pending-unavailable"]').isVisible(), `${tag}: older backend -> "not available" instead of numbers`);
    ok((await page.locator('[data-testid="kpi-pending-n"]').count()) === 0, `${tag}: no invented any-date count`);
    ok((await page.locator('[data-testid="kpi-pending-link"]').getAttribute("href")) === "/dashboard/owner/approvals", `${tag}: card still opens Approvals`);
    const { cd } = await openNahi(page, "Imran Shah");
    ok((await cd.locator('[data-testid="voice-mic"]').count()) === 0, `${tag}: no mic without the speech API`);
    ok(L.unsupported.test(await cd.locator('[data-testid="voice-unsupported"]').innerText()), `${tag}: Chrome/Edge hint`);
    await noHScroll(page, `${tag} dialog`);
    await page.screenshot({ path: path.join(SHOT_DIR, `fallback-${tag}.png`) });
    ok(errors.length === 0, `${tag}: console errors: ${errors.slice(0, 3).join(" || ")}`);
  } catch (e) {
    failures.push(`${tag}: script error: ${String(e.message).split("\n")[0]}`);
    await page.screenshot({ path: path.join(SHOT_DIR, `fail-${tag}.png`), fullPage: true }).catch(() => {});
  } finally {
    await context.close();
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
  for (const lang of LANGS)
    for (const width of WIDTHS) {
      await runOne(browser, width, lang);
      await runFallbacks(browser, width, lang);
    }
  await browser.close();
  console.log(`${checks} checks, ${failures.length} failure(s). Screenshots: ${SHOT_DIR}`);
  for (const f of failures) console.log("FAIL " + f);
  process.exit(failures.length ? 1 : 0);
})();
