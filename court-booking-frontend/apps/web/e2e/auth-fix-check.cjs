#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Set-password dead end checks (plain Node + Playwright). LOCAL dev only: it needs DEBUG=true + DEV_FIXED_OTP on the backend and the seeded
 * accounts from seed-auth-users.py:
 *   SEED_JSON=seed.json BASE_URL=http://localhost:3000 API_URL=http://localhost:8000 node e2e/auth-fix-check.cjs
 * Run the LOCAL backend with relaxed per-IP limits for this test (every run shares one IP), e.g. PASSWORD_RESET_IP_MAX_ATTEMPTS=500 OTP_IP_MAX_DISTINCT_PHONES=500.
 * Scenarios, each at 360 / 768 / 1280 in en and ru:
 *  (a) an account with NO password: login -> straight to "set password" (never the verify page) -> code + password + confirm -> signed in,
 *  (b) a wrong code and an expired code: a clear error box (icon + accent bar), the field is cleared, nothing is set,
 *  (c) a normal account logs in as before, (d) a staff account created by the owner (with a password) logs in as before,
 *  (e) safety net: if the verify page's login says PASSWORD_NOT_SET it redirects to set-password instead of showing an error.
 */
const fs = require("fs");
const { loadPlaywright } = require("./smoke.cjs");

const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const API = (process.env.API_URL || "http://localhost:8000").replace(/\/+$/, "");
const seed = JSON.parse(fs.readFileSync(process.env.SEED_JSON || "seed.json", "utf8"));
const OTP = process.env.DEV_FIXED_OTP || "111111";
const NEW_PASSWORD = "NewPass12345";
const OWNER = { phone: "+923000000002", password: "demo-password-123" };
const PLAYER = { phone: "+923000000003", password: "demo-password-123" };

const NOTICE = {
  en: "No password is set for this number yet. Set a new password so you can log in.",
  ru: "Is number ke liye abhi password set nahi hai. Naya password set karo taake login ho sake.",
};
const results = [];
const record = (name, f) => results.push({ name, failures: f });
let guestIdx = 0;
let unverifiedIdx = 0;
const nextGuest = () => seed.guests[guestIdx++];
const nextUnverified = () => seed.unverified[unverifiedIdx++];
const national = (p) => p.replace(/^\+92/, "");

async function ctx(browser, width, lang) {
  const c = await browser.newContext({ viewport: { width, height: 900 } });
  await c.addCookies([{ name: "khelo_lang", value: lang, url: BASE }]);
  return c;
}

async function fillLogin(page, phone, password) {
  await page.goto(BASE + "/login", { waitUntil: "networkidle" });
  await page.locator("input[type=tel]").fill(national(phone));
  await page.locator("input[type=password]").first().fill(password);
  await page.locator("button[type=submit]").click();
}

const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

async function errorBoxStyle(page, f, label) {
  const box = page.locator('[role="alert"]').filter({ has: page.locator("svg") }).first();
  if ((await box.count()) < 1) return f.push(`${label}: no error box with an icon`);
  const st = await box.evaluate((el) => ({ left: parseFloat(getComputedStyle(el).borderLeftWidth), icon: el.querySelectorAll("svg").length, bg: getComputedStyle(el).backgroundColor }));
  if (st.left < 3) f.push(`${label}: no left accent bar on the error box`);
  if (st.bg === "rgb(255, 255, 255)" || st.bg === "rgba(0, 0, 0, 0)") f.push(`${label}: the error box has a plain/white background (looks like an input)`);
}

async function passwordLessFlow(browser, width, lang) {
  const f = [];
  const c = await ctx(browser, width, lang);
  const page = await c.newPage();
  const phone = nextGuest();
  await fillLogin(page, phone, "Whatever123");
  await page.waitForURL(/forgot-password/, { timeout: 8000 }).catch(() => {});
  if (!/forgot-password/.test(page.url())) f.push(`login went to ${page.url()} (expected the set-password step)`);
  if (/\/verify/.test(page.url())) f.push("landed on the verify page");
  const body = await page.evaluate(() => document.body.innerText);
  if (!body.includes(NOTICE[lang])) f.push("the set-password text is missing on the page");
  if ((await overflow(page)) > 1) f.push("horizontal scroll on the set-password page");
  await page.locator("button[type=submit]").click();
  await page.waitForURL(/reset-password/, { timeout: 8000 }).catch(() => {});
  if (!/reset-password/.test(page.url())) f.push(`no code page (${page.url()})`);
  // show / hide + labels
  const toggles = page.locator("main form button[aria-pressed]");
  if ((await toggles.count()) < 2) f.push("password fields have no Show/Hide buttons");
  else {
    const b = await toggles.first().boundingBox();
    if (!b || b.height < 43) f.push("Show/Hide is under 44px");
  }
  const labels = await page.locator("label").allInnerTexts();
  if (labels.length < 3) f.push(`only ${labels.length} labels on the set-password form`);
  // mismatch -> inline error (aria-live), then the right one
  const pw = page.locator("input[type=password]");
  await page.locator("input[inputmode=numeric], input[autocomplete=one-time-code]").first().fill(OTP);
  await pw.nth(0).fill(NEW_PASSWORD);
  await pw.nth(1).fill("Different12345");
  await pw.nth(1).blur();
  await page.waitForTimeout(300);
  if ((await page.locator('[role="alert"]').count()) < 1) f.push("no inline error for mismatched passwords");
  await pw.nth(1).fill(NEW_PASSWORD);
  await page.locator("button[type=submit]").click();
  await page.waitForTimeout(3500);
  if (/reset-password|forgot-password|\/login/.test(page.url())) f.push(`after setting the password the page is ${page.url()} (expected signed in)`);
  if ((await page.locator('[data-testid="profile-menu-button"]:visible, [data-testid="menu-toggle"]:visible').count()) < 1) f.push("no visible header controls after sign-in");
  const signedIn = await page.evaluate(() => !!localStorage.getItem("maidan.session_token"));
  if (!signedIn) f.push("no session after setting the password");
  await c.close();
  record(`(a) password-less account: set password then signed in (${lang} ${width})`, f);
}

async function wrongAndExpired(browser, width, lang) {
  let f = [];
  let c = await ctx(browser, width, lang);
  let page = await c.newPage();
  await fillLogin(page, nextGuest(), "x");
  await page.waitForURL(/forgot-password/, { timeout: 8000 }).catch(() => {});
  await page.locator("button[type=submit]").click();
  await page.waitForURL(/reset-password/, { timeout: 8000 }).catch(() => {});
  const code = page.locator("input[autocomplete=one-time-code]").first();
  const pw = page.locator("input[type=password]");
  await code.fill("000000");
  await pw.nth(0).fill(NEW_PASSWORD);
  await pw.nth(1).fill(NEW_PASSWORD);
  await page.locator("button[type=submit]").click();
  await page.waitForTimeout(1500);
  if (!/reset-password/.test(page.url())) f.push("a wrong code left the reset page");
  if ((await code.inputValue()) !== "") f.push("the wrong code was not cleared");
  await errorBoxStyle(page, f, "wrong code");
  const txt = await page.locator('[role="alert"]').first().innerText().catch(() => "");
  if (!txt.trim()) f.push("no error text for a wrong code");
  if ((await overflow(page)) > 1) f.push("horizontal scroll");
  await c.close();
  record(`(b1) wrong code (${lang} ${width})`, f);

  f = [];
  c = await ctx(browser, width, lang);
  page = await c.newPage();
  await fillLogin(page, nextGuest(), "x");
  await page.waitForURL(/forgot-password/, { timeout: 8000 }).catch(() => {});
  await page.locator("button[type=submit]").click();
  await page.waitForURL(/reset-password/, { timeout: 8000 }).catch(() => {});
  await page.route("**/api/v1/auth/verify-password-reset", (route) =>
    route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: { code: "OTP_EXPIRED", message: "OTP expired or not found", details: null } }) }),
  );
  await page.locator("input[autocomplete=one-time-code]").first().fill(OTP);
  const pw2 = page.locator("input[type=password]");
  await pw2.nth(0).fill(NEW_PASSWORD);
  await pw2.nth(1).fill(NEW_PASSWORD);
  await page.locator("button[type=submit]").click();
  await page.waitForTimeout(1200);
  await errorBoxStyle(page, f, "expired code");
  if (!/reset-password/.test(page.url())) f.push("an expired code left the reset page");
  await c.close();
  record(`(b2) expired code (${lang} ${width})`, f);
}

async function normalAndStaff(browser, width, lang) {
  let f = [];
  let c = await ctx(browser, width, lang);
  let page = await c.newPage();
  await fillLogin(page, PLAYER.phone, PLAYER.password);
  await page.waitForTimeout(2800);
  if (/\/login/.test(page.url())) f.push(`a normal login stayed on ${page.url()}`);
  if (!(await page.evaluate(() => !!localStorage.getItem("maidan.session_token")))) f.push("no session after a normal login");
  await c.close();
  record(`(c) normal login (${lang} ${width})`, f);

  f = [];
  // an owner-created staff account (with a password), made through the real API
  const login = await (await fetch(API + "/api/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/json", "X-Slot-Grid": "30" }, body: JSON.stringify(OWNER) })).json();
  const H = { "Content-Type": "application/json", "X-Slot-Grid": "30", Authorization: "Bearer " + login.token };
  const venues = await (await fetch(API + "/api/v1/owners/venues", { headers: H })).json();
  const venue = (Array.isArray(venues) ? venues : venues.venues).find((v) => v.status === "approved");
  const staffPhone = "+92300" + String(Math.floor(Math.random() * 1e7)).padStart(7, "0");
  const made = await fetch(API + "/api/v1/staff", { method: "POST", headers: H, body: JSON.stringify({ venue_id: venue.id, name: "AuthFix Staff", phone: staffPhone, password: "staffpass123", permissions: ["view_ledger"] }) });
  if (made.status !== 201) f.push(`could not create the staff account (${made.status})`);
  else {
    c = await ctx(browser, width, lang);
    page = await c.newPage();
    await fillLogin(page, staffPhone, "staffpass123");
    await page.waitForTimeout(3000);
    if (!/\/dashboard\/owner/.test(page.url())) f.push(`a staff login ended at ${page.url()}`);
    await c.close();
  }
  record(`(d) staff account login (${lang} ${width})`, f);
}

async function safetyNet(browser, width, lang) {
  const f = [];
  const c = await ctx(browser, width, lang);
  const page = await c.newPage();
  const phone = nextUnverified();
  let calls = 0;
  await page.route("**/api/v1/auth/login", (route) => {
    calls += 1;
    if (calls === 1) return route.continue(); // the real first login: PHONE_REVERIFICATION_REQUIRED
    return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: { code: "PASSWORD_NOT_SET", message: "No password is set", details: null } }) });
  });
  await fillLogin(page, phone, seed.password);
  await page.waitForURL(/verify/, { timeout: 8000 }).catch(() => {});
  if (!/verify/.test(page.url())) f.push(`an unverified account with a password did not go to the code page (${page.url()})`);
  await page.locator("input[autocomplete=one-time-code]").first().fill(OTP);
  await page.locator("button[type=submit]").click();
  await page.waitForTimeout(2500);
  if (!/forgot-password.*mode=set/.test(page.url())) f.push(`PASSWORD_NOT_SET on the verify page led to ${page.url()} instead of the set-password step`);
  await c.close();
  record(`(e) verify-page safety net (${lang} ${width})`, f);
}

(async () => {
  const pw = loadPlaywright();
  const browser = await pw.chromium.launch();
  for (const lang of ["en", "ru"]) {
    for (const width of [360, 768, 1280]) {
      for (const step of [passwordLessFlow, wrongAndExpired, normalAndStaff, safetyNet]) {
        try {
          await step(browser, width, lang);
        } catch (e) {
          record(`${step.name} (${lang} ${width})`, [`exception: ${String(e.message).split("\n")[0]}`]);
        }
      }
    }
  }
  await browser.close();
  console.log(`\nAuth fix checks: ${BASE}\n`);
  for (const r of results) console.log(`${r.failures.length ? "FAIL" : "PASS"}  ${r.name}${r.failures.length ? "  -> " + r.failures.join(" | ") : ""}`);
  const failed = results.filter((r) => r.failures.length).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
