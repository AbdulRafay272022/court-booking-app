// Expo-web e2e for Owner Round 2, mobile part M1: Approvals list (A1/A5), screenshot viewer (A3), close-then-navigate +
// History highlight (A2), Overview cards (A7), completion "Nahi" (A8) and the refund sheet (A10).
// Run: PLAYWRIGHT_PATH=<...>/node_modules/playwright BASE=http://localhost:8084 node e2e/round2-m1-check.cjs
// Expo web must be started with a DEAD api url (EXPO_PUBLIC_API_BASE_URL=http://localhost:9); every /api/v1/** call is
// mocked with page.route, nothing reaches a real backend.
// QA round 2 fixes: the header splits the badge ("3 approvals baqi" + "(2 cancel/expire hue, Theek hai dabayein)"), the
// detail sheet shows "Zariya (booking kahan se shuru hui)" with "App ya website", and a staff member without permission
// gets "Aap ke paas is kaam ki ijazat nahi" (Approvals: buttons replaced; Refunds: one clear state, no "nothing owed").
const { chromium } = require(process.env.PLAYWRIGHT_PATH);
const BASE = process.env.BASE || "http://localhost:8084";

const H = 3600e3;
const pktToday = new Date(Date.now() + 5 * H).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(new Date(d + "T00:00:00Z").getTime() + n * 86400e3).toISOString().slice(0, 10);
const at = (day, hh) => `${day}T${String(hh).padStart(2, "0")}:00:00+05:00`;
const iso = (h) => new Date(Date.now() + h * H).toISOString();
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LATER = addDays(pktToday, 5);
const laterLabel = (() => {
  const d = new Date(LATER + "T00:00:00Z");
  return `${WD[d.getUTCDay()]}, ${d.getUTCDate()} ${MO[d.getUTCMonth()]}`;
})();
// A small valid PNG (40x60) for the screenshot.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAACgAAAA8CAIAAACb22+3AAAAOElEQVR4nO3NQQkAAAgEsAtmMCMayxgiDPZfputExGKxWCwWi8VisVgsFovFYrFYLBaLxWLxp3gB8KnrRHLLp+oAAAAASUVORK5CYII=", "base64");

const user = { id: "u1", role: "owner", name: "Owner One", phone: "+923001234567", email: null };
const courts = [
  { id: "c1", venue_id: "v1", name: "Court 1", sport: "padel", is_active: true },
  { id: "c2", venue_id: "v1", name: "Court 2", sport: "padel", is_active: true },
  { id: "c3", venue_id: "v1", name: "Court 3", sport: "futsal", is_active: true },
];
const venue = { id: "v1", name: "Arena Khelo", status: "approved", courts };

const base = (id, name, startsAt, endsAt, extra = {}) => ({
  payment_id: id, booking_id: "b-" + id, court_name: "Court 1", court_id: "c1", court_sport: "padel", starts_at: startsAt, ends_at: endsAt,
  player_name: name, player_phone: "0300 1234567", ocr_verdict: "match", ocr_amount: 2000, expected_amount: 2000, proof_url: null,
  submitted_at: iso(-0.2), minutes_since_submission: 12, checks: null, account_name: null,
  state: "awaiting", cancelled_at: null, has_screenshot: false, overpayment: null, ...extra,
});
function queueItems() {
  return [
    base("pA", "Ali Raza", at(pktToday, 21), at(pktToday, 22), { has_screenshot: true, proof_url: "https://proof.test/expired.png", submitted_at: iso(-0.05) }),
    base("pB", "Bilal Khan", at(addDays(pktToday, 1), 21), at(addDays(pktToday, 1), 22), {
      ocr_verdict: "mismatch", ocr_amount: 10000, has_screenshot: true, proof_url: "https://proof.test/good.png",
      overpayment: { expected: 2000, ocr_amount: 10000, excess: 8000 }, submitted_at: iso(-0.1),
    }),
    base("pC", "Chaudhry Asif", at(LATER, 18), at(LATER, 19), { state: "cancelled_by_player", has_screenshot: true, proof_url: "https://proof.test/good.png", cancelled_at: iso(-0.1), submitted_at: iso(-0.3) }),
    base("pD", "Danish Ali", at(LATER, 20), at(LATER, 21), { state: "expired", ocr_verdict: null, ocr_amount: null, submitted_at: iso(-0.4) }),
    base("pE", "Ehsan Ullah", at(LATER, 22), at(LATER, 23), { submitted_at: iso(-0.5) }),
  ];
}

const row = (id, extra = {}) => ({
  booking_id: id, short_code: "KH-" + id.toUpperCase().padEnd(8, "0").slice(0, 8), kind: "booked", status_key: "booked", player_name: "Usman Tariq", player_phone: "0300 1234567",
  court_id: "c1", court_name: "Court 1", starts_at: at(pktToday, 8), ends_at: at(pktToday, 9), duration_minutes: 60, slot_count: 2, total: 4500, advance: 2000, due: 2500, total_paid: 2000,
  source: "app", checked_in: false, completion: null, slot_ended: true, original_booking_id: null, refund_amount: null, refund_status: null, ...extra,
});

const results = [];
const shot = async (page, name) => {
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${name}.png`, fullPage: false });
};
const pageErrors = [];
function check(name, ok, extra) {
  results.push({ name, ok: !!ok });
  console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  " + extra : ""));
}

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
  await ctx.route("https://proof.test/**", (r) =>
    r.request().url().includes("expired") ? r.fulfill({ status: 403, body: "expired" }) : r.fulfill({ status: 200, contentType: "image/png", body: PNG }),
  );
  await ctx.route("**/health", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await ctx.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname.replace(/^.*\/api\/v1/, "");
    const entry = { method: req.method(), p, q: url.search, body: req.postData() || "" };
    reqs.push(entry);
    const json = (data, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    if (p === "/auth/me") return json({ user, session: { device_id: "d", device_name: null, platform: "web", last_active_at: iso(0), expires_at: iso(7) } });
    if (p === "/auth/refresh") return json({ token: "tok", expires_at: iso(8) });
    if (p === "/owners/venues") return json([venue]);
    if (p === "/owners/badges") return json({ approvals: 3, refunds: 1 });
    if (p === "/owners/approvals-queue") return json(state.queue(url));
    if (/^\/payments\/[^/]+\/proof-url$/.test(p)) return json({ url: "https://proof.test/good.png?fresh=1", expires_in: 300 });
    let m;
    const denied = () => json({ error: { code: "NOT_STAFF_PERMITTED", message: "Your account isn't allowed to do this." } }, 403);
    if (state.denyApprove && (/^\/payments\/[^/]+\/(approve|reject)$/.test(p) || /^\/owners\/payments\/[^/]+\/acknowledge$/.test(p))) return denied();
    if (state.denyRefunds && p === "/owners/refunds") return denied();
    if ((m = /^\/payments\/([^/]+)\/(approve|reject)$/.exec(p))) {
      if (m[1] === "pE") return json({ error: { code: "BOOKING_NO_LONGER_PENDING", message: "no longer pending", details: { state: "cancelled_by_player" } } }, 409);
      state.done.add(m[1]);
      return json({ payment: { id: m[1] }, booking: { id: "b" } });
    }
    if ((m = /^\/owners\/payments\/([^/]+)\/acknowledge$/.exec(p))) {
      state.done.add(m[1]);
      return json({ ok: true, refund_dispute_id: JSON.parse(entry.body || "{}").money_received ? "d1" : null });
    }
    if (p === "/owners/overview") return json(state.overview());
    if (p === "/owners/bookings-history") return json(state.history(url));
    if ((m = /^\/owners\/bookings\/([^/]+)\/overview-detail$/.exec(p))) return json(state.detail(m[1]));
    if ((m = /^\/owners\/bookings\/([^/]+)\/completion$/.exec(p))) return json(row(m[1], { completion: { result: "no", received_pkr: 3000, reason: "x", marked_at: iso(0), marked_by_name: "Owner" } }));
    if (/^\/courts\/[^/]+\/availability$/.test(p)) {
      const d = url.searchParams.get("date");
      const s = (hh, status) => ({ starts_at: at(d, hh), ends_at: at(d, hh + 1), status, price: 2000, advance_amount: 1000, held_until: null, booking_id: null, is_mine: false, reason: null, after_midnight: false });
      return json({ court_id: "c", date: d, slot_minutes: 60, slots: [s(22, "available"), s(23, "booked")] });
    }
    if (p === "/owners/refunds") return json(state.refunds());
    if ((m = /^\/owners\/refunds\/([^/]+)\/mark-refunded$/.exec(p))) {
      await new Promise((r) => setTimeout(r, 900));
      const r0 = state.refunds().find((r) => r.id === m[1]);
      return json({ ...r0, already_refunded: (r0.already_refunded || 0) + 1500, refunded_amount: (r0.refunded_amount || 0) + 1500, remaining_amount: 0, refund_status: "refunded" });
    }
    if (p.startsWith("/owners/") || p.startsWith("/users/")) return json([]);
    return json({});
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push("pageerror: " + e.message));
  return { ctx, page, reqs };
}

const vis = async (loc) => {
  const n = await loc.count();
  for (let i = 0; i < n; i++) if (await loc.nth(i).isVisible()) return loc.nth(i);
  return null;
};
async function waitFor(fn, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}
const card = (page, name) => page.locator('[data-testid="approval-card"], [data-testid="approval-card-grey"]').filter({ hasText: name });

function defaultState() {
  const state = { done: new Set(), extra: [] };
  state.queue = (url) => {
    const items = [...state.extra, ...queueItems()].filter((it) => !state.done.has(it.payment_id));
    return { items, total: items.length, page: Number(url.searchParams.get("page") || 1), page_size: 50 };
  };
  state.history = () => {
    const items = [row("b-pF", { player_name: "Faisal New", starts_at: at(pktToday, 21), ends_at: at(pktToday, 22), slot_ended: false }), row("b-other", { player_name: "Zain Other" })];
    return { items, total: 2, page: 1, page_size: 20, totals: { count: 2, total: 9000, collected: 4000, due: 5000 } };
  };
  state.detail = (id) => ({
    row: row(id, { player_name: "Ali Raza", starts_at: at(pktToday, 21), ends_at: at(pktToday, 22) }), booked_at: iso(-3), hold_expires_at: null, advance_required: 2000,
    payment_id: "pA", ocr_verdict: "match", ocr_amount: 2000, approval: null, cancellation: null, refund: null, completion: null,
    timeline: [{ at: iso(-3), kind: "held" }, { at: iso(-1), kind: "balance_received", amount: 1000, actor_name: "Owner One" }],
  });
  state.overview = () => ({
    date: pktToday, venue_id: "v1", operating_day: null,
    slots: { total: 30, booked: 8, pending: 2, blocked: 1, free: 19, free_upcoming: 12, free_past: 7,
      by_court: [
        { court_id: "c1", court_name: "Court 1", total: 10, booked: 5, pending: 1, blocked: 0, free: 4 },
        { court_id: "c2", court_name: "Court 2", total: 10, booked: 2, pending: 1, blocked: 1, free: 6 },
        { court_id: "c3", court_name: "Court 3", total: 10, booked: 1, pending: 0, blocked: 0, free: 9 },
      ] },
    bookings: { count: 6, cancelled: 1, refunds: { count: 1, amount: 1500 }, pending: { count: 2, awaiting_approval: 1, awaiting_payment: 1 }, by_court: [] },
    money: { collected: 12000, due: 2500, due_bookings: 1 },
    pending_all: { count: 5, awaiting_approval: 2, awaiting_payment: 3 },
    rows: [row("bk1")],
  });
  state.refunds = () => [
    { id: "r1", booking_id: "b-r1", court_name: "Court 1", court_id: "c1", court_sport: "padel", venue_name: "Arena Khelo", player_name: "Mujtaba Anwer", player_phone: "0300 1111111",
      starts_at: at(pktToday, 18), reason: "player_cancelled_paid_booking", refund_amount: 2000, refund_status: "owed", refunded_amount: 500, remaining_amount: 1500,
      player_sent: 10000, refund_due: 2000, already_refunded: 500, reason_label_key: "player_cancelled", refund_reference: null, refunded_at: null, created_at: iso(-5), is_overdue: false, duplicate_proof: { used_on_bookings: 2 } },
    { id: "r2", booking_id: "b-r2", court_name: "Court 2", court_id: "c2", court_sport: "padel", venue_name: "Arena Khelo", player_name: "Abbas Zafar", player_phone: "0300 2222222",
      starts_at: at(pktToday, 19), reason: "payment_review_expired", refund_amount: 0, refund_status: "owed", refunded_amount: 0, remaining_amount: 0,
      player_sent: 2000, refund_due: 0, already_refunded: 0, reason_label_key: "review_expired", refund_reference: null, refunded_at: null, created_at: iso(-5), is_overdue: false },
  ];
  return state;
}

(async () => {
  const browser = await chromium.launch();

  // ---------------- A1 / A3 / A5 Approvals ----------------
  {
    const state = defaultState();
    const { ctx, page, reqs } = await setup(browser, state);
    await page.goto(BASE + "/approvals", { waitUntil: "domcontentloaded", timeout: 240000 });
    await page.getByTestId("approvals-count").first().waitFor({ timeout: 180000 });
    await waitFor(async () => (await page.locator('[data-testid="approval-card"]').count()) > 0);
    await page.waitForTimeout(800);
    await shot(page, "01-approvals");
    // badge 5 = 3 waiting for approval + 2 grey cards (cancelled / expired) that only need "Theek hai"
    check("A1 header shows N approvals baqi", (await page.getByTestId("approvals-count").first().innerText()).trim() === "3 approvals baqi", await page.getByTestId("approvals-count").first().innerText());
    check("QA header names the grey cards", (await page.getByTestId("approvals-count-closed").first().innerText()).trim() === "(2 cancel/expire hue, Theek hai dabayein)", await page.getByTestId("approvals-count-closed").first().innerText());
    const names = await page.locator('[data-testid="approval-card"], [data-testid="approval-card-grey"]').evaluateAll((els) => els.map((e) => e.innerText.split("\n").find((l) => /[A-Z][a-z]+ [A-Z]/.test(l))));
    check("A1 all cards, newest first", JSON.stringify(names) === JSON.stringify(["Ali Raza", "Bilal Khan", "Chaudhry Asif", "Danish Ali", "Ehsan Ullah"]), JSON.stringify(names));
    const whenA = await card(page, "Ali Raza").getByTestId("approval-when").innerText();
    const whenB = await card(page, "Bilal Khan").getByTestId("approval-when").innerText();
    const whenE = await card(page, "Ehsan Ullah").getByTestId("approval-when").innerText();
    check("A1 card shows Aaj + time range", /^Aaj, 9:00 PM to 10:00 PM$/.test(whenA), whenA);
    check("A1 card shows Kal", /^Kal, 9:00 PM/.test(whenB), whenB);
    check("A1 card shows weekday date", whenE.startsWith(laterLabel), whenE + " vs " + laterLabel);
    check("A1 card shows sport + court", (await card(page, "Ali Raza").innerText()).includes("Court 1") && (await card(page, "Ali Raza").innerText()).includes("padel"));
    const chipA = await card(page, "Ali Raza").getByTestId("amount-chip").innerText();
    const chipB = await card(page, "Bilal Khan").getByTestId("amount-chip").innerText();
    check("A1 expected vs OCR chip (text, not colour only)", /Chahiye\s*PKR 2,000[\s\S]*Screenshot mein · Match\s*PKR 2,000 ✓/.test(chipA) && /Screenshot mein · Farq hai\s*PKR 10,000/.test(chipB), chipA + " | " + chipB);
    check("A1 each card has Details, History link, Approve, Reject", (await card(page, "Ali Raza").getByRole("button", { name: "Details" }).count()) === 1 && (await card(page, "Ali Raza").getByRole("link", { name: "History mein dekhein" }).count()) === 1 && (await card(page, "Ali Raza").getByRole("button", { name: "Approve" }).count()) === 1 && (await card(page, "Ali Raza").getByRole("button", { name: "Reject" }).count()) === 1);

    // A3 thumbnail + viewer, with an expired first URL (refetched once).
    const thumb = card(page, "Ali Raza").getByTestId("screenshot-thumb");
    check("A3 thumbnail in approval card with caption", (await thumb.count()) === 1 && (await card(page, "Ali Raza").getByText("Bara karke dekhein").count()) === 1);
    const tb = await thumb.boundingBox();
    check("A3 thumbnail max ~160px high", tb && tb.height <= 162, tb && String(tb.height));
    await waitFor(async () => reqs.some((r) => r.p === "/payments/pA/proof-url"), 10000);
    check("A3 expired signed URL is refetched once", reqs.filter((r) => r.p === "/payments/pA/proof-url").length === 1);
    await thumb.click();
    await page.getByTestId("viewer-zoom-level").first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(500);
    await shot(page, "02-viewer");
    const lvl = async () => (await page.getByTestId("viewer-zoom-level").first().innerText()).trim();
    check("A3 viewer opens fit-to-screen (100%)", (await lvl()) === "100%", await lvl());
    check("A3 '-' disabled at fit", (await page.getByTestId("viewer-zoom-out").first().getAttribute("aria-disabled")) === "true");
    await page.getByTestId("viewer-zoom-in").first().click();
    await page.getByTestId("viewer-zoom-in").first().click();
    const z2 = await lvl();
    await page.getByTestId("viewer-zoom-out").first().click();
    const z3 = await lvl();
    check("A3 '+' zooms in and '-' zooms back out", z2 === "225%" && z3 === "150%", z2 + " / " + z3);
    for (let i = 0; i < 6; i++) await page.getByTestId("viewer-zoom-in").first().click({ force: true });
    check("A3 max zoom 4x", (await lvl()) === "400%", await lvl());
    await page.getByTestId("viewer-fit").first().click();
    check("A3 Fit returns to 100%", (await lvl()) === "100%");
    const stage = await page.getByTestId("viewer-stage").first().boundingBox();
    await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(200);
    check("A3 wheel zoom on web", parseInt(await lvl(), 10) > 100, await lvl());
    // drag-to-pan when zoomed
    const before = await page.getByTestId("viewer-stage").first().evaluate((e) => getComputedStyle(e).transform);
    await page.mouse.down();
    await page.mouse.move(stage.x + stage.width / 2 + 60, stage.y + stage.height / 2 + 40, { steps: 6 });
    await page.mouse.up();
    const after = await page.getByTestId("viewer-stage").first().evaluate((e) => getComputedStyle(e).transform);
    check("A3 drag pans when zoomed", before !== after, before + " -> " + after);
    const imgSrc = await page.getByTestId("viewer-stage").first().locator("img").first().getAttribute("src").catch(() => null);
    check("A3 viewer shows the refreshed URL", !!imgSrc && imgSrc.includes("fresh=1"), String(imgSrc));
    await page.getByTestId("viewer-close").first().click();
    await page.waitForTimeout(400);
    check("A3 close button closes the viewer", (await page.getByTestId("viewer-zoom-level").count()) === 0);

    // Approve A: only that card leaves.
    await card(page, "Ali Raza").getByRole("button", { name: "Approve" }).click();
    await (await vis(page.getByRole("button", { name: "Approve karein" }))).click();
    await waitFor(async () => (await card(page, "Ali Raza").count()) === 0, 8000);
    check("A1 approve removes only that card", (await card(page, "Ali Raza").count()) === 0 && (await card(page, "Bilal Khan").count()) === 1 && (await card(page, "Ehsan Ullah").count()) === 1);
    check("A1 header drops to 2", (await page.getByTestId("approvals-count").first().innerText()).trim() === "2 approvals baqi");

    // Overpayment on B: banner + two choices, default advance_only.
    await card(page, "Bilal Khan").getByRole("button", { name: "Approve" }).click();
    await page.getByTestId("overpayment-banner").first().waitFor({ timeout: 8000 });
    await shot(page, "03-overpayment");
    const radios = page.getByRole("radio");
    const r1 = await radios.nth(0).getAttribute("aria-label");
    const r2 = await radios.nth(1).getAttribute("aria-label");
    check("A10.3 overpayment banner + two choices", /Sirf PKR 2,000 manzoor - baqi PKR 8,000 wapas karna hoga/.test(r1) && /Poora PKR 10,000 manzoor \(extra advance\)/.test(r2), r1 + " | " + r2);
    check("A10.3 default choice is advance_only", (await radios.nth(0).getAttribute("aria-checked")) === "true", (await radios.nth(0).evaluate((e) => e.outerHTML.slice(0, 300))));
    await (await vis(page.getByRole("button", { name: "Approve karein" }))).click();
    await waitFor(async () => reqs.some((r) => r.p === "/payments/pB/approve"), 8000);
    const appB = reqs.find((r) => r.p === "/payments/pB/approve");
    check("A10.3 approve sends accept_mode advance_only", appB && JSON.parse(appB.body || "{}").accept_mode === "advance_only", appB && appB.body);

    // Reject E -> 409 BOOKING_NO_LONGER_PENDING -> grey in place, no error text.
    await card(page, "Ehsan Ullah").getByRole("button", { name: "Reject" }).click();
    await page.getByText("Keyboard ke mic se bolein").first().waitFor({ timeout: 8000 });
    check("A9 reject reason has the keyboard mic hint", (await page.getByText("Keyboard ke mic se bolein").count()) >= 1);
    await (await vis(page.getByRole("radio", { name: "Amount match nahi karta" }))).click();
    await (await vis(page.getByRole("button", { name: "Reject karein" }))).click();
    await waitFor(async () => (await page.locator('[data-testid="approval-card-grey"]').filter({ hasText: "Ehsan Ullah" }).count()) === 1, 8000);
    await page.locator('[data-testid="approval-card-grey"]').first().scrollIntoViewIfNeeded();
    await shot(page, "04-grey");
    const greyE = page.locator('[data-testid="approval-card-grey"]').filter({ hasText: "Ehsan Ullah" });
    check("A5 409 turns the card grey in place", (await greyE.count()) === 1 && (await greyE.innerText()).includes("Player ne cancel kar di"));
    check("A5 no error text and no Approve/Reject on grey card", !(await greyE.innerText()).includes("no longer") && (await greyE.getByRole("button", { name: "Approve" }).count()) === 0 && (await greyE.getByRole("button", { name: "Theek hai" }).count()) === 1);

    // Cancelled with screenshot: two money buttons.
    const greyC = page.locator('[data-testid="approval-card-grey"]').filter({ hasText: "Chaudhry Asif" });
    check("A5 cancelled card: grey chip + two money buttons", (await greyC.innerText()).includes("Player ne cancel kar di") && (await greyC.getByRole("button", { name: "Paisa nahi aaya - Theek hai" }).count()) === 1 && (await greyC.getByRole("button", { name: "Paisa aa gaya - Refund banayein" }).count()) === 1);
    await greyC.getByRole("button", { name: "Paisa aa gaya - Refund banayein" }).click();
    // P0-7: a confirm sheet with the amount and the booking comes first; nothing is sent until "Haan, refund banayein".
    await waitFor(async () => (await page.getByTestId("refund-confirm").count()) === 1, 5000);
    check("A5 refund confirm shows amount + player before anything is sent", (await page.getByTestId("refund-confirm-amount").innerText()).includes("PKR") && (await page.getByTestId("refund-confirm").innerText()).includes("Chaudhry Asif") && !reqs.some((r) => r.p === "/owners/payments/pC/acknowledge"));
    await page.getByRole("button", { name: "Haan, refund banayein" }).click();
    await waitFor(async () => (await greyC.count()) === 0, 8000);
    const ackC = reqs.find((r) => r.p === "/owners/payments/pC/acknowledge");
    check("A5 money received -> acknowledge(true), card leaves", ackC && JSON.parse(ackC.body).money_received === true && (await greyC.count()) === 0, ackC && ackC.body);
    const greyD = page.locator('[data-testid="approval-card-grey"]').filter({ hasText: "Danish Ali" });
    check("A5 expired card without screenshot: one Theek hai", (await greyD.getByRole("button", { name: "Theek hai" }).count()) === 1 && (await greyD.innerText()).includes("Waqt khatam"));
    await greyD.getByRole("button", { name: "Theek hai" }).click();
    await waitFor(async () => (await greyD.count()) === 0, 8000);
    const ackD = reqs.find((r) => r.p === "/owners/payments/pD/acknowledge");
    check("A5 Theek hai -> acknowledge(false)", ackD && JSON.parse(ackD.body).money_received === false);

    // 15 s polling picks up a new payment.
    state.extra.push(base("pF", "Faisal New", at(addDays(pktToday, 2), 17), at(addDays(pktToday, 2), 18), { submitted_at: iso(0) }));
    const polled = await waitFor(async () => (await card(page, "Faisal New").count()) === 1, 25000);
    check("A1 15s polling shows a new payment on top", polled);

    // Details -> sheet with thumbnail; History link inside closes the sheet first, then History highlights.
    const thumbsBefore = await page.getByTestId("screenshot-thumb").count();
    await card(page, "Faisal New").getByRole("button", { name: "Details" }).click();
    await page.getByText("Band karein").first().waitFor({ timeout: 10000 });
    await waitFor(async () => (await page.getByTestId("screenshot-thumb").count()) > thumbsBefore, 8000);
    check("A3 thumbnail inside BookingDetailSheet", (await page.getByTestId("screenshot-thumb").count()) === thumbsBefore + 1 && (await page.getByText("Bara karke dekhein").count()) >= 1);
    check("A8 detail timeline shows 'Baqi se PKR 1,000 mila'", (await page.getByText("Baqi se PKR 1,000 mila").count()) >= 1);
    check("A4 detail shows the channel heading + 'App ya website'", (await page.getByText("Zariya (booking kahan se shuru hui)").count()) >= 1 && (await page.getByText("App ya website").count()) >= 1 && (await page.getByText("App chat").count()) === 0);
    await (await vis(page.getByRole("button", { name: "History mein dekhein" }))).click();
    await page.waitForURL(/history/, { timeout: 15000 });
    await page.getByTestId("history-focus-banner").first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(500);
    await shot(page, "05-history-focus");
    await page.waitForFunction(() => !document.body.innerText.includes("Band karein"), null, { timeout: 5000 }).catch(() => {});
    check("A2 sheet closed before navigating (no popup on History)", (await page.getByText("Band karein").count()) === 0);
    check("A2 History shows 'Sirf ye booking' + Filter hatayen", (await page.getByText("Sirf ye booking dikhayi ja rahi hai").count()) === 1 && (await page.getByRole("button", { name: "Filter hatayen" }).count()) === 1);
    check("A2 History highlights the target card", (await page.getByTestId("history-highlighted").count()) === 1);
    await page.getByRole("button", { name: "Filter hatayen" }).click();
    await page.waitForTimeout(500);
    check("A2 Filter hatayen shows the full day, card still highlighted", (await page.getByText("Zain Other").count()) >= 1 && (await page.getByTestId("history-highlighted").count()) === 1 && (await page.getByTestId("history-focus-banner").count()) === 0);
    await ctx.close();
  }

  // ---------------- A1 pagination + date/court params ----------------
  {
    const state = defaultState();
    state.queue = (url) => {
      const pg = Number(url.searchParams.get("page") || 1);
      const items = pg === 1 ? [base("p1", "Page One", at(pktToday, 20), at(pktToday, 21)), base("p2", "Page Two", at(pktToday, 19), at(pktToday, 20))] : [base("p3", "Page Three", at(pktToday, 18), at(pktToday, 19))];
      return { items, total: 51, page: pg, page_size: 50 };
    };
    const { ctx, page, reqs } = await setup(browser, state);
    await page.goto(BASE + `/approvals?date=${pktToday}&courts=c1`, { waitUntil: "domcontentloaded", timeout: 240000 });
    await page.getByTestId("approvals-count").first().waitFor({ timeout: 180000 });
    await waitFor(async () => (await card(page, "Page One").count()) === 1);
    const q1 = reqs.filter((r) => r.p === "/owners/approvals-queue")[0];
    check("A1 date + court params reach the queue", q1 && q1.q.includes("date=" + pktToday) && q1.q.includes("court_ids=c1") && q1.q.includes("page_size=50"), q1 && q1.q);
    check("A1 'Aur dikhao' when more than a page", (await page.getByText("Aur dikhao").count()) === 1);
    await page.getByText("Aur dikhao").click();
    await waitFor(async () => (await card(page, "Page Three").count()) === 1, 8000);
    check("A1 'Aur dikhao' loads page 2", (await card(page, "Page Three").count()) === 1 && reqs.some((r) => r.p === "/owners/approvals-queue" && r.q.includes("page=2")));
    await page.getByText("Sab dikhao").click();
    await waitFor(async () => reqs.some((r) => r.p === "/owners/approvals-queue" && !r.q.includes("date=")), 8000);
    check("A1 'Sab dikhao' drops the filters", reqs.some((r) => r.p === "/owners/approvals-queue" && !r.q.includes("date=") && !r.q.includes("court_ids")));
    await ctx.close();
  }

  // ---------------- A7 Overview + A8 completion ----------------
  {
    const state = defaultState();
    const { ctx, page, reqs } = await setup(browser, state);
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 240000 });
    await page.getByTestId("total-slots-card").first().waitFor({ timeout: 180000 });
    await page.waitForTimeout(800);
    await page.getByTestId("total-slots-card").first().scrollIntoViewIfNeeded();
    await shot(page, "06-overview");
    check("A7 Free slots / Booked slots cards removed", (await page.getByText("Booked slots", { exact: true }).count()) === 0 && (await page.getByText("Khali slots", { exact: true }).count()) === 0);
    const total = page.getByTestId("total-slots-card").first();
    check("A7 Total legend buttons (44px)", (await total.getByRole("button", { name: "Booked 8" }).count()) === 1 && (await total.getByRole("button", { name: "Pending 2, Is din ke slots" }).count()) === 1 && (await total.getByRole("button", { name: "Blocked 1" }).count()) === 1 && (await total.getByRole("button", { name: "Free 19" }).count()) === 1);
    const lb = await total.getByRole("button", { name: "Free 19" }).boundingBox();
    check("A7 legend button is at least 44px high", lb && lb.height >= 44, lb && String(lb.height));
    check("A7 'Khali: X aane wale - Y guzre hue'", (await total.getByText("Khali: 12 aane wale - 7 guzre hue").count()) === 1);
    check("A7 bar pending labelled 'Is din ke slots'", (await total.getByText("Is din ke slots").count()) === 1);
    check("A7 top 2 courts + '+N aur'", (await total.getByText("C1: 5/10 booked").count()) === 1 && (await total.getByText("C2: 2/10 booked").count()) === 1 && (await total.getByText("+1 aur").count()) === 1);
    const pend = page.getByTestId("pending-all-card").first();
    const pendText = await pend.innerText();
    check("A7 Pending bookings card from pending_all ('Sab dino ki', N/M)", /Pending bookings/.test(pendText) && /Sab dino ki/.test(pendText) && /\b5\b/.test(pendText) && /Approval \(2\)/.test(pendText) && /Payment ke intezar \(3\)/.test(pendText), pendText.replace(/\n/g, " | "));
    const tbb = await total.boundingBox();
    const pbb = await pend.boundingBox();
    check("A7 Pending card sits right after Total (top row)", pbb.y > tbb.y && pbb.y - (tbb.y + tbb.height) < 30);
    check("A7 second row: Bookings, Cancelled, Refunds, Collected, Due", (await page.getByRole("button", { name: "Bookings" }).count()) >= 1 && (await page.getByRole("button", { name: "Cancelled" }).count()) >= 1 && (await page.getByRole("button", { name: "Refunds" }).count()) >= 1 && (await page.getByRole("button", { name: "Collected" }).count()) >= 1 && (await page.getByRole("button", { name: "Due" }).count()) >= 1);

    await total.getByRole("button", { name: "Free 19" }).click();
    await page.getByText("Khali slots").first().waitFor({ timeout: 10000 });
    await waitFor(async () => (await page.getByLabel(/10:00 PM, khaali/).count()) > 0, 10000);
    check("A7 Free -> slots sheet showing only free slots", (await page.getByLabel(/10:00 PM, khaali/).count()) >= 1 && (await page.getByLabel(/11:00 PM, booked/).count()) === 0);
    await (await vis(page.getByRole("button", { name: "Band karein" }))).click();
    await page.waitForTimeout(400);

    // A8 completion "Nahi".
    await page.getByRole("button", { name: "Booking completed: Chunein" }).first().click();
    await (await vis(page.getByText("Nahi", { exact: true }))).click();
    await page.getByText("Baqi mein se kitna mila? (PKR)").first().waitFor({ timeout: 8000 });
    await shot(page, "07-completion");
    const input = await vis(page.getByLabel("Baqi mein se kitna mila? (PKR)"));
    check("A8 field defaults to 0", (await input.inputValue()) === "0");
    check("A8 live line at 0", (await page.getByText("Save karne par Due PKR 2,500 rahega.").count()) === 1);
    const save = async () => vis(page.getByRole("button", { name: "Save karein" }));
    check("A8 reason required while due remains (Save disabled)", (await (await save()).getAttribute("aria-disabled")) === "true");
    check("A8 keyboard mic hint", (await page.getByText("Keyboard ke mic se bolein").count()) >= 1);
    await input.fill("3000");
    check("A8 above Due is refused", (await page.getByText("Sirf 0 se PKR 2,500 tak likhein.").count()) === 1);
    await input.fill("2500");
    check("A8 equals Due -> Mukammal, no reason needed", (await page.getByText(/Booking Mukammal ho jayegi/).count()) === 1 && (await page.getByLabel("Wajah").count()) === 0 && (await (await save()).getAttribute("aria-disabled")) !== "true");
    await input.fill("1000");
    check("A8 live line updates (1,000 -> Due 1,500)", (await page.getByText("Save karne par Due PKR 1,500 rahega.").count()) === 1);
    await (await vis(page.getByLabel("Wajah"))).fill("Customer ne kaha baqi paisa kal dega");
    await (await save()).click();
    await waitFor(async () => reqs.some((r) => /\/completion$/.test(r.p)), 8000);
    const comp = reqs.find((r) => /\/completion$/.test(r.p));
    const cb = comp ? JSON.parse(comp.body) : {};
    check("A8 posts received_now (positive entry), not received_pkr", cb.result === "no" && cb.received_now === 1000 && cb.received_pkr === undefined && /kal dega/.test(cb.reason || ""), comp && comp.body);

    // Pending card -> Approvals with no date filter.
    await pend.getByRole("button", { name: "Pending bookings 5" }).click();
    await page.waitForURL(/approvals/, { timeout: 15000 });
    check("A7 Pending card opens Approvals without a date", !/date=/.test(page.url()), page.url());
    await page.goBack();
    await page.getByTestId("pending-all-card").first().waitFor({ timeout: 30000 });
    await (await vis(page.getByText("Payment ke intezar (3)"))).click();
    await page.waitForURL(/history/, { timeout: 15000 });
    await waitFor(async () => reqs.some((r) => r.p === "/owners/bookings-history" && r.q.includes("statuses=held")), 10000);
    const h = reqs.filter((r) => r.p === "/owners/bookings-history" && r.q.includes("statuses=held")).pop();
    const from = h && new URL("http://x/" + h.q).searchParams.get("date_from");
    check("A7 'Payment ke intezar' opens History held with no single-day filter", h && from && from < addDays(pktToday, -30), h && h.q);
    await ctx.close();
  }

  // ---------------- A10 refunds ----------------
  {
    const state = defaultState();
    const { ctx, page, reqs } = await setup(browser, state);
    await page.goto(BASE + "/refunds", { waitUntil: "domcontentloaded", timeout: 240000 });
    await page.getByText("Refunds dene hain").first().waitFor({ timeout: 180000 });
    await page.getByText("Mujtaba Anwer").first().waitFor({ timeout: 30000 });
    check("A10 'Hissa wapas' chip on a partly refunded card", (await page.getByTestId("chip-partial").count()) === 1);
    // Stage 2: duplicate_proof -> warning chip (icon + text) on that card only
    const dupChip = page.getByTestId("refund-dup-chip");
    check("Stage 2 duplicate_proof chip on the refund card (icon + text), only there", (await dupChip.count()) === 1 && (await dupChip.innerText()).trim() === "Ye screenshot 2 aur bookings par bhi credit hua" && (await dupChip.locator("svg").count()) === 1, (await dupChip.count()) ? await dupChip.innerText() : "none");
    await page.getByRole("button", { name: "Mujtaba Anwer refund" }).click();
    await page.getByTestId("refund-breakdown").first().waitFor({ timeout: 8000 });
    await page.waitForTimeout(500);
    await shot(page, "08-refund");
    const bd = await page.getByTestId("refund-breakdown").first().innerText();
    check("A10 breakdown card (sent / policy / already / remaining)", /Player ne bheje\s*PKR 10,000/.test(bd) && /Refund banta hai \(policy\)\s*PKR 2,000/.test(bd) && /Pehle wapas kiye\s*PKR 500/.test(bd) && /Ab baqi wapas dena\s*PKR 1,500/.test(bd), bd.replace(/\n/g, " | "));
    const amt = await vis(page.getByLabel("Kitna wapas bheja? (PKR)"));
    check("A10 amount prefilled with the remaining", (await amt.inputValue()) === "1500");
    await amt.fill("10000");
    check("A10 clear over-limit error", (await page.getByText("Aap ne 10,000 likha, lekin sirf PKR 1,500 wapas banta hai.").count()) === 1);
    await (await vis(page.getByRole("button", { name: "Poora PKR 1,500" }))).click();
    check("A10 'Poora PKR X' chip fills the max", (await amt.inputValue()) === "1500" && (await page.getByTestId("refund-amount-error").count()) === 0);
    const submit = await vis(page.getByRole("button", { name: "Refund record karein" }));
    check("A10 reference required (submit disabled)", (await submit.getAttribute("aria-disabled")) === "true");
    check("A10 screenshot optional + player screenshot thumb", (await page.getByText("Screenshot (zaroori nahi)").count()) === 1 && (await page.getByTestId("screenshot-thumb").count()) >= 1);
    await (await vis(page.getByLabel("Reference"))).fill("JC 778899");
    await submit.click();
    await submit.click({ force: true }).catch(() => {});
    await page.getByTestId("refund-success").first().waitFor({ timeout: 10000 });
    await shot(page, "09-refund-success");
    const posts = reqs.filter((r) => r.p === "/owners/refunds/r1/mark-refunded");
    check("A10 no double submit", posts.length === 1, String(posts.length));
    check("A10 posts amount + reference", posts[0] && /name="amount"\r\n\r\n1500/.test(posts[0].body) && /name="reference"\r\n\r\nJC 778899/.test(posts[0].body));
    check("A10 success summary", (await page.getByText("PKR 1,500 wapas record ho gaya.").count()) === 1);
    await (await vis(page.getByRole("button", { name: "Theek hai" }))).click();
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "Abbas Zafar refund" }).click();
    await page.getByTestId("refund-none").first().waitFor({ timeout: 8000 });
    check("A10 remaining 0 -> no form + why", (await page.getByText("Koi refund baqi nahi").count()) === 1 && (await page.getByLabel("Kitna wapas bheja? (PKR)").count()) === 0);
    await ctx.close();
  }

  // ---------------- QA: staff without permission ----------------
  {
    const state = defaultState();
    state.denyApprove = true;
    state.denyRefunds = true;
    const { ctx, page } = await setup(browser, state);
    await page.goto(BASE + "/approvals", { waitUntil: "domcontentloaded", timeout: 240000 });
    await page.getByTestId("approvals-count").first().waitFor({ timeout: 180000 });
    await waitFor(async () => (await page.locator('[data-testid="approval-card"]').count()) > 0);
    await card(page, "Ali Raza").getByRole("button", { name: "Approve" }).click();
    await (await vis(page.getByRole("button", { name: "Approve karein" }))).click();
    await waitFor(async () => (await page.getByTestId("approval-locked").count()) > 0, 8000);
    await shot(page, "10-no-permission");
    check("QA staff refusal: every card shows the no-permission note", (await page.getByTestId("approval-locked").count()) === 5);
    // the approve sheet animates out after the 403 (Floodlight Sheet): give it a moment before counting buttons
    await waitFor(async () => (await page.getByRole("button", { name: "Approve" }).count()) === 0, 4000);
    check("QA staff refusal: Approve/Reject/Theek hai hidden", (await page.getByRole("button", { name: "Approve" }).count()) === 0 && (await page.getByRole("button", { name: "Theek hai" }).count()) === 0);
    check("QA staff refusal text", (await page.getByText("Aap ke paas is kaam ki ijazat nahi. Owner se ijazat mangein.").count()) >= 1 && (await page.getByText(/not your booking|aapki booking nahi/i).count()) === 0);
    check("QA refused card stays", (await card(page, "Ali Raza").count()) === 1);
    await page.goto(BASE + "/refunds", { waitUntil: "domcontentloaded", timeout: 240000 });
    await page.getByText("Refunds dene hain").first().waitFor({ timeout: 180000 });
    await waitFor(async () => (await page.getByTestId("refunds-no-permission").count()) > 0, 20000);
    await shot(page, "11-refunds-no-permission");
    check("QA refunds: one no-permission state", (await page.getByTestId("refunds-no-permission").count()) === 1 && (await page.getByText("Aap ke paas is kaam ki ijazat nahi").count()) >= 1);
    check("QA refunds: no 'nothing owed' next to it", (await page.getByText("Abhi koi refund baqi nahi").count()) === 0 && (await page.getByText("Sab hisaab barabar").count()) === 0 && (await page.getByTestId("refunds-count").count()) === 0);
    await ctx.close();
  }

  check("no page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
