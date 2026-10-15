#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Polish-pass checks (plain Node + Playwright). Needs a running web build and the API with the seeded demo owner / player:
 *   BASE_URL=http://localhost:3000 node e2e/polish-check.cjs
 * 1. Staff form (owner), 360 / 768 / 1280 x en / ru: only "view dashboard" is ticked by default, no walk-in permission is offered, the password has a
 *    44px Show/Hide, a NEW number adds the member to the list at once and closes the form, a number that is ALREADY registered shows the staff-specific
 *    message under the phone field (not the login text).
 * 2. Roles: owner menu (Dashboard, Bookings, Venues, Settings, Log out) with no My bookings / Saved; player menu (Search, My bookings, Saved, Profile,
 *    Settings, Log out); logout works from the desktop dropdown and from the mobile menu at 360px; the dropdown works from the keyboard;
 *    an owner who opens /bookings lands on the dashboard; the owner Add booking page is gone.
 */
const { loadPlaywright } = require("./smoke.cjs");

const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const PASSWORD = process.env.DEMO_PASSWORD || "demo-password-123";
const OWNER = process.env.OWNER_PHONE || "3000000002";
const PLAYER = process.env.PLAYER_PHONE || "3000000003";
const results = [];

const TAKEN = {
  en: "This phone number is already registered with another account. Use a different number for this staff member.",
  ru: "Ye number pehle se kisi aur account par hai. Is staff member ke liye koi doosra number istemal karein.",
};
const rand = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");
const record = (name, failures) => results.push({ name, failures });

async function ctx(browser, width, lang) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  await context.addCookies([{ name: "khelo_lang", value: lang, url: BASE }]);
  return context;
}

async function login(context, phone) {
  const page = await context.newPage();
  await page.goto(BASE + "/login", { waitUntil: "networkidle" });
  await page.locator("input[type=tel]").fill(phone);
  await page.locator("input[type=password]").first().fill(PASSWORD);
  await page.locator("button[type=submit]").click();
  await page.waitForTimeout(2800);
  return page;
}

async function staffForm(browser, width, lang) {
  const f = [];
  const context = await ctx(browser, width, lang);
  const page = await login(context, OWNER);
  await page.goto(BASE + "/dashboard/owner/staff", { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.locator("button").filter({ hasText: lang === "en" ? /\+ Add staff member/ : /\+ Staff add karein/ }).first().click();
  await page.waitForTimeout(500);
  const form = page.locator("form").first();

  // defaults: exactly one ticked permission (view dashboard / ledger), no walk-in offered
  const boxes = form.locator('input[type=checkbox]');
  const total = await boxes.count();
  const ticked = await form.locator('input[type=checkbox]:checked').count();
  if (ticked !== 1) f.push(`${ticked} permissions ticked by default (expected 1)`);
  const tickedLabel = (await form.locator('input[type=checkbox]:checked').first().locator("xpath=..").innerText()).toLowerCase();
  if (!/ledger|dashboard/.test(tickedLabel)) f.push(`the default tick is "${tickedLabel}"`);
  const formText = (await form.innerText()).toLowerCase();
  if (/walk-in|walkin/.test(formText)) f.push("a walk-in permission is still offered");
  if (total < 5) f.push(`only ${total} permission checkboxes`);
  const hint = lang === "en" ? "tick only what" : "sirf wahi tick karein";
  if (!formText.includes(hint)) f.push("permission hint line missing");

  // password Show/Hide, 44px
  const pw = form.locator('input[autocomplete="new-password"]');
  const toggle = form.locator("button[aria-pressed]").first();
  const box = await toggle.boundingBox();
  if (!box || box.height < 43 || box.width < 43) f.push(`Show/Hide button is ${box ? Math.round(box.width) + "x" + Math.round(box.height) : "missing"}`);
  await pw.fill("staffpass123");
  await toggle.click();
  if ((await pw.getAttribute("type")) !== "text") f.push("Show did not reveal the password");
  await toggle.click();
  if ((await pw.getAttribute("type")) !== "password") f.push("Hide did not hide the password");

  // (b) a number that already has an account
  const name = `Polish ${lang}${width} ${rand(4)}`;
  await form.locator("input").first().fill(name);
  const phone = form.locator("input[type=tel]");
  await phone.fill("0" + PLAYER); // the demo player's number
  const submit = form.locator("button[type=submit]");
  await submit.click();
  await page.waitForTimeout(1500);
  const err = (await form.locator('[data-testid="staff-phone-error"]').innerText()).trim();
  if (err !== TAKEN[lang]) f.push(`taken-number message was "${err.slice(0, 90)}"`);
  const bottomAlerts = await form.locator('p[role="alert"]').allInnerTexts();
  if (bottomAlerts.some((t) => /log in|login/i.test(t))) f.push("the login-style message is still shown");
  const errBox = await form.locator('[data-testid="staff-phone-error"]').boundingBox();
  const phoneBox = await phone.boundingBox();
  if (errBox && phoneBox && errBox.y < phoneBox.y) f.push("the error is not below the phone field");

  // (a) a new number
  await phone.fill("0300" + rand(7));
  await page.waitForTimeout(200);
  await submit.click();
  await page.waitForTimeout(2500);
  if ((await page.locator("form").count()) > 0) f.push("the form did not close after adding");
  if (!(await page.getByText(name).first().isVisible().catch(() => false))) f.push("the new staff name is not in the list");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) f.push(`horizontal scroll +${overflow}px`);
  await context.close();
  record(`staff form (${lang} ${width})`, f);
}

async function menus(browser) {
  // owner, desktop: dropdown + keyboard + logout
  let f = [];
  let context = await ctx(browser, 1280, "en");
  let page = await login(context, OWNER);
  await page.goto(BASE + "/account", { waitUntil: "networkidle" });
  const btn = page.locator('[data-testid="profile-menu-button"]');
  await btn.focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  const menu = page.locator('[data-testid="profile-menu"]');
  if (!(await menu.isVisible().catch(() => false))) f.push("owner dropdown did not open from the keyboard");
  const items = (await menu.locator('[role="menuitem"]').allInnerTexts()).map((s) => s.trim());
  const expectOwner = ["Dashboard", "Bookings", "Venues", "Settings", "Log out"];
  if (JSON.stringify(items) !== JSON.stringify(expectOwner)) f.push(`owner menu is ${JSON.stringify(items)}`);
  if ((await page.evaluate(() => document.activeElement && document.activeElement.textContent)) !== "Dashboard") f.push("focus did not land on the first item");
  await page.keyboard.press("ArrowDown");
  if ((await page.evaluate(() => document.activeElement.textContent)) !== "Bookings") f.push("ArrowDown did not move focus");
  await page.keyboard.press("Escape");
  if (await menu.isVisible().catch(() => false)) f.push("Esc did not close the dropdown");
  if (!(await btn.evaluate((el) => el === document.activeElement))) f.push("focus did not return to the avatar button after Esc");
  const tabs = (await page.getByRole("tab").allInnerTexts()).map((s) => s.trim().toLowerCase());
  if (tabs.some((t) => /booking|saved/.test(t))) f.push(`owner account page still shows ${JSON.stringify(tabs)}`);
  await page.goto(BASE + "/bookings", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  if (!page.url().includes("/dashboard/owner/today")) f.push(`owner on /bookings ends at ${page.url()}`);
  const gone = await page.goto(BASE + "/dashboard/owner/walkin", { waitUntil: "networkidle" });
  if (gone && gone.status() !== 404) f.push(`the old Add booking page answers ${gone.status()}`);
  await page.goto(BASE + "/dashboard/owner/today", { waitUntil: "networkidle" });
  if (/add booking/i.test(await page.evaluate(() => document.body.innerText))) f.push("an Add booking button/link is still on the dashboard");
  await page.goto(BASE + "/account", { waitUntil: "networkidle" });
  await btn.click();
  await page.locator('[data-testid="profile-menu-logout"]').click();
  await page.waitForTimeout(2000);
  if (new URL(page.url()).pathname !== "/") f.push(`logout from the owner dropdown ends at ${page.url()}`);
  if ((await page.locator('a[href="/login"]').count()) < 1) f.push("still looks signed in after owner logout");
  await context.close();
  record("owner menu, keyboard, logout (1280)", f);

  // player, desktop
  f = [];
  context = await ctx(browser, 1280, "en");
  page = await login(context, PLAYER);
  await page.goto(BASE + "/search", { waitUntil: "networkidle" });
  await page.locator('[data-testid="profile-menu-button"]').click();
  const pitems = (await page.locator('[data-testid="profile-menu"] [role="menuitem"]').allInnerTexts()).map((s) => s.trim());
  const expectPlayer = ["Search", "My bookings", "Saved", "Profile", "Settings", "Log out"];
  if (JSON.stringify(pitems) !== JSON.stringify(expectPlayer)) f.push(`player menu is ${JSON.stringify(pitems)}`);
  await page.locator('[data-testid="profile-menu-logout"]').click();
  await page.waitForTimeout(2000);
  if ((await page.locator('a[href="/login"]').count()) < 1) f.push("still looks signed in after player logout");
  await context.close();
  record("player menu and logout (1280)", f);

  // mobile 360: both roles log out from the hamburger menu, in both languages
  for (const [who, phone] of [["owner", OWNER], ["player", PLAYER]]) {
    for (const lang of ["en", "ru"]) {
      f = [];
      context = await ctx(browser, 360, lang);
      page = await login(context, phone);
      await page.goto(BASE + (who === "owner" ? "/account" : "/search"), { waitUntil: "networkidle" });
      await page.getByRole("button", { name: /menu/i }).first().click();
      await page.waitForTimeout(400);
      const lo = page.locator('[data-testid="menu-logout"]');
      if (!(await lo.isVisible().catch(() => false))) f.push("no Log out in the mobile menu");
      else {
        const b = await lo.boundingBox();
        if (!b || b.height < 43) f.push("mobile Log out is under 44px");
        const names = (await page.locator('header nav[aria-label] a').allInnerTexts()).join("|").toLowerCase();
        if (who === "owner" && /my bookings|saved|pasandida|meri bookings/.test(await page.locator("header").innerText().then((s) => s.toLowerCase()))) f.push("owner sees player entries in the mobile menu");
        await lo.click();
        await page.waitForTimeout(2000);
        if (new URL(page.url()).pathname !== "/") f.push(`mobile logout ends at ${page.url()}`);
        void names;
      }
      const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (ov > 1) f.push(`horizontal scroll +${ov}px`);
      await context.close();
      record(`mobile logout, ${who} (${lang} 360)`, f);
    }
  }
}

(async () => {
  const pw = loadPlaywright();
  const browser = await pw.chromium.launch();
  for (const lang of ["en", "ru"]) for (const width of [360, 768, 1280]) {
    try {
      await staffForm(browser, width, lang);
    } catch (e) {
      record(`staff form (${lang} ${width})`, [`exception: ${String(e.message).split("\n")[0]}`]);
    }
  }
  try {
    await menus(browser);
  } catch (e) {
    record("menus", [`exception: ${String(e.message).split("\n")[0]}`]);
  }
  await browser.close();
  console.log(`\nPolish checks: ${BASE}\n`);
  for (const r of results) console.log(`${r.failures.length ? "FAIL" : "PASS"}  ${r.name}${r.failures.length ? "  -> " + r.failures.join(" | ") : ""}`);
  const failed = results.filter((r) => r.failures.length).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
