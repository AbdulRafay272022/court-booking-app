// Floodlight QA: DS Sheet lifecycle on Expo web (dev page /dev/components, no API needed).
// Run: PLAYWRIGHT_PATH=<...>/node_modules/playwright BASE=http://localhost:8095 node e2e/qa-sheets-check.cjs
// Checks: (a) sheet content keeps the route-group role/lang/font scale (owner = teal primary inside the sheet),
// (b) hand-over A -> B and B stacked over A leave the right sheets open, (c) a sheet unmounted while open is gone
// quickly (no ~1 s linger), (d) onClose sees the LATEST state, (e) RadioGroup / Checkbox / Switch expose aria-checked.
const { chromium } = require(process.env.PLAYWRIGHT_PATH);
const BASE = process.env.BASE || "http://localhost:8095";
const results = [];
const check = (name, ok, extra) => { results.push({ name, ok: !!ok }); console.log((ok ? "PASS " : "FAIL ") + name + (extra !== undefined ? "  " + String(extra).slice(0, 200) : "")); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shown(page, testId) {
  // a sheet is "shown" when its scroll content is in the viewport (the @gorhom portal keeps closed ones off-screen / unmounted)
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.height > 0 && r.top < window.innerHeight - 40 && r.bottom > 0;
  }, testId);
}
async function waitShown(page, id, want, t = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < t) { if ((await shown(page, id)) === want) return Date.now() - t0; await sleep(50); }
  return -1;
}
async function bg(page, testId) {
  return page.evaluate((id) => { const el = document.querySelector(`[data-testid="${id}"]`); return el ? getComputedStyle(el).backgroundColor : null; }, testId);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  for (const role of ["owner", "player"]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await ctx.route(/^(?!https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/).*/, (r) => (/^(data|blob):/.test(r.request().url()) ? r.continue() : r.abort()));
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
    await page.goto(`${BASE}/dev/components?role=${role}&lang=en`, { waitUntil: "domcontentloaded", timeout: 240000 });
    await page.getByTestId("qa-open-a").waitFor({ timeout: 240000 });
    await page.getByTestId("qa-open-a").scrollIntoViewIfNeeded();
    await sleep(800);

    // (a) role context inside the sheet: the primary button inside the portal matches the role's primary
    await page.getByTestId("qa-open-a").click();
    check(`${role}: sheet A opens`, (await waitShown(page, "qa-sheet-a", true)) >= 0);
    await sleep(500);
    const want = role === "owner" ? "rgb(14, 124, 116)" : "rgb(255, 106, 43)";
    const got = await bg(page, "qa-a-primary");
    check(`${role}: primary button INSIDE the sheet uses the ${role} colour (context re-provided)`, got === want, got);
    // English copy (LangProvider re-provided): the close button label
    check(`${role}: sheet close button is in the route-group language (EN "Close")`, (await page.getByTestId("qa-sheet-a-close").getAttribute("aria-label")) === "Close");

    // (d) latest onClose: bump n twice, then close via the close button
    await page.getByTestId("qa-a-inc").click();
    await page.getByTestId("qa-a-inc").click();
    await sleep(300);
    await page.getByTestId("qa-sheet-a-close").click();
    check(`${role}: A closes from its close button`, (await waitShown(page, "qa-sheet-a", false)) >= 0);
    await sleep(600);
    const log1 = await page.getByTestId("qa-log").innerText();
    check(`${role}: onClose ran with the LATEST state (n=2)`, /A closed n=2/.test(log1), log1);

    // (b1) hand-over: A -> B in one tap
    await page.getByTestId("qa-open-a").click();
    await waitShown(page, "qa-sheet-a", true);
    await sleep(500);
    await page.getByTestId("qa-a-handover").click();
    const tb = await waitShown(page, "qa-sheet-b", true, 5000);
    await sleep(1200);
    check(`${role}: hand-over opens B`, tb >= 0 && (await shown(page, "qa-sheet-b")), tb);
    check(`${role}: hand-over closes A`, !(await shown(page, "qa-sheet-a")));
    await page.getByTestId("qa-b-primary").click();
    check(`${role}: B closes`, (await waitShown(page, "qa-sheet-b", false)) >= 0);
    await sleep(800);
    check(`${role}: nothing left open after the hand-over`, !(await shown(page, "qa-sheet-a")) && !(await shown(page, "qa-sheet-b")));

    // (b2) stack: B opened while A stays open; closing B brings A back
    await page.getByTestId("qa-open-a").click();
    await waitShown(page, "qa-sheet-a", true);
    await sleep(500);
    await page.getByTestId("qa-a-stack").click();
    const ts = await waitShown(page, "qa-sheet-b", true, 5000);
    await sleep(1200);
    check(`${role}: stacked B opens over A`, ts >= 0 && (await shown(page, "qa-sheet-b")), ts);
    await page.getByTestId("qa-b-primary").click();
    await waitShown(page, "qa-sheet-b", false);
    const ta = await waitShown(page, "qa-sheet-a", true, 4000);
    await sleep(800);
    check(`${role}: closing stacked B leaves A open (not both dismissed)`, ta >= 0 && (await shown(page, "qa-sheet-a")), ta);
    await page.getByTestId("qa-sheet-a-close").click().catch(() => undefined);
    await waitShown(page, "qa-sheet-a", false);
    await sleep(800);

    // (c) unmount while open: gone fast
    await page.getByTestId("qa-open-a").click();
    await waitShown(page, "qa-sheet-a", true);
    await sleep(600);
    const logBefore = await page.getByTestId("qa-log").innerText();
    await page.getByTestId("qa-a-unmount").click();
    let tu = -1;
    { const t0 = Date.now(); while (Date.now() - t0 < 3000) { if (!(await page.evaluate(() => !!document.querySelector('[data-testid="qa-sheet-a"]')))) { tu = Date.now() - t0; break; } await sleep(25); } }
    // the scrim must go too
    await sleep(150);
    const scrim = await page.evaluate(() => [...document.querySelectorAll("div")].some((d) => { const s = getComputedStyle(d); const r = d.getBoundingClientRect(); return s.backgroundColor === "rgba(12, 31, 29, 0.5)" && r.width >= window.innerWidth - 2 && r.height >= window.innerHeight - 2 && s.opacity !== "0"; }));
    check(`${role}: sheet unmounted while open leaves the DOM within 300 ms`, tu >= 0 && tu <= 300, `${tu} ms`);
    check(`${role}: no scrim left after the unmount`, !scrim);
    await sleep(600);
    check(`${role}: unmounted sheet does not call its owner's onClose`, (await page.getByTestId("qa-log").innerText()) === logBefore);
    // and it can be mounted + opened again
    await page.getByTestId("qa-open-a").click();
    check(`${role}: re-mounted sheet opens again`, (await waitShown(page, "qa-sheet-a", true, 5000)) >= 0);
    await page.getByTestId("qa-sheet-a-close").click().catch(() => undefined);
    await waitShown(page, "qa-sheet-a", false);

    // (e) aria-checked on the controls (web accessibility tree)
    const aria = await page.evaluate(() => ({
      radios: [...document.querySelectorAll('[role="radio"]')].map((e) => e.getAttribute("aria-checked")),
      boxes: [...document.querySelectorAll('[role="checkbox"]')].map((e) => e.getAttribute("aria-checked")),
      switches: [...document.querySelectorAll('[role="switch"]')].map((e) => e.getAttribute("aria-checked")),
    }));
    check(`${role}: RadioGroup radios expose aria-checked (one true)`, aria.radios.length > 0 && aria.radios.every((v) => v === "true" || v === "false") && aria.radios.filter((v) => v === "true").length === 1, JSON.stringify(aria.radios));
    check(`${role}: Checkbox exposes aria-checked`, aria.boxes.length > 0 && aria.boxes.every((v) => v === "true" || v === "false"), JSON.stringify(aria.boxes));
    check(`${role}: Switch exposes aria-checked`, aria.switches.length > 0 && aria.switches.every((v) => v === "true" || v === "false"), JSON.stringify(aria.switches));
    check(`${role}: no page errors`, errors.length === 0, errors.join(" | "));
    await ctx.close();
  }
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
