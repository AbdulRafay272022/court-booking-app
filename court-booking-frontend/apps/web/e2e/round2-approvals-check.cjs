#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Owner Round 2 (A1, A2, A3, A5, A10.3) check: Approvals list, cancelled cards, overpayment choice, screenshot lightbox,
 * popup-closes-before-navigating and the History highlight banner. The API is MOCKED with page.route (no backend needed).
 * Run against a PRODUCTION build served from a COPY of apps/web (never next dev):
 *   BASE_URL=http://localhost:3821 node e2e/round2-approvals-check.cjs
 * en + ru at 360 / 768 / 1280.
 * QA round 2 fixes: the header splits the badge number ("5 approvals baqi (2 cancel/expire hue ...)"), a staff member
 * without the approve permission sees "Aap ke paas is kaam ki ijazat nahi" (never "card is back / not your booking") and
 * the cards lose their action buttons, and the detail shows the channel ("Zariya (booking kahan se shuru hui)").
 */
const zlib = require("zlib");
const { loadPlaywright } = require("./smoke.cjs");

const BASE = (process.env.BASE_URL || "http://localhost:3821").replace(/\/+$/, "");
const SHOTS = process.env.SHOT_DIR || require("os").tmpdir();
const VENUE = { id: "v1", name: "Arena Khelo", status: "approved", sports: ["Futsal"], courts: [{ id: "c1", name: "Futsal 1", sport: "Futsal" }] };
const SHOT_URL = `${BASE}/__mock/shot.png`;

/** A 360x720 striped PNG (big enough to zoom and pan). */
function makePng(w, h) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      const band = Math.floor(y / 40) % 2;
      raw[o] = band ? 14 : 240;
      raw[o + 1] = band ? 124 : 240;
      raw[o + 2] = x < 20 ? 0 : band ? 116 : 230;
    }
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const PNG = makePng(360, 720);

const now = Date.now();
const isoIn = (h) => new Date(now + h * 3600e3).toISOString();
// Saturday 24 Oct 2026, 9:00 PM to 10:00 PM PKT
const SAT_START = "2026-10-24T16:00:00Z";
const SAT_END = "2026-10-24T17:00:00Z";

function item(id, name, over = {}) {
  return {
    payment_id: id,
    booking_id: `b0000000-0000-4000-8000-00000000000${id.slice(-1)}`,
    court_name: "Futsal 1",
    court_id: "c1",
    court_sport: "Futsal",
    starts_at: SAT_START,
    ends_at: SAT_END,
    player_name: name,
    player_phone: "+92300***4567",
    ocr_verdict: "match",
    ocr_amount: 2000,
    expected_amount: 2000,
    proof_url: SHOT_URL,
    submitted_at: isoIn(-0.1),
    minutes_since_submission: 6,
    checks: null,
    state: "awaiting",
    cancelled_at: null,
    has_screenshot: true,
    overpayment: null,
    ...over,
  };
}

function freshItems() {
  return [
    item("p1", "Ali Raza", { starts_at: isoIn(3), ends_at: isoIn(4), submitted_at: isoIn(-0.05) }),
    item("p2", "Bilal Shah", { ocr_verdict: "mismatch", ocr_amount: 10000, overpayment: { expected: 2000, ocr_amount: 10000, excess: 8000 }, proof_url: null, submitted_at: isoIn(-0.2) }),
    item("p3", "Chand Bibi", { state: "cancelled_by_player", cancelled_at: isoIn(-0.1), submitted_at: isoIn(-0.3) }),
    item("p4", "Danish Ali", { state: "expired", has_screenshot: false, proof_url: null, cancelled_at: isoIn(-0.2), submitted_at: isoIn(-0.4) }),
    item("p5", "Erum Naz", { ocr_amount: null, ocr_verdict: "unreadable", submitted_at: isoIn(-0.5) }),
    item("p6", "Faisal Khan", { submitted_at: isoIn(-0.6) }),
    item("p7", "Ghazala", { submitted_at: isoIn(-0.7) }),
  ];
}

const DETAIL_ROW = (b) => ({
  booking_id: b, short_code: "KH-B0000000", kind: "booked", status_key: "awaiting_approval", player_name: "Ali Raza", player_phone: null,
  court_id: "c1", court_name: "Futsal 1", starts_at: SAT_START, ends_at: SAT_END, duration_minutes: 60, slot_count: 2, total: 4000, advance: 2000,
  due: 4000, total_paid: 0, source: "app", checked_in: false, completion: null, slot_ended: false, original_booking_id: null, refund_amount: null, refund_status: null,
});

async function run() {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  const fails = [];
  const check = (ok, msg) => {
    if (!ok) fails.push(msg);
  };
  for (const lang of ["en", "ru"]) {
    for (const width of [360, 768, 1280]) {
      const tag = `${lang}@${width}`;
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, timezoneId: "Asia/Karachi", hasTouch: false });
      await ctx.addCookies([{ name: "khelo_lang", value: lang, url: BASE }]);
      await ctx.addInitScript(() => {
        if (!localStorage.getItem("maidan.session_token")) {
          localStorage.setItem("maidan.session_token", "t");
          localStorage.setItem("maidan.session_expires_at", new Date(Date.now() + 7 * 3600e3).toISOString());
        }
      });
      const page = await ctx.newPage();
      const errors = [];
      const calls = [];
      let server = freshItems();
      let badgeCalls = 0;
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      page.on("pageerror", (e) => errors.push(e.message));
      const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
      await page.route("**/__mock/shot.png*", (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
      await page.route("**/api/v1/auth/me", (r) => r.fulfill(json({ user: { id: "u1", role: "owner", name: "Owner", phone: "+923000000002" }, session: {} })));
      await page.route("**/api/v1/owners/venues", (r) => r.fulfill(json([VENUE])));
      await page.route("**/api/v1/owners/badges*", (r) => {
        badgeCalls++;
        r.fulfill(json({ approvals: server.length, refunds: 0 }));
      });
      await page.route("**/api/v1/owners/approvals-queue*", (r) => {
        const u = new URL(r.request().url());
        const pg = Number(u.searchParams.get("page") || 1);
        calls.push(`queue:${u.search}`);
        // the mock pages by 5 so "Aur dikhao" can be tested without 50 cards
        const items = server.slice((pg - 1) * 5, pg * 5);
        r.fulfill(json({ items, total: server.length, page: pg, page_size: 50 }));
      });
      await page.route("**/api/v1/payments/*/proof-url", (r) => r.fulfill(json({ url: SHOT_URL, expires_in: 300 })));
      await page.route("**/api/v1/payments/*/approve", (r) => {
        const id = r.request().url().split("/payments/")[1].split("/")[0];
        calls.push(`approve:${id}:${r.request().postData() || ""}`);
        if (id === "p5") {
          server = server.map((i) => (i.payment_id === "p5" ? { ...i, state: "cancelled_by_player", cancelled_at: isoIn(-0.01) } : i));
          return r.fulfill(json({ error: { code: "BOOKING_NO_LONGER_PENDING", message: "Booking is no longer pending", details: { state: "cancelled_by_player" } } }, 409));
        }
        server = server.filter((i) => i.payment_id !== id);
        r.fulfill(json({ id, status: "approved" }));
      });
      await page.route("**/api/v1/payments/*/reject", (r) => {
        const id = r.request().url().split("/payments/")[1].split("/")[0];
        calls.push(`reject:${id}:${r.request().postData() || ""}`);
        r.fulfill(json({ error: { code: "INTERNAL_ERROR", message: "boom" } }, 500));
      });
      await page.route("**/api/v1/owners/payments/*/acknowledge", (r) => {
        const id = r.request().url().split("/payments/")[1].split("/")[0];
        calls.push(`ack:${id}:${r.request().postData() || ""}`);
        server = server.filter((i) => i.payment_id !== id);
        r.fulfill(json({ ok: true, refund_dispute_id: null }));
      });
      await page.route("**/api/v1/owners/bookings/*/overview-detail", (r) => {
        const b = r.request().url().split("/bookings/")[1].split("/")[0];
        // the p6 booking is a walk-in a STAFF member added (A4 channel label)
        const walkin = b.endsWith("6") ? { source: "walkin" } : {};
        r.fulfill(json({ row: { ...DETAIL_ROW(b), ...walkin }, channel_detail: b.endsWith("6") ? "staff" : null, booked_at: isoIn(-1), hold_expires_at: null, advance_required: 2000, payment_id: "p1", ocr_verdict: "match", ocr_amount: 2000, approval: null, cancellation: null, refund: null, completion: null, timeline: [] }));
      });
      await page.route("**/api/v1/owners/bookings-history?*", (r) => {
        const rows = [DETAIL_ROW("b0000000-0000-4000-8000-000000000006"), { ...DETAIL_ROW("b0000000-0000-4000-8000-000000000009"), player_name: "Someone Else", short_code: "KH-B0000009" }];
        r.fulfill(json({ items: rows, total: 2, page: 1, page_size: 100, totals: { count: 2, total: 8000, collected: 0, due: 8000 } }));
      });

      const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      const order = () => page.$$eval("[data-card-id]", (els) => els.map((e) => e.getAttribute("data-card-id")));

      await page.goto(`${BASE}/dashboard/owner/approvals`, { waitUntil: "networkidle" });
      await page.waitForSelector("[data-card-id]");
      check((await page.locator("h1").count()) === 1, `${tag}: one h1`);
      check((await order()).join(",") === "p1,p2,p3,p4,p5", `${tag}: first page newest first, got ${(await order()).join(",")}`);
      const countText = await page.getByTestId("appr-count").innerText();
      // badge = 7 = 5 waiting for approval + 2 grey cards (p3 cancelled, p4 expired) that only need "Theek hai"
      check(/^5 /.test(countText), `${tag}: count shows 5 approvals (${countText})`);
      const closedText = await page.getByTestId("appr-count-closed").innerText();
      check(lang === "ru" ? /\(2 cancel\/expire hue, Theek hai dabayein\)/.test(closedText) : /\(2 cancelled\/expired, press OK\)/.test(closedText), `${tag}: grey count (${closedText})`);
      const whens = await page.$$eval("[data-testid=card-when]", (els) => els.map((e) => e.textContent));
      check(whens.length >= 3 && whens.every((w) => /\d:\d\d/.test(w)), `${tag}: every card has a time`);
      check(whens.some((w) => /24 Oct/.test(w)), `${tag}: a card shows the booking date "24 Oct" (${whens.join(" | ")})`);
      check(/^(Today|Tomorrow|Aaj|Kal)/.test(whens[0]), `${tag}: first card relative date (${whens[0]})`);
      check((await page.locator("[data-testid=amount-chip][data-kind=mismatch]").count()) === 1, `${tag}: mismatch chip`);
      check((await page.locator("[data-card-id=p3][data-state=cancelled_by_player] [data-testid=ack-yes]").count()) === 1, `${tag}: cancelled card has two buttons`);
      check((await page.locator("[data-card-id=p3] [data-testid=approve]").count()) === 0, `${tag}: cancelled card has no Approve`);
      check((await page.locator("[data-card-id=p4] [data-testid=ack-ok]").count()) === 1, `${tag}: expired card without screenshot has one Theek hai`);
      check((await overflow()) <= 1, `${tag}: no horizontal scroll`);
      await page.screenshot({ path: `${SHOTS}/r2-appr-${tag}.png`, fullPage: true });

      // "Aur dikhao" appends page 2 at the end
      await page.getByTestId("appr-more").click();
      await page.waitForSelector("[data-card-id=p7]");
      check((await order()).join(",") === "p1,p2,p3,p4,p5,p6,p7", `${tag}: page 2 appended (${(await order()).join(",")})`);

      // Approve p1: only that card leaves
      const y2 = await page.locator("[data-card-id=p2]").boundingBox();
      await page.locator("[data-card-id=p1] [data-testid=approve]").click();
      await page.getByTestId("approve-dialog").waitFor();
      await page.getByTestId("approve-confirm").click();
      await page.waitForFunction(() => !document.querySelector('[data-card-id="p1"]'));
      check((await order()).join(",") === "p2,p3,p4,p5,p6,p7", `${tag}: only p1 removed (${(await order()).join(",")})`);
      check(calls.some((c) => c.startsWith("approve:p1:")), `${tag}: approve p1 called`);
      check(y2 !== null, `${tag}: p2 measured`);

      // Overpayment choice (en: default advance_only, ru: full)
      await page.locator("[data-card-id=p2] [data-testid=approve]").click();
      await page.getByTestId("overpay").waitFor();
      const radios = page.locator("[data-testid=overpay] input[type=radio]");
      check((await radios.count()) === 2 && (await radios.first().isChecked()), `${tag}: two choices, first checked`);
      if (lang === "ru") await radios.nth(1).check();
      await page.getByTestId("approve-confirm").click();
      await page.waitForFunction(() => !document.querySelector('[data-card-id="p2"]'));
      const body = calls.find((c) => c.startsWith("approve:p2:")) || "";
      check(body.includes(`"accept_mode":"${lang === "ru" ? "full" : "advance_only"}"`) && body.includes('"amount_pkr":10000'), `${tag}: overpayment body ${body}`);

      // 409 on p5: the card turns grey in place, no error text
      await page.locator("[data-card-id=p5] [data-testid=approve]").click();
      await page.getByTestId("approve-confirm").click();
      await page.waitForSelector("[data-card-id=p5][data-state=cancelled_by_player]");
      check((await order()).indexOf("p5") === 2, `${tag}: p5 kept its place (${(await order()).join(",")})`);
      check((await page.locator("[data-card-id=p5] [data-testid=approve]").count()) === 0, `${tag}: p5 has no Approve after 409`);
      check(!(await page.getByTestId("appr-live").getAttribute("class")).includes("danger"), `${tag}: 409 shows no error`);

      // Reject p6 fails (500): card comes back with a message
      await page.locator("[data-card-id=p6] [data-testid=reject]").click();
      await page.getByTestId("reject-dialog").waitFor();
      await page.getByTestId("reject-dialog").locator("button[aria-pressed]").first().click();
      await page.getByTestId("reject-dialog").locator("textarea").fill("blur");
      await page.getByTestId("reject-confirm").click();
      await page.waitForFunction(() => /danger/.test(document.querySelector('[data-testid="appr-live"]')?.className || ""));
      check((await page.locator("[data-card-id=p6][data-state=awaiting]").count()) === 1, `${tag}: p6 restored after error`);
      check(calls.some((c) => c.startsWith("reject:p6:") && c.includes("blur")), `${tag}: reject reason sent`);

      // Acknowledge: cancelled with screenshot -> money came; expired -> OK
      const badgesBefore = badgeCalls;
      await page.locator("[data-card-id=p3] [data-testid=ack-yes]").click();
      await page.waitForFunction(() => !document.querySelector('[data-card-id="p3"]'));
      check(calls.some((c) => c === 'ack:p3:{"money_received":true}'), `${tag}: ack p3 money_received true`);
      await page.locator("[data-card-id=p4] [data-testid=ack-ok]").click();
      await page.waitForFunction(() => !document.querySelector('[data-card-id="p4"]'));
      check(calls.some((c) => c === 'ack:p4:{"money_received":false}'), `${tag}: ack p4 money_received false`);
      await page.waitForTimeout(400);
      check(badgeCalls > badgesBefore, `${tag}: badges refetched after acknowledge`);
      // p5 (closed after the 409) with a screenshot: "Paisa nahi aaya"
      await page.locator("[data-card-id=p5] [data-testid=ack-no]").click();
      await page.waitForFunction(() => !document.querySelector('[data-card-id="p5"]'));
      check(calls.some((c) => c === 'ack:p5:{"money_received":false}'), `${tag}: ack p5 money_received false`);

      // Lightbox on p6 (URL fetched through proof-url)
      const thumb = page.locator("[data-card-id=p6] [data-testid=shot-thumb]");
      await thumb.locator("img").waitFor();
      const th = await thumb.locator("img").boundingBox();
      check(th && th.height <= 161, `${tag}: thumbnail at most 160px high (${th && th.height})`);
      await thumb.click();
      await page.getByTestId("lb-img").waitFor();
      await page.waitForFunction(() => /100%/.test(document.querySelector('[data-testid="lb-zoom"]')?.textContent || ""));
      const stage = await page.getByTestId("lb-stage").boundingBox();
      const img0 = await page.getByTestId("lb-img").boundingBox();
      check(img0.width <= stage.width + 1 && img0.height <= stage.height + 1, `${tag}: opens fitted to the screen`);
      check(await page.getByTestId("lb-out").isDisabled(), `${tag}: "-" disabled at fit`);
      await page.getByTestId("lb-in").click();
      await page.getByTestId("lb-in").click();
      const zoomTxt = await page.getByTestId("lb-zoom").innerText();
      check(/225%/.test(zoomTxt), `${tag}: zoom in twice = 225% (${zoomTxt})`);
      // drag to pan
      const before = await page.getByTestId("lb-img").boundingBox();
      await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
      await page.mouse.down();
      await page.mouse.move(stage.x + stage.width / 2 + 60, stage.y + stage.height / 2 + 80, { steps: 5 });
      await page.mouse.up();
      const after = await page.getByTestId("lb-img").boundingBox();
      check(Math.abs(after.y - before.y) > 20 || Math.abs(after.x - before.x) > 20, `${tag}: drag pans the image`);
      check((await page.getByTestId("lightbox").count()) === 1, `${tag}: drag did not close`);
      await page.getByTestId("lb-out").click();
      await page.getByTestId("lb-out").click();
      check(/100%/.test(await page.getByTestId("lb-zoom").innerText()) && (await page.getByTestId("lb-out").isDisabled()), `${tag}: zoom out back to fit`);
      // wheel zoom, then Fit
      await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
      await page.mouse.wheel(0, -400);
      await page.waitForTimeout(200);
      check(!/^\D*100%/.test(await page.getByTestId("lb-zoom").innerText()), `${tag}: wheel zooms in`);
      await page.getByTestId("lb-fit").click();
      check(/100%/.test(await page.getByTestId("lb-zoom").innerText()), `${tag}: Fit button`);
      for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
      check(await page.evaluate(() => !!document.activeElement.closest('[role="dialog"]')), `${tag}: focus trapped in the lightbox`);
      check(await page.evaluate(() => document.body.style.overflow === "hidden"), `${tag}: body scroll locked`);
      await page.screenshot({ path: `${SHOTS}/r2-lightbox-${tag}.png` });
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.querySelector('[data-testid="lightbox"]'));
      check(await page.evaluate(() => document.activeElement?.getAttribute("data-testid") === "shot-thumb"), `${tag}: focus back on the thumbnail`);

      // Details -> "History mein dekhein": popup closes first, then History highlights without a popup
      await page.locator("[data-card-id=p6] [data-testid=row-details]").click();
      const dlg = page.getByRole("dialog");
      await dlg.getByTestId("detail-history").waitFor();
      const dlgText = await dlg.innerText();
      check(
        lang === "ru" ? /Zariya \(booking kahan se shuru hui\)/.test(dlgText) && /Staff ne add ki/.test(dlgText) : /Channel \(where the booking started\)/.test(dlgText) && /Added by staff/.test(dlgText),
        `${tag}: detail shows the channel heading and "staff added" value`,
      );
      await dlg.getByTestId("detail-history").click();
      await page.waitForURL(/\/dashboard\/bookings\?/);
      await page.getByTestId("focus-banner").waitFor();
      await page.waitForTimeout(300);
      check((await page.getByRole("dialog").count()) === 0, `${tag}: no popup on History after navigating`);
      check(await page.evaluate(() => document.body.style.overflow !== "hidden"), `${tag}: scroll lock released`);
      check((await page.locator("text=Someone Else").count()) === 0, `${tag}: History shows only the linked booking`);
      check((await page.locator("[data-booking-id][class*=outline-owner-accent]").count()) > 0, `${tag}: row highlighted`);
      check((await page.locator("h1").count()) === 1, `${tag}: History one h1`);
      check((await overflow()) <= 1, `${tag}: History no horizontal scroll`);
      await page.screenshot({ path: `${SHOTS}/r2-hist-${tag}.png`, fullPage: true });
      // row click opens the popup without touching the URL; "Filter hatayen" clears the booking
      await page.getByRole("button", { name: "Ali Raza" }).first().click();
      await page.getByRole("dialog").waitFor();
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
      check(/booking=/.test(page.url()), `${tag}: closing the popup keeps the highlight link`);
      await page.getByTestId("focus-clear").click();
      await page.waitForFunction(() => !location.search.includes("booking="));
      await page.waitForSelector("text=Someone Else");

      const realErrors = errors.filter((e) => !/ERR_CONNECTION_REFUSED|Failed to load resource/.test(e));
      check(realErrors.length === 0, `${tag}: console errors: ${realErrors.slice(0, 3).join(" | ")}`);

      // Staff without approve permission: 403 NOT_STAFF_PERMITTED -> a clear "no permission" line, buttons replaced
      server = freshItems();
      await page.unroute("**/api/v1/payments/*/approve");
      await page.unroute("**/api/v1/owners/payments/*/acknowledge");
      const denied = (r) => r.fulfill(json({ error: { code: "NOT_STAFF_PERMITTED", message: "Your account isn't allowed to do this.", details: { permission: "approve_payments" } } }, 403));
      await page.route("**/api/v1/payments/*/approve", denied);
      await page.route("**/api/v1/owners/payments/*/acknowledge", denied);
      await page.goto(`${BASE}/dashboard/owner/approvals`, { waitUntil: "networkidle" });
      await page.waitForSelector("[data-card-id=p1] [data-testid=approve]");
      await page.locator("[data-card-id=p1] [data-testid=approve]").click();
      await page.getByTestId("approve-confirm").click();
      await page.waitForFunction(() => /danger/.test(document.querySelector('[data-testid="appr-live"]')?.className || ""));
      const live = await page.getByTestId("appr-live").innerText();
      check(lang === "ru" ? /Aap ke paas is kaam ki ijazat nahi/.test(live) : /don't have permission/.test(live), `${tag}: no-permission text (${live})`);
      check(!/card|wapas aa gaya|not your booking|aapki booking nahi/i.test(live), `${tag}: no "card is back / not your booking" (${live})`);
      check((await page.locator("[data-card-id=p1][data-state=awaiting]").count()) === 1, `${tag}: refused card stays`);
      check((await page.locator("[data-testid=approve], [data-testid=reject], [data-testid=ack-ok], [data-testid=ack-yes]").count()) === 0, `${tag}: action buttons hidden after the refusal`);
      check((await page.locator("[data-testid=appr-no-permission]").count()) >= 5, `${tag}: every card shows the no-permission note`);
      check((await overflow()) <= 1, `${tag}: no-permission state has no horizontal scroll`);
      await page.screenshot({ path: `${SHOTS}/r2-appr-noperm-${tag}.png`, fullPage: true });
      await ctx.close();
      console.log(`${tag} done`);
    }
  }
  await browser.close();
  if (fails.length) {
    console.log("FAIL\n  " + fails.join("\n  "));
    process.exit(1);
  }
  console.log("PASS");
}
run().catch((e) => {
  console.error(e);
  process.exit(2);
});
