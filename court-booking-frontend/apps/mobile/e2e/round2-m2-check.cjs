// Expo-web e2e for Owner Round 2, agent M2: advance settings (Venue Settings + onboarding), payment-reminders preview,
// the notifications list behind the bell (owner + player) and the bell badge on the feed.
// Run: PLAYWRIGHT_PATH=<...>/node_modules/playwright BASE=http://localhost:8085 node e2e/round2-m2-check.cjs
//   (Expo web started with EXPO_PUBLIC_API_BASE_URL=http://localhost:9 --clear). All /api/v1/** traffic is mocked.
const { chromium } = require(process.env.PLAYWRIGHT_PATH);
const BASE = process.env.BASE || "http://localhost:8085";

const now = Date.now();
const iso = (h) => new Date(now + h * 3600e3).toISOString();
const minAgo = (m) => new Date(now - m * 60e3).toISOString();
const pktDay = (d) => new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
const owner = { id: "u1", role: "owner", name: "Owner One", phone: "+923001234567", email: null };
const player = { id: "p1", role: "player", name: "Player One", phone: "+923007654321", email: null };

const court = {
  id: "c1", venue_id: "v1", name: "Futsal 1", sport: "Futsal", slot_minutes: 60, surface_type: null, is_indoor: false, has_floodlights: false, capacity: null,
  cancellation_allowed: true, cancellation_cutoff_hours: null, advance_type: null, advance_value: null, advance_minimum: null,
  photo_url: null, photo_urls: [], photo_keys: [], sort_order: 0, is_active: true,
  schedule_templates: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ id: "s" + d, day_of_week: d, open_time: "06:00:00", close_time: "23:00:00", closes_next_day: false, is_active: true })),
  pricing_rules: [{ id: "r1", name: "All day", priority: 0, day_of_week: null, start_time: null, end_time: null, price_per_slot: 4000, floodlight_surcharge: 0, advance_percentage: 100, is_active: true }],
};
const venue = {
  id: "v1", name: "Arena Khelo", status: "approved", sports: ["Futsal"], amenities: [], address: "Street 1", area: "DHA", city: "Karachi", description: null, whatsapp: null,
  bank_details: null, cancellation_allowed: true, cancellation_cutoff_hours: null, photo_urls: [], photo_keys: [], courts: [court],
};
const explain = {
  mode: "default", value: null, minimum: null, hourly_price: 4000, example_minutes: 60, example_total: 4000, example_advance: 4000,
  default_rule: { source: "pricing_rule", percentage: 100, value_if_nothing_set: 4000 },
};

const SLOT = iso(5);
const feedItems = () => [
  { id: "f1", event_type: "payment_submitted", kind: "payment_waiting", created_at: minAgo(5),
    params: { player_name: "Abbas Zafar", court_name: "Futsal 1", starts_at: SLOT, ends_at: iso(6), amount: 2000 },
    link: { kind: "approvals" }, deliveries: [{ channel: "push", status: "sent" }, { channel: "whatsapp", status: "sent" }] },
  { id: "f2", event_type: "owner_new_booking", kind: "new_booking", created_at: minAgo(40),
    params: { player_name: "Usman Tariq", court_name: "Futsal 1", starts_at: SLOT, ends_at: iso(6) },
    link: { kind: "booking", booking_id: "b-77" }, deliveries: [{ channel: "push", status: "sent" }] },
  { id: "f3", event_type: "refund_owed", kind: "refund_owed", created_at: iso(-20),
    params: { player_name: "Mujtaba Anwer", court_name: "Padel 1", amount: 1500 }, link: { kind: "refunds" }, deliveries: [{ channel: "whatsapp", status: "failed" }, { channel: "sms", status: "sent" }] },
  { id: "f4", event_type: "some_new_event", kind: "other", created_at: iso(-80), params: {}, link: { kind: "none" }, deliveries: [] },
];

const results = [];
const log = [];
function check(name, ok, extra) { results.push({ name, ok: !!ok }); console.log((ok ? "PASS " : "FAIL ") + name + (extra ? "  " + extra : "")); }

async function setup(browser, opts = {}) {
  const user = opts.user || owner;
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
    let body = null;
    try { body = req.postDataJSON(); } catch { body = null; }
    reqs.push({ method: req.method(), p, q: url.search, body });
    const json = (data, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    if (p === "/auth/me") return json({ user, session: { device_id: "d", device_name: null, platform: "web", last_active_at: iso(0), expires_at: iso(7) } });
    if (p === "/auth/refresh") return json({ token: "tok", expires_at: iso(8) });
    if (p === "/owners/venues") return json([venue]);
    if (p === "/courts/c1/advance-explain") return opts.noExplain ? json({ error: { code: "NOT_FOUND", message: "nf" } }, 404) : json(explain);
    if (p === "/courts/c1/blackouts") return json([]);
    if (p === "/courts/c1" && req.method() === "GET") return json(court);
    if (p.startsWith("/courts/")) return json({ court });
    if (p === "/users/me/notifications/feed") {
      if (opts.feed404) return json({ error: { code: "NOT_FOUND", message: "Not Found" } }, 404);
      const items = (opts.feed || feedItems)();
      return json({ items, page: 1, page_size: 30, has_more: false });
    }
    if (p === "/users/me/notifications") return json(opts.log ? opts.log() : []);
    if (p === "/owners/overview") {
      return json({ date: pktDay(now), venue_id: "v1", operating_day: null,
        slots: { total: 10, booked: 0, pending: 0, blocked: 0, free: 10, free_upcoming: 10, free_past: 0, by_court: [] },
        bookings: { count: 0, cancelled: 0, refunds: { count: 0, amount: 0 }, pending: { count: 0, awaiting_approval: 0, awaiting_payment: 0 }, by_court: [] },
        money: { collected: 0, due: 0, due_bookings: 0 }, rows: [] });
    }
    if (p === "/owners/approvals-queue") return json({ items: [], total: 0, page: 1, page_size: 50 });
    if (p === "/owners/badges") return json({ approvals: 0, refunds: 0 });
    if (p === "/owners/bookings-history") return json({ items: [], total: 0, page: 1, page_size: 20, totals: { count: 0, total: 0, collected: 0, due: 0 } });
    if (p.startsWith("/owners/") || p.startsWith("/users/")) return json([]);
    return json({});
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => log.push("pageerror: " + e.message));
  return { ctx, page, reqs };
}

const visibleText = async (page, testId) => {
  const loc = page.getByTestId(testId);
  const n = await loc.count();
  for (let i = 0; i < n; i++) if (await loc.nth(i).isVisible()) return (await loc.nth(i).innerText()).trim();
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
async function fillByLabel(page, label, value) {
  // FieldLabel renders the label as plain text above the input; the input is the next textbox in the same block.
  const lbl = page.getByText(label, { exact: true }).first();
  const input = lbl.locator("xpath=following::input[1]");
  await input.fill(value);
}
const badgeText = async (page) => {
  const b = page.getByTestId("bell-badge");
  return (await b.count()) ? (await b.first().innerText()).trim() : null;
};

(async () => {
  const browser = await chromium.launch();

  // ---- (a) Venue Settings: reminders preview + advance ----
  {
    const { ctx, page, reqs } = await setup(browser);
    await page.goto(BASE + "/venue-settings", { waitUntil: "domcontentloaded", timeout: 240000 });
    await page.getByText("Venue settings").first().waitFor({ timeout: 180000 });
    const pre = await waitText(page, "reminder-preview", /Reminder/);
    check("settings: reminders preview with defaults", pre === "Reminder 10, 40, 70, 100, 130 minute par. Auto-cancel band hai.", pre);
    check("settings: 'not saved yet' note", /jald aa raha hai/.test((await visibleText(page, "reminders-note")) || ""));
    await page.getByRole("checkbox", { name: /khud cancel/ }).click();
    const y120 = await waitText(page, "reminder-preview", /120 par cancel/);
    check("settings: Y=120 preview", y120 === "Reminder 10, 40, 70, 100 minute par. 115 par aakhri warning, 120 par cancel.", y120);
    check("settings: auto-cancel warning shown", (await page.getByText(/asal mein paisa bhej diya/).count()) > 0);
    await page.getByTestId("rem-cancel").fill("30");
    const y30 = await waitText(page, "reminder-preview", /30 par cancel/);
    check("settings: Y=30 preview", y30 === "Reminder 10 minute par. 25 par aakhri warning, 30 par cancel.", y30);
    await page.getByTestId("rem-every").fill("2");
    await page.waitForTimeout(400);
    check("settings: validation error for every=2, preview hidden", (await page.getByText(/kam az kam 5 minute/).count()) > 0 && (await visibleText(page, "reminder-preview")) === null);
    await page.getByTestId("rem-every").fill("30");
    await page.screenshot({ path: "e2e/m2-settings-reminders.png", fullPage: true });

    await page.getByRole("tab", { name: /Courts/ }).click();
    const def = await waitText(page, "advance-default", /Agar aap kuch set na karein/, 30000);
    check("settings: real default line from advance-explain", def === "Agar aap kuch set na karein: player poori raqam (100%) abhi dega - 1 ghante ki booking (PKR 4,000) par PKR 4,000.", def);
    check("settings: advance-explain was called", reqs.some((r) => r.p === "/courts/c1/advance-explain"));
    const ex0 = await visibleText(page, "advance-example");
    check("settings: default example from the real price", ex0 === "Court ka 1 ghante ka rate PKR 4,000 - default 100% -> player abhi PKR 4,000 dega", ex0);
    await page.getByText("Percentage", { exact: true }).first().click();
    await fillByLabel(page, "Total ka percentage (%)", "50");
    const ex = await waitText(page, "advance-example", /50%/);
    check("settings: live example 50%", ex === "Court ka 1 ghante ka rate PKR 4,000 - 50% -> player abhi PKR 2,000 dega, baqi PKR 2,000 venue par", ex);
    await page.screenshot({ path: "e2e/m2-settings-advance.png", fullPage: true });
    await page.getByText("Save changes", { exact: true }).click();
    await page.waitForTimeout(1500);
    const patch = reqs.find((r) => r.method === "PATCH" && r.p === "/courts/c1" && r.body && "advance_type" in r.body);
    check("settings: save sends the advance through the existing court update", patch && patch.body.advance_type === "percent" && patch.body.advance_value === 50 && patch.body.advance_minimum === null, JSON.stringify(patch && patch.body));
    await ctx.close();
  }
  // settings without the explain endpoint (older backend): computed default, nothing breaks
  {
    const { ctx, page } = await setup(browser, { noExplain: true });
    await page.goto(BASE + "/venue-settings", { waitUntil: "domcontentloaded", timeout: 240000 });
    await page.getByRole("tab", { name: /Courts/ }).click({ timeout: 180000 });
    const def = await waitText(page, "advance-default", /Agar aap/, 30000);
    check("settings (no explain endpoint): computed default line", def === "Agar aap kuch set na karein: player poori raqam (100%) abhi dega - 1 ghante ki booking (PKR 4,000) par PKR 4,000.", def);
    await ctx.close();
  }

  // ---- (b) Onboarding wizard court step: same advance editor + Advanced reminders ----
  {
    const { ctx, page, reqs } = await setup(browser);
    await page.goto(BASE + "/venue-setup/courts", { waitUntil: "domcontentloaded", timeout: 240000 });
    await page.getByText("Your courts and prices").first().waitFor({ timeout: 180000 });
    const def0 = await waitText(page, "advance-default", /Agar aap/);
    check("wizard: default line before a price", /pehle neeche price set karein/.test(def0 || ""), def0);
    await page.getByText("60 min", { exact: true }).first().click();
    await page.getByPlaceholder("2500").first().fill("4000");
    const def = await waitText(page, "advance-default", /PKR 4,000/);
    check("wizard: computed default line (same text as settings)", def === "Agar aap kuch set na karein: player poori raqam (100%) abhi dega - 1 ghante ki booking (PKR 4,000) par PKR 4,000.", def);
    await page.getByText("Percentage", { exact: true }).first().click();
    await fillByLabel(page, "Total ka percentage (%)", "50");
    const ex = await waitText(page, "advance-example", /50%/);
    check("wizard: live example 50% (same as settings)", ex === "Court ka 1 ghante ka rate PKR 4,000 - 50% -> player abhi PKR 2,000 dega, baqi PKR 2,000 venue par", ex);
    const draft = await page.evaluate(() => localStorage.getItem("maidan.venue-setup-draft"));
    check("wizard: advance choice kept in the saved draft", !!draft && /"advanceType":"percent"/.test(draft) && /"advanceValue":"50"/.test(draft));
    check("wizard: reminders hidden until Advanced is opened", (await visibleText(page, "reminder-preview")) === null);
    await page.getByRole("button", { name: "Advanced" }).click();
    const pre = await waitText(page, "reminder-preview", /Reminder/);
    check("wizard: Advanced shows the same reminders preview", pre === "Reminder 10, 40, 70, 100, 130 minute par. Auto-cancel band hai.", pre);
    await page.getByRole("checkbox", { name: /khud cancel/ }).click();
    await page.getByTestId("rem-cancel").fill("30");
    const y30 = await waitText(page, "reminder-preview", /30 par cancel/);
    check("wizard: Y=30 preview", y30 === "Reminder 10 minute par. 25 par aakhri warning, 30 par cancel.", y30);
    await page.screenshot({ path: "e2e/m2-wizard.png", fullPage: true });
    check("wizard: nothing was sent to the API yet", !reqs.some((r) => r.method !== "GET"));
    await ctx.close();
  }

  // ---- (c) Owner notifications list + badge on the feed ----
  {
    const { ctx, page, reqs } = await setup(browser);
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 240000 });
    await page.getByText("Overview").first().waitFor({ timeout: 180000 });
    // f1 (5 min), f2 (40 min), f3 (20 h) are inside the first-visit 24 h window; f4 (80 h) is not
    const t0 = Date.now();
    while (Date.now() - t0 < 30000 && (await badgeText(page)) !== "3") await page.waitForTimeout(300);
    check("badge: counts feed items (3 in the last 24 h)", (await badgeText(page)) === "3", "got " + (await badgeText(page)));
    check("badge: reads the feed endpoint", reqs.some((r) => r.p === "/users/me/notifications/feed"));
    await page.getByLabel("Notifications").first().click();
    await page.getByTestId("notif-row").first().waitFor({ timeout: 30000 });
    const body = await page.locator("body").innerText();
    check("list: never 'New notification'", !/new notification/i.test(body));
    check("list: payment sentence + context", /Naya payment approval ke liye/.test(body) && /Abbas Zafar/.test(body) && /PKR 2,000/.test(body));
    check("list: muted delivery line", /WhatsApp/.test(body) && /bheja gaya/.test(body));
    const days = await page.getByTestId("notif-day").allInnerTexts();
    check("list: grouped by day (Aaj first)", days.length >= 2 && days[0].trim().toLowerCase() === "aaj", days.join(" | "));
    const rows = await page.getByTestId("notif-row").count();
    check("list: all 4 items", rows === 4, String(rows));
    check("list: unread dots for the 3 new ones", (await page.getByTestId("notif-unread-dot").count()) === 3, String(await page.getByTestId("notif-unread-dot").count()));
    await page.screenshot({ path: "e2e/m2-notifications.png", fullPage: true });
    await page.getByRole("button", { name: "Sab parh liye" }).click();
    await page.waitForTimeout(400);
    check("list: 'Sab parh liye' clears the dots", (await page.getByTestId("notif-unread-dot").count()) === 0);
    await page.getByTestId("notif-row").first().click();
    await page.waitForURL(/approvals/, { timeout: 15000 });
    check("list: tap payment -> Approvals", /approvals/.test(page.url()));
    await page.waitForTimeout(800);
    check("badge: cleared after opening the list", (await badgeText(page)) === null, "got " + (await badgeText(page)));
    await page.goto(BASE + "/notifications", { waitUntil: "domcontentloaded" });
    await page.getByTestId("notif-row").nth(1).waitFor({ timeout: 60000 });
    await page.getByTestId("notif-row").nth(1).click();
    await page.waitForURL(/history/, { timeout: 15000 });
    const u = new URL(page.url());
    check("list: tap booking -> History with the booking param", u.searchParams.get("booking") === "b-77" && u.searchParams.get("from") === pktDay(SLOT), page.url());
    await ctx.close();
  }

  // ---- (d) Fallback to the old endpoint when the feed 404s ----
  {
    const entry = (id, type, at, ref, channel = "push") => ({ id, channel, event_type: type, status: "sent", reference_id: ref, created_at: at });
    const logRows = [entry("n1", "booking_confirmed", minAgo(10), "b1"), entry("n1b", "booking_confirmed", minAgo(9), "b1", "whatsapp"), entry("n2", "payment_submitted", minAgo(120), "b2")];
    const { ctx, page, reqs } = await setup(browser, { feed404: true, log: () => logRows });
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 240000 });
    await page.getByText("Overview").first().waitFor({ timeout: 180000 });
    const t0 = Date.now();
    while (Date.now() - t0 < 30000 && (await badgeText(page)) !== "2") await page.waitForTimeout(300);
    check("fallback: badge from the old endpoint (folded)", (await badgeText(page)) === "2", "got " + (await badgeText(page)));
    await page.getByLabel("Notifications").first().click();
    await page.getByTestId("notif-row").first().waitFor({ timeout: 30000 });
    const body = await page.locator("body").innerText();
    check("fallback: 2 readable rows, no 'New notification'", (await page.getByTestId("notif-row").count()) === 2 && !/new notification/i.test(body), body.slice(0, 200).replace(/\n/g, " / "));
    const feedCalls = reqs.filter((r) => r.p === "/users/me/notifications/feed").length;
    await page.waitForTimeout(16000);
    check("fallback: stops asking for the missing feed", reqs.filter((r) => r.p === "/users/me/notifications/feed").length === feedCalls, String(feedCalls));
    await ctx.close();
  }

  // ---- (e) Player notifications ----
  {
    const items = () => [
      { id: "g1", event_type: "booking_confirmed", kind: "booking_confirmed", created_at: minAgo(3), params: { court_name: "Futsal 1", venue_name: "Arena Khelo", starts_at: SLOT, ends_at: iso(6) },
        link: { kind: "booking", booking_id: "b-9" }, deliveries: [{ channel: "push", status: "sent" }] },
    ];
    const { ctx, page } = await setup(browser, { user: player, feed: items });
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 240000 });
    await page.getByLabel("Notifications").first().waitFor({ timeout: 180000 });
    await page.getByLabel("Notifications").first().click();
    await page.getByTestId("notif-row").first().waitFor({ timeout: 30000 });
    const body = await page.locator("body").innerText();
    check("player: readable sentence, no 'New notification'", !/new notification/i.test(body) && /Futsal 1/.test(body), body.slice(0, 160).replace(/\n/g, " / "));
    await page.getByTestId("notif-row").first().click();
    await page.waitForURL(/bookings/, { timeout: 15000 });
    check("player: tap booking -> My bookings", /bookings/.test(page.url()));
    await ctx.close();
  }

  check("no page errors", log.length === 0, log.slice(0, 3).join(" | "));
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
