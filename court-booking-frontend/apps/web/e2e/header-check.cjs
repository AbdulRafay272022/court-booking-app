#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Header check (plain Node + Playwright): the site header must be ONE row from 1024px up, in English and in Roman Urdu, signed out and
 * signed in (player, owner), with the same height in both languages, no wrapped text, no overlapping items, no horizontal scroll.
 * Below 1024px it is the hamburger: the menu button is shown, the section links are hidden, and the menu opens.
 *   BASE_URL=http://localhost:3000 node e2e/header-check.cjs
 * Prints a measurement table (header height per language and width) and a PASS/FAIL list.
 */
const { loadPlaywright } = require("./smoke.cjs");

const BASE = (process.env.BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const PASSWORD = process.env.DEMO_PASSWORD || "demo-password-123";
const OWNER = process.env.OWNER_PHONE || "3000000002";
const PLAYER = process.env.PLAYER_PHONE || "3000000003";
const DESKTOP = [1024, 1100, 1199, 1280, 1440, 1550, 1920];
const SMALL = [360, 768, 1023];
const LANGS = ["en", "ru"];

const rows = []; // {state, lang, width, height, items}
const failures = [];
const fail = (msg) => failures.push(msg);

async function login(context, phone) {
  const page = await context.newPage();
  await page.goto(BASE + "/login", { waitUntil: "networkidle" });
  await page.locator("input[type=tel]").fill(phone);
  await page.locator("input[type=password]").first().fill(PASSWORD);
  await page.locator("button[type=submit]").click();
  await page.waitForTimeout(2800);
  await page.close();
}

/** Everything visible in the header row, with its box and how many lines its own text takes. */
async function measureHeader(page) {
  return page.evaluate(() => {
    const header = document.querySelector("header");
    const hb = header.getBoundingClientRect();
    const items = [];
    for (const el of header.querySelectorAll("a, button")) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (el.closest("[hidden]")) continue;
      let lines = 0;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        const tops = new Set();
        for (const q of range.getClientRects()) if (q.width > 1 && q.height > 1) tops.add(Math.round(q.top / 4));
        lines = Math.max(lines, tops.size);
      }
      items.push({
        label: (el.innerText || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 28),
        x: r.left,
        right: r.right,
        cy: r.top + r.height / 2,
        w: r.width,
        lines,
      });
    }
    return { height: hb.height, items, scroll: document.documentElement.scrollWidth - window.innerWidth, vw: window.innerWidth };
  });
}

function checkOneRow(tag, m) {
  if (m.scroll > 1) fail(`${tag}: horizontal scroll +${m.scroll}px`);
  const cys = m.items.map((i) => i.cy).sort((a, b) => a - b);
  const median = cys[Math.floor(cys.length / 2)];
  for (const i of m.items) {
    if (Math.abs(i.cy - median) > 8) fail(`${tag}: "${i.label}" is on another row (y ${Math.round(i.cy)} vs ${Math.round(median)})`);
    if (i.lines > 1) fail(`${tag}: "${i.label}" wraps onto ${i.lines} lines`);
    if (i.right > m.vw + 0.5) fail(`${tag}: "${i.label}" runs off the screen (right edge ${Math.round(i.right)} > ${m.vw})`);
  }
  const sorted = [...m.items].sort((a, b) => a.x - b.x);
  for (let k = 1; k < sorted.length; k++) {
    if (sorted[k].x < sorted[k - 1].right - 1) fail(`${tag}: "${sorted[k - 1].label}" overlaps "${sorted[k].label}"`);
  }
  if (m.height > 110) fail(`${tag}: header is ${Math.round(m.height)}px tall (more than one row)`);
}

async function run(browser) {
  const states = [
    { name: "signed out", route: "/", phone: null },
    { name: "signed out /search", route: "/search", phone: null },
    { name: "signed out /login", route: "/login", phone: null },
    { name: "player", route: "/search", phone: PLAYER },
    { name: "owner", route: "/account", phone: OWNER },
  ];
  for (const st of states) {
    for (const lang of LANGS) {
      for (const width of [...DESKTOP, ...SMALL]) {
        const context = await browser.newContext({ viewport: { width, height: 900 } });
        await context.addCookies([{ name: "khelo_lang", value: lang, url: BASE }]);
        if (st.phone) await login(context, st.phone);
        const page = await context.newPage();
        await page.goto(BASE + st.route, { waitUntil: "networkidle" });
        await page.waitForTimeout(700);
        const tag = `[${st.name} | ${lang} | ${width}]`;
        const m = await measureHeader(page);
        if (DESKTOP.includes(width)) {
          rows.push({ state: st.name, lang, width, height: Math.round(m.height) });
          checkOneRow(tag, m);
          // the section links and the hamburger: desktop shows the links, hides the hamburger
          const burger = await page.locator('[data-testid="menu-toggle"]').isVisible().catch(() => false);
          if (burger) fail(`${tag}: the hamburger is shown on a desktop width`);
          const navVisible = await page.locator('[data-testid="desktop-nav"]').isVisible().catch(() => false);
          if (!navVisible) fail(`${tag}: the section links are hidden on a desktop width`);
        } else {
          if (m.scroll > 1) fail(`${tag}: horizontal scroll +${m.scroll}px`);
          const burger = page.locator('[data-testid="menu-toggle"]');
          if (!(await burger.isVisible().catch(() => false))) fail(`${tag}: no hamburger below 1024px`);
          else {
            if (await page.locator('[data-testid="desktop-nav"]').isVisible().catch(() => false)) fail(`${tag}: the desktop section links are visible below 1024px`);
            await burger.click();
            await page.waitForTimeout(250);
            const expanded = await burger.getAttribute("aria-expanded");
            const links = await page.locator("header a:visible").count();
            if (expanded !== "true") fail(`${tag}: the menu button is not expanded after a tap`);
            if (links < 4) fail(`${tag}: the menu did not open (${links} visible links)`);
            const after = await measureHeader(page);
            if (after.scroll > 1) fail(`${tag}: horizontal scroll after opening the menu`);
          }
        }
        await context.close();
      }
    }
  }
}

(async () => {
  const pw = loadPlaywright();
  const browser = await pw.chromium.launch();
  await run(browser);
  await browser.close();

  // equal height in both languages, per state and width
  const byKey = new Map();
  for (const r of rows) byKey.set(`${r.state}|${r.width}|${r.lang}`, r.height);
  const states = [...new Set(rows.map((r) => r.state))];
  console.log("\nHeader height (px)  en / ru");
  for (const st of states) {
    const cells = DESKTOP.map((w) => {
      const en = byKey.get(`${st}|${w}|en`);
      const ru = byKey.get(`${st}|${w}|ru`);
      if (en !== ru) fail(`[${st} | ${w}] header height differs: en ${en}px vs ru ${ru}px`);
      return `${w}:${en}/${ru}`;
    });
    console.log(`  ${st.padEnd(20)} ${cells.join("  ")}`);
  }
  console.log(`\n${failures.length ? "FAIL" : "PASS"}: ${failures.length} problem(s)`);
  for (const f of [...new Set(failures)]) console.log("  " + f);
  process.exit(failures.length ? 1 : 0);
})();
