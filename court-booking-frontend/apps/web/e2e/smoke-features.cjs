#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Khelo Phase 3 feature checks (plain Node + Playwright). Needs a running web build AND the API:
 *   BASE_URL=http://localhost:3000 API_URL=http://localhost:8000 node e2e/smoke-features.cjs
 * Optional: PLAYER_PHONE / PLAYER_PASSWORD (a demo player; digits after +92) enable the Account hub checks.
 * Checks: header (no "List your venue", For Owners present, language switch), language switch + cookie persistence + Urdu footer script,
 * venue page (clickable breadcrumb, map + Directions + Share/Copy fallback, and the no-coordinates variant), account hub tabs,
 * no horizontal scroll at 360/768/1280, no garbled text.
 */
const { findPlaceholders, loadPlaywright } = require("./smoke.cjs");

const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const API = (process.env.API_URL || "").replace(/\/+$/, "");
const WIDTHS = [360, 768, 1280];
const results = [];

function record(name, failures) {
  results.push({ name, failures });
}

async function overflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

async function newPage(browser, width, extra = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, ...extra });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
  return { context, page, errors };
}

async function setLang(page, lang) {
  await page.context().addCookies([{ name: "khelo_lang", value: lang, url: BASE }]);
}

async function headerChecks(browser) {
  const f = [];
  const { context, page } = await newPage(browser, 1280);
  await setLang(page, "en");
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  const header = page.locator("header").first();
  const text = (await header.innerText()).toLowerCase();
  if (text.includes("list your venue")) f.push('header still has "List your venue"');
  for (const label of ["features", "for owners", "about", "blog", "contact", "start playing"]) if (!text.includes(label)) f.push(`header missing "${label}"`);
  if ((await page.locator('[data-testid="language-switch"]').count()) < 1) f.push("language switch missing in header");
  if ((await overflow(page)) > 1) f.push("horizontal scroll on home");
  // the header must stay on ONE row at 1280
  const h = await header.evaluate((el) => el.getBoundingClientRect().height);
  if (h > 100) f.push(`header is ${Math.round(h)}px tall at 1280 (wrapped?)`);
  // For Owners still offers the List your venue CTA
  await page.goto(BASE + "/for-owners", { waitUntil: "networkidle" });
  if ((await page.locator('a[href*="/signup?role=owner"]').count()) < 1) f.push("For Owners has no /signup?role=owner CTA");
  await context.close();
  record("header (1280)", f);
}

async function languageChecks(browser) {
  const f = [];
  const { context, page } = await newPage(browser, 1280);
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  const urdu = page.locator('[data-testid="footer-brand-urdu"]');
  if ((await urdu.count()) < 1) f.push("default (Roman Urdu) has no Urdu-script footer brand");
  else {
    const t = (await urdu.first().innerText()).trim();
    if (t !== "کھیلو") f.push(`Urdu footer text is "${t}"`);
    const attrs = await urdu.first().evaluate((el) => ({ dir: el.getAttribute("dir"), lang: el.getAttribute("lang") }));
    if (attrs.dir !== "rtl" || attrs.lang !== "ur") f.push(`Urdu span dir/lang = ${attrs.dir}/${attrs.lang}`);
  }
  const htmlLang = await page.evaluate(() => document.documentElement.lang);
  if (htmlLang !== "en") f.push(`<html lang> is "${htmlLang}" in Roman Urdu mode`);
  const ruH1 = await page.locator("h1").first().innerText();
  await page.locator('[data-testid="lang-en"]').first().click();
  await page.waitForFunction(() => document.cookie.includes("khelo_lang=en"), null, { timeout: 8000 }).catch(() => f.push("cookie khelo_lang=en not set"));
  await page.waitForTimeout(1500);
  const enH1 = await page.locator("h1").first().innerText();
  if (enH1 === ruH1) f.push("home h1 did not change after switching to English");
  if ((await page.locator('[data-testid="footer-brand-urdu"]').count()) > 0) f.push("Urdu footer still shown in English mode");
  if (!(await page.title()).includes("Khelo")) f.push(`English title "${await page.title()}" lacks Khelo`);
  await page.reload({ waitUntil: "networkidle" });
  if ((await page.locator("h1").first().innerText()) !== enH1) f.push("English did not persist across reload");
  await page.goto(BASE + "/search", { waitUntil: "networkidle" });
  if (findPlaceholders(await page.evaluate(() => document.body.innerText)).length) f.push("placeholder/garbled text on /search in English");
  await page.locator('[data-testid="lang-ru"]').first().click();
  await page.waitForTimeout(1500);
  if ((await page.locator('[data-testid="footer-brand-urdu"]').count()) < 1 && (await page.locator("footer").count()) > 0) {
    // search has no footer; check on home
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    if ((await page.locator('[data-testid="footer-brand-urdu"]').count()) < 1) f.push("Roman Urdu did not return after switching back");
  }
  await context.close();
  record("language switch + Urdu footer", f);
}

async function venueChecks(browser) {
  if (!API) return record("venue page", ["API_URL not set: skipped"]);
  const list = await (await fetch(API + "/api/v1/venues?per_page=100")).json();
  const withCoords = list.venues.find((v) => v.latitude != null && v.longitude != null);
  const without = list.venues.find((v) => v.latitude == null || v.longitude == null);
  for (const width of WIDTHS) {
    if (withCoords) {
      const f = [];
      const { context, page, errors } = await newPage(browser, width, { permissions: ["clipboard-read", "clipboard-write"] });
      await setLang(page, "en");
      await page.goto(`${BASE}/venues/${withCoords.slug}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1500);
      const crumb = page.locator('nav[aria-label*="readcrumb" i]').first();
      if ((await crumb.count()) < 1) f.push("no breadcrumb nav");
      else {
        const hrefs = await crumb.locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
        if (!hrefs.some((h) => h && h.startsWith("/search?") && h.includes("city="))) f.push(`breadcrumb has no city search link (${hrefs.join(", ")})`);
        if (withCoords.sports.length && !hrefs.some((h) => h && h.includes("sport="))) f.push("breadcrumb has no sport link");
        if ((await crumb.locator('[aria-current="page"]').count()) !== 1) f.push("breadcrumb last item is not aria-current=page");
      }
      if ((await page.locator(".leaflet-container").count()) < 1) f.push("no map on a venue with coordinates");
      const dir = page.locator('a[href^="https://www.google.com/maps/dir/?api=1&destination="]');
      if ((await dir.count()) < 1) f.push("no Directions link");
      else if ((await dir.first().getAttribute("target")) !== "_blank") f.push("Directions does not open in a new tab");
      const wa = page.locator('a[href^="https://wa.me/?text="]');
      const copy = page.getByRole("button", { name: /copy link/i });
      const share = page.getByRole("button", { name: /share/i });
      if ((await share.count()) + (await wa.count()) < 1) f.push("no Share location control");
      if ((await wa.count()) > 0) {
        if ((await copy.count()) < 1) f.push("WhatsApp fallback without Copy link");
        else {
          await copy.first().click();
          await page.waitForTimeout(500);
          const live = await page.locator('[aria-live="polite"]').allInnerTexts();
          if (!live.join(" ").toLowerCase().includes("copied")) f.push('Copy link gave no "Copied" in an aria-live region');
        }
      }
      if ((await overflow(page)) > 1) f.push("horizontal scroll");
      if (findPlaceholders(await page.evaluate(() => document.body.innerText)).length) f.push("placeholder/garbled text");
      for (const e of errors) f.push(e.slice(0, 160));
      await context.close();
      record(`venue page with coordinates (${width})`, f);
    }
  }
  if (without) {
    const f = [];
    const { context, page } = await newPage(browser, 360);
    await setLang(page, "en");
    await page.goto(`${BASE}/venues/${without.slug}`, { waitUntil: "networkidle" });
    if ((await page.locator(".leaflet-container").count()) > 0) f.push("map shown for a venue without coordinates");
    if ((await page.locator('a[href^="https://www.google.com/maps/dir/"]').count()) > 0) f.push("Directions shown without coordinates");
    if ((await overflow(page)) > 1) f.push("horizontal scroll");
    await context.close();
    record("venue page without coordinates (360)", f);
  } else {
    console.log("note: no venue without coordinates in this data, so that variant was skipped (covered by lib/venue-location.test.ts)");
  }
}

async function accountChecks(browser) {
  const phone = process.env.PLAYER_PHONE;
  const password = process.env.PLAYER_PASSWORD;
  if (!phone || !password) return record("account hub", ["PLAYER_PHONE/PLAYER_PASSWORD not set: skipped"]);
  for (const width of WIDTHS) {
    const f = [];
    const { context, page, errors } = await newPage(browser, width);
    await setLang(page, "en");
    await page.goto(BASE + "/login", { waitUntil: "networkidle" });
    await page.locator("input[type=tel]").fill(phone);
    await page.locator("input[type=password]").first().fill(password);
    await page.locator("button[type=submit]").click();
    await page.waitForTimeout(2500);
    await page.goto(BASE + "/account", { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    const tabs = page.getByRole("tab");
    const n = await tabs.count();
    if (n < 4) f.push(`expected 4 tabs, found ${n}`);
    else {
      for (let i = 0; i < 4; i++) {
        await tabs.nth(i).click();
        await page.waitForTimeout(500);
        if ((await page.getByRole("tabpanel").count()) < 1) f.push(`tab ${i} shows no tabpanel`);
        if ((await overflow(page)) > 1) f.push(`horizontal scroll on tab ${i}`);
      }
      if (!page.url().includes("tab=")) f.push("tab is not kept in the URL");
    }
    const h1 = await page.locator("h1").count();
    if (h1 !== 1) f.push(`expected 1 h1, found ${h1}`);
    if (findPlaceholders(await page.evaluate(() => document.body.innerText)).length) f.push("placeholder/garbled text");
    for (const e of errors) f.push(e.slice(0, 160));
    await context.close();
    record(`account hub (${width})`, f);
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
  for (const step of [headerChecks, languageChecks, venueChecks, accountChecks]) {
    try {
      await step(browser);
    } catch (e) {
      record(step.name, [`exception: ${String(e.message).split("\n")[0]}`]);
    }
  }
  await browser.close();
  console.log(`\nKhelo feature checks: ${BASE}\n`);
  for (const r of results) console.log(`${r.failures.length ? "FAIL" : "PASS"}  ${r.name}${r.failures.length ? "  -> " + r.failures.join(" | ") : ""}`);
  const failed = results.filter((r) => r.failures.length).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
