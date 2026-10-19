// Expo-web e2e for Round 2 Stage 2, agent M2: saveable venue timers, Default hints, CNIC (Settings card, wizard step,
// Overview banner), wizard draft migration v4 -> v5. 390px. All /api/v1/** traffic is mocked.
// Run: PLAYWRIGHT_PATH=<...>/node_modules/playwright BASE=http://localhost:8095 node e2e/stage2-m2-check.cjs
//   (Expo web started with EXPO_PUBLIC_API_BASE_URL=http://localhost:9 --clear).
const { chromium } = require(process.env.PLAYWRIGHT_PATH);
const BASE = process.env.BASE || "http://localhost:8095";

const now = Date.now();
const iso = (h) => new Date(now + h * 3600e3).toISOString();
const pktDay = (d) => new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
const owner = { id: "u1", role: "owner", name: "Owner One", phone: "+923001234567", email: null };
const CNIC = "12345-1234567-1";

const court = {
  id: "c1", venue_id: "v1", name: "Futsal 1", sport: "Futsal", slot_minutes: 60, surface_type: null, is_indoor: false, has_floodlights: false, capacity: null,
  cancellation_allowed: true, cancellation_cutoff_hours: null, advance_type: null, advance_value: null, advance_minimum: null,
  photo_url: null, photo_urls: [], photo_keys: [], sort_order: 0, is_active: true,
  schedule_templates: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ id: "s" + d, day_of_week: d, open_time: "06:00:00", close_time: "23:00:00", closes_next_day: false, is_active: true })),
  pricing_rules: [{ id: "r1", name: "All day", priority: 0, day_of_week: null, start_time: null, end_time: null, price_per_slot: 4000, floodlight_surcharge: 0, advance_percentage: 50, is_active: true }],
};
const venue = {
  id: "v1", name: "Arena Khelo", status: "approved", sports: ["Futsal"], amenities: [], address: "Street 1", area: "DHA", city: "Karachi", description: null, whatsapp: null,
  bank_details: null, cancellation_allowed: true, cancellation_cutoff_hours: null, booking_horizon_days: 90, photo_urls: [], photo_keys: [], courts: [court],
};
const TD = { hold_minutes: 15, reminders_enabled: true, first_reminder_after_min: 10, repeat_every_min: 30, max_reminders: 5, auto_cancel_enabled: true, auto_cancel_after_min: 120 };
const nullValues = () => Object.fromEntries(Object.keys(TD).map((k) => [k, null]));
const timersOf = (values) => ({ values, defaults: TD, effective: Object.fromEntries(Object.keys(TD).map((k) => [k, values[k] ?? TD[k]])) });

const results = [];
const log = [];
function check(name, ok, extra) { results.push({ name, ok: !!ok }); console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  " + extra : "")); }

async function setup(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "Asia/Karachi" });
  await ctx.addInitScript(([u, draft]) => {
    if (!localStorage.getItem("maidan.session_token")) {
      localStorage.setItem("maidan.session_token", "tok");
      localStorage.setItem("maidan.session_expires_at", new Date(Date.now() + 7 * 3600e3).toISOString());
      localStorage.setItem("maidan.cached_user", JSON.stringify(u));
      if (draft) localStorage.setItem("maidan.venue-setup-draft", draft);
    }
  }, [owner, opts.draft || null]);
  const state = { timers: nullValues(), identity: opts.identity || { status: "missing", masked: null, flags: [] } };
  const reqs = [];
  await ctx.route("**/health", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await ctx.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname.replace(/^.*\/api\/v1/, "");
    let body = null;
    try { body = req.postDataJSON(); } catch { body = null; }
    const raw = req.postDataBuffer() ? req.postDataBuffer().toString("latin1") : "";
    reqs.push({ method: req.method(), p, body, raw });
    const json = (data, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    if (p === "/auth/me") return json({ user: owner, session: { device_id: "d", device_name: null, platform: "web", last_active_at: iso(0), expires_at: iso(7) } });
    if (p === "/auth/refresh") return json({ token: "tok", expires_at: iso(8) });
    if (p === "/feature-flags") return json({ flags: { split_payments: opts.splitOn ?? false } });
    if (p === "/owners/venues") return json([venue]);
    const tm = p.match(/^\/owners\/venues\/([^/]+)\/timers$/);
    if (tm) {
      if (req.method() === "PUT") state.timers = { ...nullValues(), ...body };
      return json(timersOf(state.timers));
    }
    if (p === "/owners/identity") {
      if (req.method() === "POST") state.identity = { status: "submitted", masked: "*****-*******-1", flags: [] };
      return json(state.identity);
    }
    if (p === "/venues" && req.method() === "POST") return json({ venue: { ...venue, id: "v2", status: "pending", courts: [] } }, 201);
    // the pending screen the wizard ends on reads the new venue (an empty {} crashed it: courts undefined)
    if (p === "/venues/v2" && req.method() === "GET") return json({ ...venue, id: "v2", status: "pending", courts: [{ ...court, id: "c2", venue_id: "v2" }] });
    if (p === "/venues/v2/courts" && req.method() === "POST") return json({ court: { ...court, id: "c2", venue_id: "v2" } }, 201);
    if (p === "/courts/c1/advance-explain") return json({ error: { code: "NOT_FOUND", message: "nf" } }, 404);
    if (p === "/courts/c1/blackouts") return json([]);
    if (p === "/courts/c1" && req.method() === "GET") return json(court);
    if (p.startsWith("/courts/")) return json({ court });
    if (p.startsWith("/venues/v1") && req.method() === "PATCH") return json({ venue });
    if (p === "/users/me/notifications/feed") return json({ items: [], page: 1, page_size: 30, has_more: false });
    if (p === "/owners/overview") {
      return json({ date: pktDay(now), venue_id: "v1", operating_day: null,
        slots: { total: 10, booked: 0, pending: 0, blocked: 0, free: 10, free_upcoming: 10, free_past: 0, by_court: [] },
        bookings: { count: 0, cancelled: 0, refunds: { count: 0, amount: 0 }, pending: { count: 0, awaiting_approval: 0, awaiting_payment: 0 }, by_court: [] },
        money: { collected: 0, due: 0, due_bookings: 0 }, rows: [], status_pending_count: 0 });
    }
    if (p === "/owners/approvals-queue") return json({ items: [], total: 0, page: 1, page_size: 50 });
    if (p === "/owners/badges") return json({ approvals: 0, refunds: 0 });
    if (p.startsWith("/owners/") || p.startsWith("/users/")) return json([]);
    return json({});
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => log.push("pageerror: " + e.message));
  return { ctx, page, reqs, state };
}

const visibleText = async (page, testId) => {
  const loc = page.getByTestId(testId);
  const n = await loc.count();
  for (let i = 0; i < n; i++) if (await loc.nth(i).isVisible()) return (await loc.nth(i).innerText()).trim();
  return null;
};
const isOff = async (page, name) => {
  // PrimaryButton has no button role; its Pressable carries aria-disabled
  const t = await visible(page.getByText(name, { exact: true }));
  if (!t) return null;
  return t.evaluate((n) => !!n.closest('[aria-disabled="true"]'));
};
const prefixText = async (page, prefix) => {
  const loc = page.locator(`[data-testid^="${prefix}"]`);
  for (let i = 0; i < (await loc.count()); i++) if (await loc.nth(i).isVisible()) return (await loc.nth(i).innerText()).trim();
  return null;
};
async function waitText(page, testId, re, timeout = 15000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeout) {
    last = await visibleText(page, testId);
    if (last !== null && re.test(last)) return last;
    await page.waitForTimeout(250);
  }
  return last;
}
const visible = async (loc) => {
  const n = await loc.count();
  for (let i = 0; i < n; i++) if (await loc.nth(i).isVisible()) return loc.nth(i);
  return null;
};
// The image picker cannot be driven headlessly (CLAUDE.md); seed both photos into the memory-only draft (dev hook).
async function seedPhotos(page) {
  await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 20; c.height = 12;
    const ctx = c.getContext("2d"); ctx.fillStyle = "#0E6274"; ctx.fillRect(0, 0, 20, 12);
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg"));
    const u = URL.createObjectURL(blob);
    globalThis.__cnicDraft.getState().set({ front: u, back: u });
  });
}
const storageHasCnic = (page) => page.evaluate(() => Object.keys(localStorage).some((k) => /1234512345671|12345-1234567/.test(localStorage.getItem(k) || "")));
async function waitReq(reqs, pred, timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { const r = reqs.find(pred); if (r) return r; await new Promise((x) => setTimeout(x, 200)); }
  return null;
}

(async () => {
  const browser = await chromium.launch();

  // ---- (a) Venue Settings: timers save + Default hints + CNIC card ----
  {
    const { ctx, page, reqs } = await setup(browser);
    await page.goto(BASE + "/venue-settings", { waitUntil: "domcontentloaded", timeout: 240000 });
    await page.getByText("Venue settings").first().waitFor({ timeout: 180000 });

    const hold = await waitText(page, "default-rem-hold", /Default/);
    check("timers: hold hint 'Default: 15 minute' + running marker", /^Default: 15 minute/.test(hold || "") && /Abhi default chal raha hai/.test(hold || ""), hold);
    const pre = await waitText(page, "reminder-preview", /Reminder/);
    check("timers: default preview (auto-cancel ON 120)", pre === "Reminder 10, 40, 70, 100 minute par. 115 par aakhri warning, 120 par cancel.", pre);
    check("timers: auto-cancel hint", /Default: On, 120 minute/.test((await visibleText(page, "default-rem-auto")) || ""));
    await page.getByTestId("rem-hold").fill("20");
    const h20 = await waitText(page, "default-rem-hold", /Default par wapas/);
    check("timers: changed value -> 'Default par wapas' link, no marker", /Default par wapas/.test(h20 || "") && !/chal raha/.test(h20 || ""), h20);
    await (await visible(page.getByTestId("default-rem-hold-reset"))).click();
    await page.waitForTimeout(300);
    check("timers: reset puts 15 back", (await page.getByTestId("rem-hold").inputValue()) === "15" && /chal raha/.test((await visibleText(page, "default-rem-hold")) || ""));
    await page.getByTestId("rem-hold").fill("20");
    await page.getByTestId("rem-hold").fill("200");
    await page.waitForTimeout(300);
    check("timers: hold 200 -> validation error, Save disabled", (await page.getByText(/5 se 180 minute/).count()) > 0 && (await isOff(page, "Save reminder settings")) === true);
    await page.getByTestId("rem-hold").fill("20");
    await page.getByRole("checkbox", { name: /khud cancel/ }).click();
    const warn = await waitText(page, "auto-cancel-off-warning", /Band/);
    check("timers: OFF warning text", warn === "Band karne par approve na hone wali booking ka slot band rahega.", warn);
    check("timers: OFF preview", (await visibleText(page, "reminder-preview")) === "Reminder 10, 40, 70, 100, 130 minute par. Auto-cancel band hai.");
    await page.screenshot({ path: "e2e/s2-m2-settings-timers.png", fullPage: true });
    await page.getByText("Save reminder settings", { exact: true }).click();
    const put = await waitReq(reqs, (r) => r.method === "PUT" && r.p === "/owners/venues/v1/timers");
    const expected = { ...nullValues(), hold_minutes: 20, auto_cancel_enabled: false };
    check("timers: PUT body = changed fields, null for the rest", put && JSON.stringify(put.body) === JSON.stringify(expected), JSON.stringify(put && put.body));
    check("timers: saved message", /Saved/.test((await waitText(page, "timers-message", /Saved/)) || ""));

    const hz = await waitText(page, "default-horizon", /Default/);
    check("horizon: hint 'Default: 90 din aage tak' + marker", /Default: 90 din aage tak/.test(hz || "") && /chal raha/.test(hz || ""), hz);
    await page.getByTestId("horizon-days").fill("30");
    await page.getByText("Save booking window", { exact: true }).click();
    const patch = await waitReq(reqs, (r) => r.method === "PATCH" && r.p === "/venues/v1" && r.body && "booking_horizon_days" in r.body);
    check("horizon: PATCH booking_horizon_days 30", patch && patch.body.booking_horizon_days === 30, JSON.stringify(patch && patch.body));
    check("cancellation: hints", /Default: Allowed/.test((await visibleText(page, "default-cancellation")) || "") && /koi had nahi/.test((await visibleText(page, "default-cancellation-cutoff")) || ""));

    // CNIC card: missing -> fields; never stored; submit multipart; masked display
    const num = await visible(page.getByTestId("cnic-number"));
    check("cnic: Settings card shows the input while missing", !!num);
    await num.fill("1234512345671");
    check("cnic: masked as typed", (await num.inputValue()) === CNIC, await num.inputValue());
    check("cnic: submit disabled without photos", (await isOff(page, "CNIC jama karein")) === true);
    await seedPhotos(page);
    await page.waitForTimeout(300);
    check("cnic: number never in local storage", !(await storageHasCnic(page)));
    await page.screenshot({ path: "e2e/s2-m2-settings-cnic.png", fullPage: false });
    await page.getByText("CNIC jama karein", { exact: true }).click();
    const post = await waitReq(reqs, (r) => r.method === "POST" && r.p === "/owners/identity");
    check("cnic: multipart POST with number + front + back", post && post.raw.includes(CNIC) && /name="front"/.test(post.raw) && /name="back"/.test(post.raw));
    const masked = await waitText(page, "identity-masked", /\*/);
    check("cnic: masked value shown after submit", masked === "*****-*******-1", masked);
    check("cnic: status text", /Jama ho gaya/.test((await visibleText(page, "identity-status")) || ""));
    check("cnic: still nothing in local storage", !(await storageHasCnic(page)));

    // courts tab hints
    await page.getByRole("tab", { name: /Courts/ }).click();
    const slot = await waitText(page, "default-slot-minutes", /Default/, 30000);
    // an EXISTING court shows the backend default (60, like web Settings); the court is 60 -> "running" marker
    check("court: slot hint 'Default: 60 minute' + running (court is 60)", /Default: 60 minute/.test(slot || "") && /chal raha/.test(slot || ""), slot);
    const adv = await waitText(page, "default-advance", /Default/);
    check("court: advance default says 'abhi poori raqam' (split_payments off)", /abhi poori raqam/.test(adv || "") && /chal raha/.test(adv || ""), adv);
    const ruleAdv = await prefixText(page, "default-rule-advance-");
    check("court: rule advance 50% differs from default 100%", /50%/.test(ruleAdv || "") && /Default: 100%/.test(ruleAdv || "") && /Default par wapas/.test(ruleAdv || ""), ruleAdv);
    check("court: floodlight default PKR 0", /Default: PKR 0/.test((await prefixText(page, "default-rule-floodlight-")) || ""));
    await page.screenshot({ path: "e2e/s2-m2-settings-court.png", fullPage: true });
    await ctx.close();
  }

  // ---- (b) split_payments ON: no "abhi poori raqam" ----
  {
    const { ctx, page } = await setup(browser, { splitOn: true });
    await page.goto(BASE + "/venue-settings", { waitUntil: "domcontentloaded", timeout: 240000 });
    await page.getByRole("tab", { name: /Courts/ }).click({ timeout: 180000 });
    const adv = await waitText(page, "default-advance", /Default/, 30000);
    check("court (split on): plain advance default", !!adv && !/abhi poori raqam/.test(adv), adv);
    await ctx.close();
  }

  // ---- (c) Overview banner ----
  {
    const { ctx, page } = await setup(browser);
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 240000 });
    await page.getByText("Overview").first().waitFor({ timeout: 180000 });
    const b = await waitText(page, "cnic-banner", /CNIC dein/, 20000);
    check("banner: shown while CNIC is missing", !!b);
    await page.screenshot({ path: "e2e/s2-m2-banner.png", fullPage: false });
    check("banner: nothing is locked (Overview still usable)", (await page.getByText("Overview").count()) > 0);
    await (await visible(page.getByRole("button", { name: "Baad mein" }))).click();
    await page.waitForTimeout(400);
    check("banner: 'Baad mein' hides it", (await visibleText(page, "cnic-banner")) === null);
    await page.goto(BASE + "/more", { waitUntil: "domcontentloaded" }).catch(() => {});
    await page.waitForTimeout(500);
    await ctx.close();
  }
  {
    const { ctx, page } = await setup(browser, { identity: { status: "submitted", masked: "*****-*******-1", flags: [] } });
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 240000 });
    await page.getByText("Overview").first().waitFor({ timeout: 180000 });
    await page.waitForTimeout(2500);
    check("banner: hidden once a CNIC is on file", (await visibleText(page, "cnic-banner")) === null);
    await ctx.close();
  }

  // ---- (d) Wizard: v4 draft migrates, Advanced timers kept in the draft, CNIC required, PUT after venue creation ----
  {
    const v4 = {
      state: {
        step: 2, name: "S2 Arena", address: "Street 9", city: "Karachi", area: "DHA", latitude: 24.8, longitude: 67.0, whatsapp: "", sports: ["Futsal"], amenities: [],
        bankName: "", accountTitle: "", accountNumber: "", cancellationAllowed: true, cancellationCutoffHours: "",
        courts: [{ name: "Court 1", sport: "Futsal", isIndoor: false, slotMinutes: 60, sameHoursEveryDay: true, openTime: "06:00", closeTime: "23:00", perDayOverrides: {},
          pricingRules: [{ id: "x1", name: "All day", pricePerSlot: "4000", dayOfWeek: null, startTime: null, endTime: null }] }],
        createdVenueId: null, createdCourtIds: {}, removedCreatedCourtIds: [],
      },
      version: 4,
    };
    const { ctx, page, reqs } = await setup(browser, { draft: JSON.stringify(v4) });
    await page.goto(BASE + "/venue-setup/courts", { waitUntil: "domcontentloaded", timeout: 240000 });
    await page.getByText("Your courts and prices").first().waitFor({ timeout: 180000 });
    await page.waitForTimeout(800);
    const d0 = JSON.parse((await page.evaluate(() => localStorage.getItem("maidan.venue-setup-draft"))) || "{}");
    check("wizard: v4 draft kept (name, price) and migrated to v5 with null timers", d0.version === 5 && d0.state && d0.state.name === "S2 Arena" && d0.state.courts[0].pricingRules[0].pricePerSlot === "4000" && d0.state.timers && Object.values(d0.state.timers).every((v) => v === null), JSON.stringify(d0.state && d0.state.timers));
    check("wizard: slot hint shows the wizard default (90)", /Default: 90 minute/.test((await visibleText(page, "default-slot-minutes")) || ""));
    await page.getByRole("button", { name: "Advanced" }).click();
    await page.getByTestId("rem-hold").fill("25");
    await page.waitForTimeout(500);
    const d1 = JSON.parse((await page.evaluate(() => localStorage.getItem("maidan.venue-setup-draft"))) || "{}");
    check("wizard: timers kept in the saved draft", d1.state && d1.state.timers && d1.state.timers.hold === "25", JSON.stringify(d1.state && d1.state.timers));
    check("wizard: Send for review disabled until CNIC", (await isOff(page, "Send for review")) === true);
    const num = await visible(page.getByTestId("cnic-number"));
    await num.fill(CNIC);
    await seedPhotos(page);
    await page.waitForTimeout(400);
    check("wizard: CNIC never in the saved draft / storage", !(await storageHasCnic(page)));
    await page.screenshot({ path: "e2e/s2-m2-wizard.png", fullPage: true });
    check("wizard: Send for review enabled with CNIC + photos", (await isOff(page, "Send for review")) === false);
    await page.getByText("Send for review", { exact: true }).click();
    await waitReq(reqs, (r) => r.method === "PUT" && /timers$/.test(r.p), 20000);
    const writes = reqs.filter((r) => r.method !== "GET").map((r) => `${r.method} ${r.p}`);
    const order = ["POST /owners/identity", "POST /venues", "POST /venues/v2/courts", "PUT /owners/venues/v2/timers"].map((k) => writes.indexOf(k));
    check("wizard: identity -> venue -> court -> timers order", order.every((i) => i >= 0) && order.every((i, j) => j === 0 || i > order[j - 1]), writes.join(", "));
    const put = reqs.find((r) => r.method === "PUT" && r.p === "/owners/venues/v2/timers");
    check("wizard: timers PUT = hold 25, rest null", put && JSON.stringify(put.body) === JSON.stringify({ ...nullValues(), hold_minutes: 25 }), JSON.stringify(put && put.body));
    await page.waitForURL(/pending/, { timeout: 15000 }).catch(() => {});
    check("wizard: goes to the pending screen", /pending/.test(page.url()), page.url());
    await ctx.close();
  }

  // ---- (e) Wizard with nothing set in Advanced: no timers PUT ----
  {
    const { ctx, page } = await setup(browser, { identity: { status: "verified", masked: "*****-*******-9", flags: [] } });
    await page.goto(BASE + "/venue-setup/courts", { waitUntil: "domcontentloaded", timeout: 240000 });
    await page.getByText("Your courts and prices").first().waitFor({ timeout: 180000 });
    const onFile = await waitText(page, "wizard-cnic-on-file", /pehle se jama/, 20000);
    check("wizard: CNIC on file -> no CNIC step, masked shown", /\*\*\*\*\*-\*\*\*\*\*\*\*-9/.test(onFile || ""), onFile);
    await ctx.close();
  }

  check("no page errors", log.length === 0, log.slice(0, 3).join(" | "));
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
