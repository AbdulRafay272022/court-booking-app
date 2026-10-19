// Expo-web e2e for Round 2 Stage 2, mobile part M1: duplicate-screenshot confirm (B.a), staff permissions hiding buttons up
// front (B.b), "Status baqi" chip + Overview line + History filter (C.3/C.4), Haan/Nahi -> Completed and the separate
// "Nahi aaye (No-show)" confirm sheet (C.3).
// Run: PLAYWRIGHT_PATH=<...>/node_modules/playwright BASE=http://localhost:8094 node e2e/stage2-m1-check.cjs
// Expo web must be started with a DEAD api url (EXPO_PUBLIC_API_BASE_URL=http://localhost:9) and --clear; every /api/v1/**
// call is mocked with page.route, nothing reaches a real backend. 390px viewport.
const { chromium } = require(process.env.PLAYWRIGHT_PATH);
const BASE = process.env.BASE || "http://localhost:8094";

const H = 3600e3;
const pktToday = new Date(Date.now() + 5 * H).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(new Date(d + "T00:00:00Z").getTime() + n * 86400e3).toISOString().slice(0, 10);
const at = (day, hh) => `${day}T${String(hh).padStart(2, "0")}:00:00+05:00`;
const iso = (h) => new Date(Date.now() + h * H).toISOString();
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAACgAAAA8CAIAAACb22+3AAAAOElEQVR4nO3NQQkAAAgEsAtmMCMayxgiDPZfputExGKxWCwWi8VisVgsFovFYrFYLBaLxWLxp3gB8KnrRHLLp+oAAAAASUVORK5CYII=", "base64");

const user = { id: "u1", role: "owner", name: "Owner One", phone: "+923001234567", email: null };
const courts = [{ id: "c1", venue_id: "v1", name: "Court 1", sport: "padel", is_active: true }];
const venue = { id: "v1", name: "Arena Khelo", status: "approved", courts };
const ALL_KEYS = ["approve_payments", "record_payments", "check_in", "walkin", "cancel_booking", "mark_refunds", "view_ledger"];

const base = (id, name, extra = {}) => ({
  payment_id: id, booking_id: "b-" + id, court_name: "Court 1", court_id: "c1", court_sport: "padel", starts_at: at(addDays(pktToday, 1), 20), ends_at: at(addDays(pktToday, 1), 21),
  player_name: name, player_phone: "0300 1234567", ocr_verdict: "match", ocr_amount: 2000, expected_amount: 2000, proof_url: null,
  submitted_at: iso(-0.2), minutes_since_submission: 12, checks: null, account_name: null,
  state: "awaiting", cancelled_at: null, has_screenshot: false, overpayment: null, duplicate: null, ...extra,
});

const done = (result) => ({ result, received_pkr: 4500, reason: null, marked_at: iso(-1), marked_by_name: "Owner One" });
const row = (id, extra = {}) => ({
  booking_id: id, short_code: "KH-" + id.toUpperCase().padEnd(8, "0").slice(0, 8), kind: "booked", status_key: "booked", player_name: "Usman Tariq", player_phone: "0300 1234567",
  court_id: "c1", court_name: "Court 1", starts_at: at(pktToday, 8), ends_at: at(pktToday, 9), duration_minutes: 60, slot_count: 1, total: 4500, advance: 2000, due: 2500, total_paid: 2000,
  source: "app", checked_in: false, completion: null, slot_ended: true, original_booking_id: null, refund_amount: null, refund_status: null, status_pending: false, ...extra,
});
function overviewRows() {
  return [
    row("bkp", { player_name: "Pervaiz Pending", status_pending: true }),
    row("bkn", { player_name: "Nadeem Noshow", status_key: "no_show", starts_at: at(pktToday, 10), ends_at: at(pktToday, 11) }),
    row("bkc", { player_name: "Kamran Complete", completion: done("yes"), due: 0, total_paid: 4500, starts_at: at(pktToday, 12), ends_at: at(pktToday, 13) }),
    row("bkf", { player_name: "Farhan Future", slot_ended: false, starts_at: at(pktToday, 23), ends_at: at(addDays(pktToday, 1), 0) }),
  ];
}

const results = [];
const pageErrors = [];
const dialogs = [];
function check(name, ok, extra) {
  results.push({ name, ok: !!ok });
  console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  " + extra : ""));
}
const shot = async (page, name) => {
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${name}.png`, fullPage: false });
};

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
  await ctx.route("https://proof.test/**", (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  await ctx.route("**/health", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await ctx.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname.replace(/^.*\/api\/v1/, "");
    const entry = { method: req.method(), p, q: url.search, body: req.postData() || "" };
    reqs.push(entry);
    const json = (data, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    let m;
    if (p === "/auth/me") return json({ user, session: { device_id: "d", device_name: null, platform: "web", last_active_at: iso(0), expires_at: iso(7) } });
    if (p === "/auth/refresh") return json({ token: "tok", expires_at: iso(8) });
    if (p === "/owners/venues") return json([venue]);
    if (p === "/owners/me/permissions") return json(state.perms);
    if (p === "/owners/badges") return json({ approvals: 2, refunds: 0 });
    if (p === "/owners/approvals-queue") {
      const items = state.queue().filter((it) => !state.approved.has(it.payment_id));
      return json({ items, total: items.length, page: 1, page_size: 50 });
    }
    if (/^\/payments\/[^/]+\/proof-url$/.test(p)) return json({ url: "https://proof.test/good.png", expires_in: 300 });
    if ((m = /^\/payments\/([^/]+)\/approve$/.exec(p))) {
      const body = JSON.parse(entry.body || "{}");
      const flagged = { pDup: 2, pSrv: 3 }[m[1]];
      if (flagged && !body.confirm_duplicate) return json({ error: { code: "DUPLICATE_PROOF_CONFIRM_REQUIRED", message: "confirm", details: { used_on_bookings: flagged } } }, 409);
      state.approved.add(m[1]);
      return json({ payment: { id: m[1] }, booking: { id: "b" } });
    }
    if (p === "/owners/overview") return json(state.overview());
    if (p === "/owners/bookings-history") {
      const items = state.history(url);
      return json({ items, total: items.length, page: 1, page_size: 20, totals: { count: items.length, total: 9000, collected: 4000, due: 5000 } });
    }
    if ((m = /^\/owners\/bookings\/([^/]+)\/overview-detail$/.exec(p))) {
      const r = overviewRows().find((x) => x.booking_id === m[1]) || row(m[1]);
      return json({ row: r, booked_at: iso(-30), hold_expires_at: null, advance_required: 2000, payment_id: null, ocr_verdict: null, ocr_amount: null, approval: null, cancellation: null, refund: null, completion: r.completion, timeline: [] });
    }
    if ((m = /^\/owners\/bookings\/([^/]+)\/completion$/.exec(p))) return json(row(m[1], { completion: done("yes"), status_pending: false }));
    if ((m = /^\/bookings\/([^/]+)\/no-show$/.exec(p))) {
      if (state.noShowFail) {
        state.noShowFail = false;
        return json({ error: { code: "TOO_EARLY_FOR_NO_SHOW", message: "Too early to mark this booking as a no-show" } }, 400);
      }
      return json({ booking: { id: m[1], status: "no_show" } });
    }
    if ((m = /^\/bookings\/([^/]+)\/checkin$/.exec(p))) return json({ booking: { id: m[1] } });
    if (p === "/owners/refunds") return json([]);
    if (p.startsWith("/owners/") || p.startsWith("/users/")) return json([]);
    return json({});
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push("pageerror: " + e.message));
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    d.dismiss().catch(() => {});
  });
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
const bcard = (page, id) => page.getByTestId(`booking-card-${id}-booked`).first();

function defaultState() {
  const state = { approved: new Set(), perms: { role: "owner", venue_permissions: [{ venue_id: "v1", permissions: ALL_KEYS }] } };
  state.queue = () => [
    base("pDup", "Daud Duplicate", { duplicate: { used_on_bookings: 2 }, has_screenshot: true, proof_url: "https://proof.test/good.png" }),
    base("pSrv", "Saad Server"),
    base("pOk", "Omar Okay"),
  ];
  state.overview = () => ({
    date: pktToday, venue_id: "v1", operating_day: null,
    slots: { total: 10, booked: 4, pending: 0, blocked: 0, free: 6, free_upcoming: 3, free_past: 3, by_court: [{ court_id: "c1", court_name: "Court 1", total: 10, booked: 4, pending: 0, blocked: 0, free: 6 }] },
    bookings: { count: 4, cancelled: 0, refunds: { count: 0, amount: 0 }, pending: { count: 0, awaiting_approval: 0, awaiting_payment: 0 }, by_court: [] },
    money: { collected: 9000, due: 2500, due_bookings: 1 },
    pending_all: { count: 0, awaiting_approval: 0, awaiting_payment: 0 },
    status_pending_count: 4,
    rows: overviewRows(),
  });
  state.history = () => [row("hp1", { player_name: "Hamza History", status_pending: true, starts_at: at(addDays(pktToday, -3), 18), ends_at: at(addDays(pktToday, -3), 19) })];
  return state;
}

(async () => {
  const browser = await chromium.launch();

  // ---------------- B.a duplicate screenshot confirm ----------------
  {
    const state = defaultState();
    const { ctx, page, reqs } = await setup(browser, state);
    await page.goto(BASE + "/approvals", { waitUntil: "domcontentloaded", timeout: 240000 });
    await page.getByTestId("approvals-count").first().waitFor({ timeout: 180000 });
    await waitFor(async () => (await card(page, "Daud Duplicate").count()) === 1);
    await page.waitForTimeout(600);
    await shot(page, "s2-01-duplicate-chip");
    const chip = card(page, "Daud Duplicate").getByTestId("duplicate-chip");
    check("B.a duplicate chip on the flagged card (icon + text)", (await chip.count()) === 1 && /Duplicate: Ye screenshot pehle bhi 2 bookings par use hua hai/.test(await chip.innerText()) && (await chip.locator("svg").count()) >= 1, (await chip.count()) ? await chip.innerText() : "none");
    check("B.a no duplicate chip on clean cards", (await card(page, "Omar Okay").getByTestId("duplicate-chip").count()) === 0);

    await card(page, "Daud Duplicate").getByRole("button", { name: "Approve" }).click();
    await (await vis(page.getByRole("button", { name: "Approve karein" }))).click();
    await page.getByTestId("duplicate-confirm").first().waitFor({ timeout: 8000 });
    await page.waitForTimeout(400);
    await shot(page, "s2-02-duplicate-confirm");
    const confirmText = await page.getByTestId("duplicate-confirm").first().innerText();
    check("B.a separate confirm with the exact question", confirmText.trim() === "Ye screenshot pehle bhi 2 bookings par use hua hai. Phir bhi approve karein?", confirmText);
    check("B.a nothing sent before the second confirm", !reqs.some((r) => r.p === "/payments/pDup/approve"));
    check("B.a approve sheet closed behind it", (await page.getByRole("button", { name: "Approve karein", exact: true }).count()) === 0);
    await (await vis(page.getByRole("button", { name: "Wapas" }))).click();
    await page.waitForTimeout(400);
    check("B.a Wapas: no request, card stays", !reqs.some((r) => r.p === "/payments/pDup/approve") && (await card(page, "Daud Duplicate").count()) === 1 && (await page.getByTestId("duplicate-confirm").count()) === 0);

    await card(page, "Daud Duplicate").getByRole("button", { name: "Approve" }).click();
    await (await vis(page.getByRole("button", { name: "Approve karein" }))).click();
    await (await vis(page.getByRole("button", { name: "Phir bhi approve karein" }))).click();
    await waitFor(async () => (await card(page, "Daud Duplicate").count()) === 0, 8000);
    const dupReqs = reqs.filter((r) => r.p === "/payments/pDup/approve");
    check("B.a 'Phir bhi approve karein' sends confirm_duplicate=true once", dupReqs.length === 1 && JSON.parse(dupReqs[0].body || "{}").confirm_duplicate === true, dupReqs.map((r) => r.body).join(" | "));
    check("B.a card leaves after the confirmed approve", (await card(page, "Daud Duplicate").count()) === 0);

    // Server-side check: card not flagged, server answers 409 DUPLICATE_PROOF_CONFIRM_REQUIRED -> same confirm with its N.
    await card(page, "Saad Server").getByRole("button", { name: "Approve" }).click();
    await (await vis(page.getByRole("button", { name: "Approve karein" }))).click();
    await page.getByTestId("duplicate-confirm").first().waitFor({ timeout: 8000 });
    const t2 = await page.getByTestId("duplicate-confirm").first().innerText();
    check("B.a 409 DUPLICATE_PROOF_CONFIRM_REQUIRED opens the confirm with the server count", t2.trim() === "Ye screenshot pehle bhi 3 bookings par use hua hai. Phir bhi approve karein?", t2);
    check("B.a 409: no raw error text", (await page.getByText(/confirm|DUPLICATE_PROOF/).count()) === 0);
    await (await vis(page.getByRole("button", { name: "Phir bhi approve karein" }))).click();
    await waitFor(async () => (await card(page, "Saad Server").count()) === 0, 8000);
    const srv = reqs.filter((r) => r.p === "/payments/pSrv/approve").map((r) => JSON.parse(r.body || "{}"));
    check("B.a 409 path: first without, then with confirm_duplicate", srv.length === 2 && !srv[0].confirm_duplicate && srv[1].confirm_duplicate === true, JSON.stringify(srv));

    // A clean card never asks.
    await card(page, "Omar Okay").getByRole("button", { name: "Approve" }).click();
    await (await vis(page.getByRole("button", { name: "Approve karein" }))).click();
    await waitFor(async () => (await card(page, "Omar Okay").count()) === 0, 8000);
    const ok = reqs.find((r) => r.p === "/payments/pOk/approve");
    check("B.a clean screenshot: no confirm, no confirm_duplicate", ok && !JSON.parse(ok.body || "{}").confirm_duplicate && (await page.getByTestId("duplicate-confirm").count()) === 0, ok && ok.body);
    await ctx.close();
  }

  // ---------------- B.b staff without permissions: hidden up front ----------------
  {
    const state = defaultState();
    state.perms = { role: "staff", venue_permissions: [{ venue_id: "v1", permissions: ["view_ledger"] }] };
    const { ctx, page, reqs } = await setup(browser, state);
    await page.goto(BASE + "/approvals", { waitUntil: "domcontentloaded", timeout: 240000 });
    await page.getByTestId("approvals-count").first().waitFor({ timeout: 180000 });
    await waitFor(async () => (await page.getByTestId("approval-locked").count()) === 3, 15000);
    await page.waitForTimeout(500);
    await shot(page, "s2-03-staff-approvals");
    check("B.b staff: every approval card shows the note before any tap", (await page.getByTestId("approval-locked").count()) === 3);
    check("B.b staff: no Approve / Reject buttons", (await page.getByRole("button", { name: "Approve" }).count()) === 0 && (await page.getByRole("button", { name: "Reject" }).count()) === 0);
    check("B.b staff: no approve request was needed to learn it", !reqs.some((r) => /\/approve$/.test(r.p)));

    await page.goto(BASE + "/refunds", { waitUntil: "domcontentloaded", timeout: 240000 });
    await page.getByText("Refunds to pay").first().waitFor({ timeout: 180000 });
    await waitFor(async () => (await page.getByTestId("refunds-no-permission").count()) > 0, 15000);
    check("B.b staff: refunds no-permission state up front", (await page.getByTestId("refunds-no-permission").count()) === 1 && (await page.getByTestId("refunds-count").count()) === 0);
    check("B.b staff: refunds list never requested", !reqs.some((r) => r.p === "/owners/refunds"));

    await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 240000 });
    await page.getByTestId("total-slots-card").first().waitFor({ timeout: 180000 });
    await waitFor(async () => (await bcard(page, "bkp").count()) === 1, 15000);
    await page.waitForTimeout(800);
    await bcard(page, "bkp").scrollIntoViewIfNeeded();
    await shot(page, "s2-04-staff-overview");
    check("B.b staff: no Haan/Nahi dropdown on Overview cards", (await page.getByRole("button", { name: /^Booking completed:/ }).count()) === 0);
    check("B.b staff: no 'Nahi aaye (No-show)' on Overview cards", (await page.getByRole("button", { name: "Nahi aaye (No-show)" }).count()) === 0);
    check("B.b staff: Mukammal chip still visible (read-only)", (await bcard(page, "bkc").getByText("Mukammal").count()) === 1);
    await bcard(page, "bkp").getByRole("button", { name: /Pervaiz Pending/ }).click();
    await page.getByText("Band karein").first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(500);
    check("B.b staff: detail sheet has no Check in / No-show / Payment record", (await page.getByRole("button", { name: "Check in" }).count()) === 0 && (await page.getByRole("button", { name: "Nahi aaye (No-show)" }).count()) === 0 && (await page.getByRole("button", { name: /Payment record karein/ }).count()) === 0);
    await ctx.close();
  }
  {
    // Staff WITH approve + check_in (no record_payments): Approve shown, no-show shown, Haan/Nahi hidden.
    const state = defaultState();
    state.perms = { role: "staff", venue_permissions: [{ venue_id: "v1", permissions: ["approve_payments", "check_in", "view_ledger"] }] };
    const { ctx, page } = await setup(browser, state);
    await page.goto(BASE + "/approvals", { waitUntil: "domcontentloaded", timeout: 240000 });
    await page.getByTestId("approvals-count").first().waitFor({ timeout: 180000 });
    await waitFor(async () => (await page.getByRole("button", { name: "Approve" }).count()) === 3, 15000);
    check("B.b staff with approve_payments: Approve shown, no locked note", (await page.getByRole("button", { name: "Approve" }).count()) === 3 && (await page.getByTestId("approval-locked").count()) === 0);
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 240000 });
    await page.getByTestId("total-slots-card").first().waitFor({ timeout: 180000 });
    await waitFor(async () => (await bcard(page, "bkp").count()) === 1, 15000);
    await page.waitForTimeout(800);
    check("B.b staff with check_in only: No-show shown, Haan/Nahi hidden", (await bcard(page, "bkp").getByRole("button", { name: "Nahi aaye (No-show)" }).count()) === 1 && (await page.getByRole("button", { name: /^Booking completed:/ }).count()) === 0);
    await ctx.close();
  }

  // ---------------- C.3 / C.4 owner: Status baqi, Haan/Nahi, No-show, Overview line, History filter ----------------
  {
    const state = defaultState();
    const { ctx, page, reqs } = await setup(browser, state);
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 240000 });
    await page.getByTestId("total-slots-card").first().waitFor({ timeout: 180000 });
    await waitFor(async () => (await bcard(page, "bkp").count()) === 1, 15000);
    await page.waitForTimeout(800);
    const line = page.getByTestId("status-pending-line").first();
    await line.scrollIntoViewIfNeeded();
    await shot(page, "s2-05-overview-line");
    check("C.4 Overview line 'N bookings ka status baqi'", (await line.innerText()).trim() === "4 bookings ka status baqi", await line.innerText());
    const lb = await line.boundingBox();
    check("C.4 line is a 44px+ target inside 390px", lb && lb.height >= 44 && lb.x >= 0 && lb.x + lb.width <= 390, lb && JSON.stringify(lb));

    await bcard(page, "bkp").scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await shot(page, "s2-06-overview-cards");
    const pchip = bcard(page, "bkp").getByTestId("status-pending-chip");
    check("C.3 'Status baqi' chip (icon + text) on the pending card", (await pchip.count()) === 1 && (await pchip.innerText()).trim() === "Status baqi" && (await pchip.locator("svg").count()) === 1);
    check("C.3 no 'Status baqi' chip on other cards", (await page.getByTestId("status-pending-chip").count()) === 1);
    check("C.3 'Nahi aaye (No-show)' only on the ended, unmarked booked card", (await bcard(page, "bkp").getByRole("button", { name: "Nahi aaye (No-show)" }).count()) === 1 && (await page.getByRole("button", { name: "Nahi aaye (No-show)" }).count()) === 1);
    check("C.3 future slot: no No-show, Haan/Nahi disabled", (await bcard(page, "bkf").getByRole("button", { name: "Nahi aaye (No-show)" }).count()) === 0 && (await bcard(page, "bkf").getByRole("button", { name: /^Booking completed:/ }).getAttribute("aria-disabled")) === "true");
    check("C.3 completed card reads 'Completed' + Mukammal", (await bcard(page, "bkc").getByText("Completed", { exact: true }).count()) === 1 && (await bcard(page, "bkc").getByText("Mukammal").count()) === 1);
    const nb = await bcard(page, "bkp").getByRole("button", { name: "Nahi aaye (No-show)" }).boundingBox();
    check("C.3 No-show button 44px+ and inside the screen", nb && nb.height >= 44 && nb.x + nb.width <= 390, nb && JSON.stringify(nb));

    // no_show row still offers Haan/Nahi; Haan posts completion yes.
    const nDrop = bcard(page, "bkn").getByRole("button", { name: /^Booking completed:/ });
    check("C.3 no_show row still offers Haan/Nahi (enabled)", (await nDrop.count()) === 1 && (await nDrop.getAttribute("aria-disabled")) !== "true");
    await nDrop.click();
    await page.getByTestId("completion-hint").first().waitFor({ timeout: 8000 });
    await page.waitForTimeout(300);
    await shot(page, "s2-07-haan-nahi");
    check("C.3 Haan/Nahi sheet says it makes the booking Completed", /Haan ya Nahi chunne se booking Completed ho jayegi/.test(await page.getByTestId("completion-hint").first().innerText()));
    check("C.3 Haan/Nahi option labels", (await page.getByText("Khel hua, poora paisa mil gaya").count()) === 1 && (await page.getByText("Khel hua, kuch paisa baqi hai").count()) === 1);
    await (await vis(page.getByText("Khel hua, poora paisa mil gaya"))).click();
    await waitFor(async () => reqs.some((r) => r.p === "/owners/bookings/bkn/completion"), 8000);
    const cn = reqs.find((r) => r.p === "/owners/bookings/bkn/completion");
    check("C.3 Haan on a no_show row posts completion yes", cn && JSON.parse(cn.body).result === "yes", cn && cn.body);

    // Normal booked row: hint text differs.
    await bcard(page, "bkp").getByRole("button", { name: /^Booking completed:/ }).click();
    await page.getByTestId("completion-hint").first().waitFor({ timeout: 8000 });
    check("C.3 booked row hint: 'dono se booking Completed ho jayegi'", /dono se booking Completed ho jayegi/.test(await page.getByTestId("completion-hint").first().innerText()));
    await (await vis(page.getByRole("button", { name: "Close" }))).click();
    await page.waitForTimeout(400);

    // No-show: confirm sheet, Wapas sends nothing, server error shown, then success.
    await bcard(page, "bkp").getByRole("button", { name: "Nahi aaye (No-show)" }).click();
    await page.getByTestId("no-show-confirm").first().waitFor({ timeout: 8000 });
    await page.waitForTimeout(300);
    await shot(page, "s2-08-noshow-confirm");
    check("C.3 No-show confirm is a sheet (no browser dialog)", dialogs.length === 0 && (await page.getByText("Nahi aaye (No-show)?").count()) >= 1);
    await (await vis(page.getByRole("button", { name: "Wapas" }))).click();
    await page.waitForTimeout(300);
    check("C.3 Wapas: nothing sent", !reqs.some((r) => /\/no-show$/.test(r.p)));
    state.noShowFail = true;
    await bcard(page, "bkp").getByRole("button", { name: "Nahi aaye (No-show)" }).click();
    await (await vis(page.getByRole("button", { name: "No-show mark karein" }))).click();
    await waitFor(async () => (await page.getByText("Slot abhi khatam nahi hua. Slot khatam hone ke baad No-show mark karein.").count()) > 0, 8000);
    check("C.3 TOO_EARLY_FOR_NO_SHOW shows Roman Urdu text in the sheet", (await page.getByText("Slot abhi khatam nahi hua. Slot khatam hone ke baad No-show mark karein.").count()) === 1);
    const ovBefore = reqs.filter((r) => r.p === "/owners/overview").length;
    await (await vis(page.getByRole("button", { name: "No-show mark karein" }))).click();
    await waitFor(async () => (await page.getByTestId("no-show-confirm").count()) === 0, 8000);
    const ns = reqs.filter((r) => r.p === "/bookings/bkp/no-show" && r.method === "POST");
    check("C.3 confirm posts /bookings/{id}/no-show and closes", ns.length === 2 && (await page.getByTestId("no-show-confirm").count()) === 0, String(ns.length));
    await waitFor(async () => reqs.filter((r) => r.p === "/owners/overview").length > ovBefore, 8000);
    check("C.3 Overview refetched after no-show", reqs.filter((r) => r.p === "/owners/overview").length > ovBefore);

    // Detail sheet: chip + Nahi aaye button + sheet.
    await bcard(page, "bkp").getByRole("button", { name: /Pervaiz Pending/ }).click();
    await page.getByText("Band karein").first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(500);
    await shot(page, "s2-09-detail");
    check("C.3 detail sheet shows the 'Status baqi' chip", (await page.getByTestId("status-pending-chip").count()) >= 2);
    // The card behind the sheet has one too; the sheet's own button is the later one in the DOM.
    const nsCount = await page.getByRole("button", { name: "Nahi aaye (No-show)", exact: true }).count();
    const dBtn = nsCount >= 2 ? page.getByRole("button", { name: "Nahi aaye (No-show)", exact: true }).last() : null;
    check("C.3 detail sheet offers 'Nahi aaye (No-show)' (owner)", !!dBtn, String(nsCount));
    if (dBtn) {
      await dBtn.click();
      await page.getByTestId("no-show-confirm").first().waitFor({ timeout: 8000 });
      await (await vis(page.getByRole("button", { name: "No-show mark karein" }))).click();
      await waitFor(async () => reqs.filter((r) => r.p === "/bookings/bkp/no-show").length === 3, 8000);
      check("C.3 detail no-show posts once more", reqs.filter((r) => r.p === "/bookings/bkp/no-show").length === 3);
    }
    await (await vis(page.getByRole("button", { name: "Band karein" }))).click();
    await page.waitForTimeout(400);

    // Overview line -> History with status_pending over the any-date range.
    await page.getByTestId("status-pending-line").first().click();
    await page.waitForURL(/history/, { timeout: 15000 });
    await waitFor(async () => reqs.some((r) => r.p === "/owners/bookings-history" && r.q.includes("statuses=status_pending")), 10000);
    const h = reqs.filter((r) => r.p === "/owners/bookings-history" && r.q.includes("statuses=status_pending")).pop();
    const sp = h && new URLSearchParams(h.q);
    check("C.4 line opens History with status_pending, any date", h && sp.get("date_from") < addDays(pktToday, -30) && sp.get("date_to") > addDays(pktToday, 30), h && h.q);
    await bcard(page, "hp1").waitFor({ timeout: 10000 });
    await page.waitForTimeout(500);
    await shot(page, "s2-10-history");
    check("C.4 History status field shows 'Status baqi'", (await page.getByRole("button", { name: "Status: Status baqi" }).count()) === 1);
    check("C.3 History card shows the 'Status baqi' chip", (await bcard(page, "hp1").getByTestId("status-pending-chip").count()) === 1);
    await page.getByRole("button", { name: "Status: Status baqi" }).click();
    await page.getByText("Status chunein").first().waitFor({ timeout: 8000 });
    check("C.4 History status filter lists 'Status baqi'", (await page.getByRole("checkbox", { name: /Status baqi/ }).count()) >= 1 || (await page.getByText("Status baqi", { exact: true }).count()) >= 2);
    await ctx.close();
  }

  // Older backend: no permissions endpoint shape, no status fields -> nothing hidden, no chip, no line.
  {
    const state = defaultState();
    state.perms = [];
    const ov = state.overview;
    state.overview = () => {
      const o = ov();
      delete o.status_pending_count;
      o.rows = o.rows.map((r) => {
        const { status_pending, ...rest } = r;
        return rest;
      });
      return o;
    };
    const { ctx, page } = await setup(browser, state);
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 240000 });
    await page.getByTestId("total-slots-card").first().waitFor({ timeout: 180000 });
    await waitFor(async () => (await bcard(page, "bkp").count()) === 1, 15000);
    await page.waitForTimeout(800);
    check("compat: no line, no chip without the new fields", (await page.getByTestId("status-pending-line").count()) === 0 && (await page.getByTestId("status-pending-chip").count()) === 0);
    check("compat: bad permissions payload hides nothing", (await page.getByRole("button", { name: /^Booking completed:/ }).count()) === 4);
    await ctx.close();
  }

  check("no page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
  check("no browser dialogs (no Alert/confirm)", dialogs.length === 0, dialogs.join(" | "));
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
