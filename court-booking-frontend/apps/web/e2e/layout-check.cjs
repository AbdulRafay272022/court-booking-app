#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Layout check for both languages: every route (public, player, owner) at 360 / 768 / 1280 must have
 *  - no horizontal page scroll, and
 *  - no wrapped short controls: a button / link / pill / chip / tab with short text that breaks onto 2+ lines (Roman Urdu is longer than English).
 * Usage: BASE_URL=http://localhost:3000 API_URL=http://localhost:8000 node e2e/layout-check.cjs   (LANGS=ru,en WIDTHS=360,768,1280)
 * Prints one line per problem and a total; exit code 1 when there is any problem.
 */
const { loadPlaywright } = require("./smoke.cjs");
const { PUBLIC, PLAYER_ROUTES, OWNER_ROUTES, BASE, OWNER, PLAYER, login, createHold } = require("./text-dump.cjs");

const LANGS = (process.env.LANGS || "ru,en").split(",");
const WIDTHS = (process.env.WIDTHS || "360,768,1280").split(",").map(Number);
const API = (process.env.API_URL || "http://localhost:8000").replace(/\/+$/, "");

// Controls that should stay on one line. Text longer than this is allowed to wrap (sentences, descriptions).
const SHORT = 26;

async function wrapped(page) {
  return page.evaluate((SHORT) => {
    const out = [];
    const sel = 'button, a[class*="rounded"], [role="tab"], [role="radio"], [class*="pill"], [class*="chip"], summary, label[class*="rounded"], span[class*="rounded-full"]';
    for (const el of document.querySelectorAll(sel)) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      const text = (el.innerText || "").trim().replace(/\s+/g, " ");
      if (!text || text.length > SHORT) continue;
      // a control is "wrapped" only when ONE text node of it breaks onto 2+ lines (stacked elements, e.g. a number over a dot, are by design)
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let worst = 0;
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        const tops = new Set();
        for (const r of range.getClientRects()) if (r.width > 1 && r.height > 1) tops.add(Math.round(r.top / 4));
        worst = Math.max(worst, tops.size);
      }
      if (worst >= 2) out.push(`"${text}" (${worst} lines, ${Math.round(box.width)}px wide)`);
    }
    return out;
  }, SHORT);
}

async function check(browser, lang, width, routes, role, problems) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  await context.addCookies([{ name: "khelo_lang", value: lang, url: BASE }]);
  if (role) await login(context, role);
  const page = await context.newPage();
  for (const route of routes) {
    try {
      await page.goto(BASE + route.split("#")[0], { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForTimeout(900);
      if (route.endsWith("#courts")) {
        await page.getByRole("tab", { name: /court/i }).first().click().catch(() => {});
        await page.waitForTimeout(1500);
      }
      const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (ov > 1) problems.push(`[${lang} ${width}] ${route}: horizontal scroll +${ov}px`);
      for (const w of await wrapped(page)) problems.push(`[${lang} ${width}] ${route}: wrapped control ${w}`);
    } catch (e) {
      problems.push(`[${lang} ${width}] ${route}: exception ${String(e.message).split("\n")[0]}`);
    }
  }
  await context.close();
}

(async () => {
  const pw = loadPlaywright();
  const browser = await pw.chromium.launch();
  const problems = [];
  let slug = null;
  try {
    const data = await (await fetch(API + "/api/v1/venues?per_page=1")).json();
    slug = data.venues && data.venues[0] && data.venues[0].slug;
  } catch {}
  const publicRoutes = [...PUBLIC, ...(slug ? ["/venues/" + slug] : [])];
  let bookingId = null;
  try {
    bookingId = await createHold();
  } catch {}
  const playerRoutes = [...PLAYER_ROUTES, ...(bookingId ? [`/booking/${bookingId}/chat`, `/booking/${bookingId}/pay`, `/booking/${bookingId}/done`] : [])];
  for (const lang of LANGS) {
    for (const width of WIDTHS) {
      await check(browser, lang, width, publicRoutes, null, problems);
      await check(browser, lang, width, playerRoutes, PLAYER, problems);
      await check(browser, lang, width, OWNER_ROUTES, OWNER, problems);
      console.log(`done ${lang} ${width}: ${problems.length} problem(s) so far`);
    }
  }
  await browser.close();
  const unique = [...new Set(problems)];
  console.log("\n" + unique.join("\n"));
  console.log(`\nTOTAL: ${unique.length} problem(s)`);
  process.exit(unique.length ? 1 : 0);
})();
