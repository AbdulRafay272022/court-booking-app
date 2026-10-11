#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Khelo website smoke runner (plain Node + Playwright, no test framework).
 * Usage: BASE_URL=http://localhost:3000 node e2e/smoke.cjs      (see e2e/README.md)
 * Exit code 0 = every check passed, 1 = at least one failure, 2 = could not start.
 */
const fs = require("fs");
const path = require("path");

const ROUTES = ["/", "/features", "/for-owners", "/about", "/blog", "/contact", "/login", "/signup", "/search", "/forgot-password", "/verify?phone=%2B923001234567", "/reset-password?phone=%2B923001234567"];
const WIDTHS = [360, 768, 1280];
const HEIGHT = 900;

// Leftover-placeholder patterns, tested against the page's visible text.
const PLACEHOLDER_PATTERNS = [
  { name: "bracket placeholder", re: /\[[A-Z][A-Z ]{3,}\]/ },
  { name: "literal 00+", re: /00\+/ },
  { name: "word Maidan", re: /\bMaidan\b/i },
  // UTF-8 text that was decoded as Latin-1/CP1252 (e.g. a middle dot showing as "A-circumflex" + dot), or the replacement character.
  { name: "garbled text encoding (mojibake)", re: /Â|â€|Ã[-¿ -ÿ‘-›]|�/ },
];

/** Returns the names of the placeholder patterns that match `text`. */
function findPlaceholders(text) {
  return PLACEHOLDER_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.name);
}

function loadPlaywright() {
  const candidates = [
    "playwright",
    process.env.PLAYWRIGHT_PATH,
    "C:/Users/Noman Traders/Desktop/Court Booking App/court-booking-frontend/apps/mobile/node_modules/playwright",
  ].filter(Boolean);
  const errors = [];
  for (const c of candidates) {
    try {
      return require(c);
    } catch (e) {
      errors.push(`${c}: ${e.code || e.message}`);
    }
  }
  throw new Error("Could not load playwright. Tried:\n  " + errors.join("\n  ") + "\nSet PLAYWRIGHT_PATH to the package folder.");
}

function slug(route) {
  return route === "/" ? "home" : route.split("?")[0].replace(/^\//, "").replace(/\//g, "-");
}

async function checkPage(browser, baseUrl, route, width, outDir) {
  const failures = [];
  const context = await browser.newContext({ viewport: { width, height: HEIGHT } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
  try {
    const res = await page.goto(baseUrl + route, { waitUntil: "load", timeout: 30000 });
    if (!res || res.status() >= 400) failures.push(`HTTP ${res ? res.status() : "no response"}`);
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});

    const m = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      h1: document.querySelectorAll("h1").length,
      main: document.querySelectorAll("main").length,
      headerLogo: document.querySelectorAll('header a[aria-label="Khelo home"]').length,
      text: document.body.innerText,
    }));
    if (m.overflow > 1) failures.push(`horizontal scroll (+${m.overflow}px)`);
    if (m.headerLogo < 1) failures.push('header link "Khelo home" missing');
    if (m.h1 !== 1) failures.push(`expected 1 <h1>, found ${m.h1}`);
    if (m.main < 1) failures.push("no <main> landmark");
    for (const name of findPlaceholders(m.text)) failures.push(`placeholder text: ${name}`);
    for (const e of consoleErrors) failures.push(e.slice(0, 200));

    fs.mkdirSync(outDir, { recursive: true });
    await page.screenshot({ path: path.join(outDir, `${slug(route)}-${width}.png`), fullPage: true });
  } catch (e) {
    failures.push(`exception: ${String(e.message).split("\n")[0]}`);
  } finally {
    await context.close();
  }
  return failures;
}

async function main() {
  const baseUrl = (process.env.BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
  const outDir = process.env.SHOT_DIR || path.join(__dirname, "..", "design-review");
  let pw;
  try {
    pw = loadPlaywright();
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  const browser = await pw.chromium.launch();
  const rows = [];
  for (const route of ROUTES) {
    for (const width of WIDTHS) {
      const failures = await checkPage(browser, baseUrl, route, width, outDir);
      rows.push({ route, width, failures });
    }
  }
  await browser.close();

  console.log(`\nKhelo smoke: ${baseUrl}\n`);
  console.log("RESULT  ROUTE         WIDTH  DETAIL");
  for (const r of rows) {
    console.log(`${r.failures.length ? "FAIL" : "PASS"}    ${r.route.padEnd(12)}  ${String(r.width).padEnd(5)}  ${r.failures.join(" | ")}`);
  }
  const failed = rows.filter((r) => r.failures.length).length;
  console.log(`\n${rows.length - failed}/${rows.length} passed. Screenshots: ${outDir}`);
  process.exit(failed ? 1 : 0);
}

module.exports = { findPlaceholders, PLACEHOLDER_PATTERNS, ROUTES, WIDTHS };

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(2);
  });
}
