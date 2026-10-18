#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/** QA round 2 item 7: Overview card titles do not wrap mid-text at 360/768/1280 in ru+en.
 * Same "wrapped control" rule as e2e/layout-check.cjs, on the mocked Overview (overview-check.cjs fixture), plus nothing sticking out
 * of a card. Build with NEXT_PUBLIC_API_BASE_URL=http://localhost:8099 (like overview-check.cjs): BASE_URL=http://localhost:3822 node e2e/round2-ovw-labels-check.cjs */
const { loadPlaywright } = require("./smoke.cjs");
const { newState, newPage, pktToday } = require("./overview-check.cjs");

const BASE = (process.env.BASE_URL || "http://localhost:3822").replace(/\/+$/, "");
const SHOTS = process.env.SHOT_DIR || require("os").tmpdir();

(async () => {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  const problems = [];
  for (const lang of ["ru", "en"]) {
    for (const width of [360, 768, 1024, 1280]) {
      const { page, context } = await newPage(browser, width, lang, newState(pktToday()));
      await page.goto(`${BASE}/dashboard/owner/today`, { waitUntil: "networkidle" });
      await page.waitForSelector("[data-testid=kpi-collected]", { timeout: 20000 });
      await page.waitForTimeout(500);
      const res = await page.evaluate(() => {
        const out = [];
        const titles = [];
        const cards = ["kpi-pending", "kpi-bookings", "kpi-cancelled", "kpi-refunds", "kpi-collected", "kpi-due", "kpi-total"];
        for (const id of cards) {
          const card = document.querySelector(`[data-testid=${id}]`);
          if (!card) continue;
          const link = card.querySelector("a, p");
          const walker = document.createTreeWalker(link, NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            if (!n.textContent.trim()) continue;
            const range = document.createRange();
            range.selectNodeContents(n);
            const tops = new Set();
            for (const r of range.getClientRects()) if (r.width > 1 && r.height > 1) tops.add(Math.round(r.top / 4));
            if (tops.size >= 2) out.push(`${id}: "${n.textContent.trim()}" wraps (${tops.size} lines)`);
          }
          // nothing may stick out of the card
          const cb = card.getBoundingClientRect();
          for (const el of card.querySelectorAll("*")) {
            const b = el.getBoundingClientRect();
            if (b.width && b.right > cb.right + 0.5) out.push(`${id}: ${el.tagName} overflows the card by ${Math.round(b.right - cb.right)}px`);
          }
          titles.push(`${id}=${link.innerText.replace(/\n/g, " / ")}`);
        }
        return { out, titles, sw: document.documentElement.scrollWidth - window.innerWidth };
      });
      if (res.sw > 1) problems.push(`[${lang} ${width}] horizontal scroll +${res.sw}`);
      for (const p of res.out) problems.push(`[${lang} ${width}] ${p}`);
      console.log(`[${lang} ${width}] ${res.titles.join(" | ")}`);
      await page.locator("[data-testid=ovw-kpis]").screenshot({ path: `${SHOTS}/r2fix-kpis-${lang}-${width}.png` });
      await context.close();
    }
  }
  await browser.close();
  console.log(problems.length ? "FAIL\n" + problems.join("\n") : "PASS");
  process.exit(problems.length ? 1 : 0);
})();
