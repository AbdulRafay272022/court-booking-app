// Expo-web e2e for the owner follow-ups: Approvals/Refunds Details + History links, and the bell unread badge.
// Run: PLAYWRIGHT_PATH=<...>/node_modules/playwright node e2e/followups-check.cjs   (Expo web on :8083 or BASE, with a DEAD api url)
// All /api/v1/** traffic is mocked via page.route; nothing reaches a real backend.
const { chromium } = require(process.env.PLAYWRIGHT_PATH);
const BASE = process.env.BASE || "http://localhost:8083";

const now = Date.now();
const iso = (h) => new Date(now + h * 3600e3).toISOString();
const minAgo = (m) => new Date(now - m * 60e3).toISOString();
const pktDay = (d) => new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
const user = { id: "u1", role: "owner", name: "Owner One", phone: "+923001234567", email: null };
const venue = { id: "v1", name: "Arena Khelo", status: "approved", courts: [{ id: "c1", venue_id: "v1", name: "Court 1", sport: "padel", is_active: true }] };
const SLOT_START = iso(26); // a later day, so the History date differs from today
const SLOT_DAY = pktDay(SLOT_START);

const histRow = {
  booking_id: "b-77", short_code: "KH-0000004D", kind: "booked", status_key: "booked", player_name: "Usman Tariq", player_phone: "0300 1234567",
  court_id: "c1", court_name: "Court 1", starts_at: SLOT_START, ends_at: iso(27), duration_minutes: 60, slot_count: 2, total: 3000, advance: 1500, due: 1500, total_paid: 1500,
  source: "app", checked_in: false, completion: null, slot_ended: false, original_booking_id: null, refund_amount: null, refund_status: null,
};
const detail = () => ({ row: histRow, booked_at: iso(-30), hold_expires_at: null, advance_required: 1500, payment_id: "pay1", ocr_verdict: null, ocr_amount: null,
  approval: null, cancellation: null, refund: null, completion: null, timeline: [{ at: iso(-30), kind: "held" }] });
const approval = { payment_id: "pay1", booking_id: "b-77", court_name: "Court 1", court_id: "c1", starts_at: SLOT_START, ends_at: iso(27), player_name: "Usman Tariq", player_phone: "0300 1234567",
  ocr_verdict: null, ocr_amount: null, expected_amount: 1500, minutes_since_submission: 4, proof_url: null };
const refund = { id: "r1", booking_id: "b-77", court_name: "Court 1", court_id: "c1", venue_name: "Arena Khelo", player_name: "Usman Tariq", player_phone: "0300 1234567", starts_at: SLOT_START,
  reason: "cancelled", refund_amount: 1500, refund_status: "owed", refunded_amount: null, remaining_amount: 1500, is_overdue: false, created_at: iso(-5) };

const results = [];
const log = [];
function check(name, ok, extra) { results.push({ name, ok: !!ok }); console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  " + extra : "")); }

const entry = (id, type, at, ref) => ({ id, channel: "push", event_type: type, status: "sent", reference_id: ref, created_at: at });

async function setup(browser, state) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "Asia/Karachi" });
  await ctx.addInitScript((u) => {
    if (!localStorage.getItem("maidan.session_token")) {
      localStorage.setItem("maidan.session_token", "tok");
      localStorage.setItem("maidan.session_expires_at", new Date(Date.now() + 7 * 3600e3).toISOString());
      localStorage.setItem("maidan.cached_user", JSON.stringify(u));
    }
  }, user);
  const reqs = [];
  await ctx.route("**/health", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await ctx.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname.replace(/^.*\/api\/v1/, "");
    reqs.push({ method: req.method(), p, q: url.search });
    const json = (data, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    if (p === "/auth/me") return json({ user, session: { device_id: "d", device_name: null, platform: "web", last_active_at: iso(0), expires_at: iso(7) } });
    if (p === "/auth/refresh") return json({ token: "tok", expires_at: iso(8) });
    if (p === "/owners/venues") return json([venue]);
    if (p === "/owners/overview") {
      return json({ date: SLOT_DAY, venue_id: "v1", operating_day: null,
        slots: { total: 10, booked: 1, pending: 0, blocked: 0, free: 9, free_upcoming: 9, free_past: 0, by_court: [] },
        bookings: { count: 1, cancelled: 0, refunds: { count: 0, amount: 0 }, pending: { count: 0, awaiting_approval: 0, awaiting_payment: 0 }, by_court: [] },
        money: { collected: 1500, due: 1500, due_bookings: 1 }, rows: [histRow] });
    }
    if (p === "/owners/badges") return json({ approvals: 1, refunds: 1 });
    if (p === "/owners/pending-approvals") return json([approval]);
    if (p === "/owners/approvals-queue") return json({ items: [{ ...approval, submitted_at: iso(-0.1), checks: null, state: "awaiting", cancelled_at: null, has_screenshot: false, overpayment: null }], total: 1, page: 1, page_size: 50 });
    if (p === "/owners/refunds") return json([refund]);
    if (p === "/owners/bookings-history") return json({ items: [histRow], total: 1, page: 1, page_size: 20, totals: { count: 1, total: 3000, collected: 1500, due: 1500 } });
    if (/^\/owners\/bookings\/.+\/overview-detail$/.test(p)) return json(detail());
    if (p === "/users/me/notifications") return json(state.notifications());
    if (p.startsWith("/owners/") || p.startsWith("/users/")) return json([]);
    return json({});
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => log.push("pageerror: " + e.message));
  return { ctx, page, reqs };
}

const badgeText = async (page) => {
  const b = page.getByTestId("bell-badge");
  return (await b.count()) ? (await b.first().innerText()).trim() : null;
};
async function waitBadge(page, want, timeout = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if ((await badgeText(page)) === want) return true;
    await page.waitForTimeout(300);
  }
  return false;
}

(async () => {
  const browser = await chromium.launch();

  // ---- (a) Approvals ----
  {
    const { ctx, page, reqs } = await setup(browser, { notifications: () => [] });
    await page.goto(BASE + "/approvals", { waitUntil: "domcontentloaded", timeout: 240000 });
    await page.getByText("Payment review").first().waitFor({ timeout: 180000 });
    await page.getByRole("button", { name: "Details" }).waitFor({ timeout: 30000 });
    check("approvals: Details + History link shown", (await page.getByRole("link", { name: "History mein dekhein" }).count()) === 1);
    check("approvals: approve/reject still there", (await page.getByText("Approve", { exact: true }).count()) === 1 && (await page.getByText("Reject", { exact: true }).count()) === 1);
    await page.getByRole("button", { name: "Details" }).click();
    await page.getByText("KH-0000004D").first().waitFor({ timeout: 15000 });
    check("approvals: Details opens the booking sheet", reqs.some((r) => /bookings\/b-77\/overview-detail/.test(r.p)));
    await page.getByText("Band karein").first().click();
    await page.waitForTimeout(500);
    await page.getByRole("link", { name: "History mein dekhein" }).click();
    await page.waitForURL(/history/, { timeout: 15000 });
    await page.getByTestId("history-highlighted").first().waitFor({ timeout: 15000 });
    const h = reqs.filter((r) => r.p === "/owners/bookings-history").pop();
    check("approvals: History opens with the booking's date range", h && h.q.includes("from=" + SLOT_DAY) && h.q.includes("to=" + SLOT_DAY), h && h.q);
    check("approvals: booking highlighted on History (no popup)", /b-77/.test(page.url()) && (await page.getByText("Sirf ye booking dikhayi ja rahi hai").count()) >= 1 && (await page.getByText("Band karein").count()) === 0);
    await ctx.close();
  }

  // ---- (b) Refunds ----
  {
    const { ctx, page, reqs } = await setup(browser, { notifications: () => [] });
    await page.goto(BASE + "/refunds", { waitUntil: "domcontentloaded", timeout: 240000 });
    await page.getByText("Refunds dene hain").first().waitFor({ timeout: 120000 });
    await page.getByRole("button", { name: "Details" }).waitFor({ timeout: 30000 });
    await page.getByRole("button", { name: "Details" }).click();
    await page.getByText("KH-0000004D").first().waitFor({ timeout: 15000 });
    check("refunds: Details opens the booking sheet", reqs.some((r) => /bookings\/b-77\/overview-detail/.test(r.p)));
    await page.getByText("Band karein").first().click();
    await page.waitForTimeout(500);
    await page.getByText("Usman Tariq").first().click();
    check("refunds: tapping the card still opens the refund form", (await page.getByText("Refund record karein").count()) === 1);
    await page.getByText("Cancel", { exact: true }).first().click();
    await page.getByRole("link", { name: "History mein dekhein" }).click();
    await page.waitForURL(/history/, { timeout: 15000 });
    await page.getByTestId("history-highlighted").first().waitFor({ timeout: 15000 });
    const h = reqs.filter((r) => r.p === "/owners/bookings-history").pop();
    check("refunds: History opens with the booking's date range", h && h.q.includes("from=" + SLOT_DAY) && h.q.includes("to=" + SLOT_DAY), h && h.q);
    check("refunds: booking highlighted on History (no popup)", /b-77/.test(page.url()) && (await page.getByText("Sirf ye booking dikhayi ja rahi hai").count()) >= 1 && (await page.getByText("Band karein").count()) === 0);
    await ctx.close();
  }

  // ---- (c) Bell badge ----
  {
    let list = [
      entry("n1", "booking_confirmed", minAgo(10), "b1"),
      { ...entry("n1b", "booking_confirmed", minAgo(9), "b1"), channel: "whatsapp" }, // folds into n1
      entry("n2", "payment_submitted", minAgo(120), "b2"),
      entry("n3", "refund_owed", minAgo(300), "b3"),
      entry("n4", "booking_confirmed", minAgo(30 * 60), "b4"), // older than 24 h: not unread on first visit
    ];
    const { ctx, page } = await setup(browser, { notifications: () => list });
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 240000 });
    await page.getByTestId("today-hero").first().waitFor({ timeout: 180000 });
    check("bell: badge shows 3 (duplicate folded, >24h row ignored)", await waitBadge(page, "3", 30000), "got " + (await badgeText(page)));

    list = [entry("n5", "payment_submitted", new Date().toISOString(), "b5"), ...list];
    check("bell: second poll raises it to 4", await waitBadge(page, "4", 30000), "got " + (await badgeText(page)));

    await page.getByLabel("Notifications").first().click();
    await page.getByText("Notifications", { exact: true }).first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);
    await page.goBack();
    await page.getByTestId("today-hero").first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(800);
    check("bell: badge clears after opening notifications", (await badgeText(page)) === null, "got " + (await badgeText(page)));
    const stored = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("khelo.notif.readAt.")));
    check("bell: read marker kept per user locally", stored.length === 1 && stored[0].endsWith(".u1"), stored.join(","));

    // a new event after the marker brings it back on the next poll
    list = [entry("n6", "refund_owed", new Date(Date.now() + 60e3).toISOString(), "b6"), ...list];
    check("bell: new event after reading shows 1", await waitBadge(page, "1", 30000), "got " + (await badgeText(page)));
    await ctx.close();
  }
  {
    const many = Array.from({ length: 130 }, (_, i) => entry("m" + i, "booking_confirmed", minAgo(1 + i * 6), "ref" + i));
    const { ctx, page } = await setup(browser, { notifications: () => many });
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 240000 });
    await page.getByTestId("today-hero").first().waitFor({ timeout: 180000 });
    check("bell: caps at 99+", await waitBadge(page, "99+", 30000), "got " + (await badgeText(page)));
    await ctx.close();
  }

  check("no page errors", log.length === 0, log.slice(0, 3).join(" | "));
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
