// W1 web QA (Floodlight). LOCAL ONLY: web on :3001, API on :8000. Photo URLs (S3 public URL format) are served from LOCALSTACK
// (:4566) by a route handler, so the browser never contacts AWS. Every other non-localhost request is aborted.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "C:/Users/NOMANT~1/AppData/Local/Temp/pw/node_modules/playwright");
const fs = require("fs");
const path = require("path");

const BASE = "http://localhost:3001";
const API = "http://localhost:8000/api/v1";
// QA re-run (Phase E) of the W1 script against merged main: screenshots go to docs/floodlight-qa/web/ and docs/venue-card-qa/web-qa/.
const ROOT = path.resolve(__dirname, "..", "..");
const OUT_FL = path.join(ROOT, "floodlight-qa/web");
const OUT_VC = path.join(ROOT, "venue-card-qa/web-qa");
fs.mkdirSync(OUT_FL, { recursive: true });
fs.mkdirSync(OUT_VC, { recursive: true });
const states = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const ONLY = process.argv[3] || "all";

const results = [];
function check(name, ok, info = "") {
  results.push({ name, ok: !!ok, info });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${info ? " :: " + info : ""}`);
}

async function apiLogin(phone) {
  const r = await fetch(`${API}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone, password: "demo-password-123", platform: "web" }) });
  if (!r.ok) throw new Error("login " + phone + " " + r.status);
  return r.json();
}

async function newCtx(browser, { width, phone, lang = "ru" }) {
  const mobile = width < 640;
  const ctx = await browser.newContext({ viewport: { width, height: mobile ? 844 : 900 }, deviceScaleFactor: 1, hasTouch: mobile, timezoneId: "Asia/Karachi", locale: "en-US" });
  await ctx.addCookies([{ name: "khelo_lang", value: lang, url: BASE }]);
  await ctx.route(/^(?!https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/).*/, async (route) => {
    const u = route.request().url();
    if (u.startsWith("data:") || u.startsWith("blob:")) return route.continue();
    const m = u.match(/^https:\/\/court-booking-public\.s3\.[a-z0-9-]+\.amazonaws\.com\/(.+)$/);
    if (m) {
      const r = await fetch(`http://localhost:4566/court-booking-public/${m[1]}`);
      const body = Buffer.from(await r.arrayBuffer());
      return route.fulfill({ status: r.status, body, headers: { "content-type": r.headers.get("content-type") || "image/jpeg" } });
    }
    return route.abort();
  });
  if (phone) {
    const s = await apiLogin(phone);
    await ctx.addInitScript(([tok, exp, user]) => {
      if (!localStorage.getItem("maidan.session_token")) {
        localStorage.setItem("maidan.session_token", tok);
        localStorage.setItem("maidan.session_expires_at", exp);
        localStorage.setItem("maidan.cached_user", JSON.stringify(user));
      }
    }, [s.token, s.expires_at, s.user]);
  }
  return ctx;
}

async function settle(page, ms = 800) {
  try {
    await page.waitForLoadState("networkidle", { timeout: 10000 });
  } catch {}
  await page.waitForTimeout(ms);
}

// Text contrast + white-on-orange scan of the visible page (computed styles; photo areas and transparent-over-image text skipped).
async function contrastScan(page, label) {
  const res = await page.evaluate(() => {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 1;
    const cx2 = cv.getContext("2d", { willReadFrequently: true });
    function parse(c) {
      if (/^(oklab|oklch|lab|lch|color-mix|hsl)/.test(c)) {
        if (/ \/ 0\)$|, 0\)$/.test(c)) return [0, 0, 0, 0];
        cx2.clearRect(0, 0, 1, 1);
        cx2.fillStyle = c;
        cx2.fillRect(0, 0, 1, 1);
        const d = cx2.getImageData(0, 0, 1, 1).data;
        return [d[0], d[1], d[2], d[3] / 255];
      }
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) {
        const n = c.match(/color\(srgb ([^)]+)\)/);
        if (!n) return null;
        const p = n[1].split(/[\s/]+/).map(Number);
        return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] ?? 1];
      }
      const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
      return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
    }
    function lum([r, g, b]) {
      const f = (v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    }
    function ratio(a, b) {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    }
    function blend(top, under) {
      const a = top[3];
      return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1];
    }
    function bgOf(el) {
      const stack = [];
      let e = el;
      while (e && e.nodeType === 1) {
        const cs = getComputedStyle(e);
        if (cs.backgroundImage && cs.backgroundImage !== "none" && !cs.backgroundImage.startsWith("linear-gradient")) return null;
        if (e.tagName === "IMG" || e.tagName === "VIDEO") return null;
        // photo carousel / gallery frames: text over photos is checked by design (on-photo scrims), skip
        if (e.matches && e.matches('[aria-roledescription="carousel"], [data-testid="venue-gallery"] .relative, [data-testid="gallery-full"]')) return null;
        const c = parse(cs.backgroundColor);
        if (c && c[3] > 0) {
          stack.push(c);
          if (c[3] >= 1) break;
        }
        e = e.parentElement;
      }
      let base = [255, 255, 255, 1];
      for (let i = stack.length - 1; i >= 0; i--) base = blend(stack[i], base);
      return base;
    }
    const out = { fails: [], whiteOnOrange: [], checked: 0 };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (!n.textContent.trim()) continue;
      const el = n.parentElement;
      if (!el || seen.has(el)) continue;
      seen.add(el);
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
      if (el.closest("[aria-hidden='true'], .sr-only, svg, script, style, noscript")) continue;
      // disabled controls are exempt from 1.4.3
      if (el.closest("button:disabled, [aria-disabled='true']")) continue;
      let op = 1;
      for (let e = el; e; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
      if (op < 0.99) continue;
      const fg = parse(cs.color);
      const bg = bgOf(el);
      if (!fg || !bg) continue;
      const fgB = fg[3] < 1 ? blend(fg, bg) : fg;
      const rr = ratio(fgB, bg);
      const size = parseFloat(cs.fontSize);
      const bold = Number(cs.fontWeight) >= 700;
      const large = size >= 24 || (bold && size >= 18.66);
      const need = large ? 3 : 4.5;
      out.checked++;
      const isWhite = fgB[0] > 245 && fgB[1] > 245 && fgB[2] > 245;
      const isOrange = Math.abs(bg[0] - 255) < 6 && Math.abs(bg[1] - 106) < 8 && Math.abs(bg[2] - 43) < 8;
      if (isWhite && isOrange) out.whiteOnOrange.push(n.textContent.trim().slice(0, 40));
      if (rr < need - 0.01) out.fails.push(`${n.textContent.trim().slice(0, 40)} | ${rr.toFixed(2)} | fg ${cs.color} bg rgb(${bg.slice(0, 3).map(Math.round)}) | ${size}px`);
    }
    return out;
  });
  check(`contrast ${label}: text >= 4.5 (large 3) [${res.checked} checked]`, res.fails.length === 0, res.fails.slice(0, 6).join(" || "));
  check(`contrast ${label}: no white on orange`, res.whiteOnOrange.length === 0, res.whiteOnOrange.slice(0, 4).join(", "));
  return res;
}

async function noHorizontalOverflow(page, label) {
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`${label}: no horizontal page scroll`, ov <= 1, `overflow ${ov}px`);
}

const stripTransform = (card) => card.evaluate((el) => {
  const s = el.querySelector('[aria-roledescription="carousel"] > div.flex');
  return s ? s.style.transform : null;
});

async function searchChecks(browser, width) {
  const ctx = await newCtx(browser, { width, phone: "+923000000003" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => check(`search ${width}: no page error`, false, String(e).slice(0, 200)));
  await page.goto(`${BASE}/search?city=Lahore`);
  await settle(page, 1500);
  const cards = page.locator('[data-testid="fl-venue-card"]');
  const n = await cards.count();
  check(`search ${width}: Floodlight VenueCards rendered`, n >= 5, `${n} cards`);
  await noHorizontalOverflow(page, `search ${width}`);
  // real photos (from the API, served from localstack)
  const gul = cards.filter({ hasText: "Gulberg Padel Club" });
  await gul.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  const imgOk = await gul.evaluate((el) => {
    const im = el.querySelector("img");
    return im ? im.complete && im.naturalWidth > 0 && /amazonaws\.com\/venues\//.test(im.currentSrc || im.src) : false;
  });
  check(`search ${width}: card shows the venue's real uploaded photo`, imgOk);
  const dots = await gul.locator('[aria-roledescription="carousel"] span[aria-hidden] > span').count();
  check(`search ${width}: 6-photo card has 6 dots`, dots === 6, `${dots}`);
  const noPhoto = cards.filter({ hasText: "Bahria Sports Hub" });
  check(`search ${width}: 0-photo card = placeholder (no img)`, (await noPhoto.locator("img").count()) === 0);
  const one = cards.filter({ hasText: "Johar Town Cricket Nets" });
  check(`search ${width}: 1-photo card has no arrows/dots`, (await one.getByRole("button", { name: /Agli photo|Next photo/ }).count()) === 0);
  await page.screenshot({ path: path.join(OUT_VC, `search-${width}.png`), fullPage: false });
  await page.screenshot({ path: path.join(OUT_FL, `search-${width}-full.png`), fullPage: true });

  // autoplay advances (mouse away from the card)
  await page.mouse.move(1, 1);
  const t0 = await stripTransform(gul);
  await page.waitForTimeout(4200);
  const t1 = await stripTransform(gul);
  check(`search ${width}: autoplay advances (3.5 s) while visible`, t0 !== t1, `${t0} -> ${t1}`);

  if (width >= 768) {
    // hover pauses + arrows appear
    const box = await gul.locator('[aria-roledescription="carousel"]').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(500);
    const next = gul.getByRole("button", { name: /Agli photo|Next photo/ });
    const op = await next.evaluate((el) => getComputedStyle(el).opacity);
    check(`search ${width}: hover shows 44px arrows`, Number(op) > 0.9 && (await next.boundingBox()).width >= 44, `opacity ${op}`);
    const h0 = await stripTransform(gul);
    await page.waitForTimeout(4300);
    const h1 = await stripTransform(gul);
    check(`search ${width}: hover pauses autoplay`, h0 === h1, `${h0} -> ${h1}`);
    await next.click();
    await page.waitForTimeout(600);
    check(`search ${width}: next arrow moves the photo`, (await stripTransform(gul)) !== h1);
    await page.screenshot({ path: path.join(OUT_VC, `search-${width}-hover-arrows.png`) });
  }

  // amenities popover on the LAST card of the first row and on the LAST card of the list
  const geo = await cards.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top + window.scrollY));
  const firstTop = geo[0];
  let lastInRow = 0;
  geo.forEach((tp, i) => {
    if (Math.abs(tp - firstTop) < 4) lastInRow = i;
  });
  const targets = [...new Set([lastInRow, n - 1])];
  for (const idx of targets) {
    const card = cards.nth(idx);
    const chip = card.locator('[data-testid="venue-card-amenities"]');
    if ((await chip.count()) === 0) {
      check(`search ${width}: card #${idx + 1} has no amenities -> chip hidden`, true);
      continue;
    }
    await chip.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    if (width >= 768) await chip.hover();
    else await chip.click();
    const dlg = card.getByRole("dialog");
    await dlg.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
    const vis = await dlg.isVisible();
    let inside = false;
    let onTop = false;
    if (vis) {
      const b = await dlg.boundingBox();
      const vw = width;
      const vh = await page.evaluate(() => window.innerHeight);
      inside = b.x >= 0 && b.y >= 0 && b.x + b.width <= vw + 1 && b.y + b.height <= vh + 1;
      onTop = await dlg.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const pts = [[r.left + 8, r.top + 8], [r.right - 8, r.top + 8], [r.left + 8, r.bottom - 8], [r.right - 8, r.bottom - 8], [r.left + r.width / 2, r.top + r.height / 2]];
        return pts.every(([x, y]) => {
          const hit = document.elementFromPoint(x, y);
          return hit && el.contains(hit);
        });
      });
    }
    check(`search ${width}: amenities popover opens (card #${idx + 1}${idx === lastInRow ? ", last in row" : ""}${idx === n - 1 ? ", last card" : ""})`, vis);
    check(`search ${width}: popover inside viewport + not clipped/covered (card #${idx + 1})`, inside && onTop, `inside=${inside} onTop=${onTop}`);
    await page.screenshot({ path: path.join(OUT_VC, `search-${width}-popover-card${idx + 1}.png`) });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    check(`search ${width}: Esc closes the popover (card #${idx + 1})`, !(await dlg.isVisible()));
    await page.mouse.move(1, 1);
  }

  // keyboard: Tab to the first amenities chip opens it; Esc closes
  const firstChip = page.locator('[data-testid="venue-card-amenities"]').first();
  await firstChip.focus();
  await page.waitForTimeout(250);
  const kdlg = page.getByRole("dialog").first();
  check(`search ${width}: keyboard focus on the chip opens the list`, await kdlg.isVisible());
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  check(`search ${width}: Esc closes it from the keyboard`, !(await page.getByRole("dialog").first().isVisible().catch(() => false)));
  // focus inside a card pauses autoplay (keyboard users)
  await gul.getByRole("link", { name: "Gulberg Padel Club" }).focus();
  await page.waitForTimeout(300);
  const f0 = await stripTransform(gul);
  await page.waitForTimeout(4200);
  const f1 = await stripTransform(gul);
  check(`search ${width}: keyboard focus inside the card pauses autoplay`, f0 !== null && f0 === f1, `${f0} -> ${f1}`);
  await page.mouse.move(1, 1);
  await page.locator("body").focus().catch(() => {});
  await contrastScan(page, `search ${width}`);
  await ctx.close();
}

async function venueChecks(browser, width) {
  const ctx = await newCtx(browser, { width, phone: "+923000000003" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => check(`venue ${width}: no page error`, false, String(e).slice(0, 200)));
  await page.goto(`${BASE}/venues/${states.venue_slug}`);
  await settle(page, 1500);
  await noHorizontalOverflow(page, `venue ${width}`);
  const counter = page.locator('[data-testid="venue-gallery"] [data-testid="gallery-counter"]');
  const c0 = (await counter.textContent())?.trim();
  check(`venue ${width}: hero counter shows 1/6`, c0 === "1/6", c0);
  await page.waitForTimeout(4500);
  check(`venue ${width}: hero does not autoplay`, (await counter.textContent())?.trim() === "1/6");
  await page.locator('[data-testid="venue-gallery"]').getByRole("button", { name: /Agli tasveer|Next photo/ }).first().click();
  check(`venue ${width}: next arrow -> 2/6`, (await counter.textContent())?.trim() === "2/6");
  await page.screenshot({ path: path.join(OUT_FL, `venue-${width}.png`) });
  await contrastScan(page, `venue ${width}`);
  await page.locator('[data-testid="venue-gallery"] [data-testid="gallery-open"]').click();
  const full = page.locator('[data-testid="gallery-full"]');
  await full.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  check(`venue ${width}: click opens full-screen gallery`, await full.isVisible());
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(200);
  check(`venue ${width}: arrow key moves photo in full screen`, /3\/6/.test((await full.textContent()) ?? ""));
  await page.screenshot({ path: path.join(OUT_VC, `venue-${width}-fullscreen-gallery.png`) });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check(`venue ${width}: Esc closes full-screen gallery`, !(await full.isVisible().catch(() => false)));

  // day popup slot states for the seeded day
  const courtCard = page.locator('[data-testid="court-card-Court 1"]');
  await courtCard.scrollIntoViewIfNeeded();
  await courtCard.locator(`button[aria-label*="${states.date}"]`).first().click();
  await page.waitForTimeout(1500);
  const dlg = page.getByRole("dialog").first();
  const stateCount = async (st) => dlg.locator(`[data-state="${st}"]`).count();
  const counts = {};
  for (const st of ["open", "held", "booked", "blocked", "mine", "noRoom"]) counts[st] = await stateCount(st);
  check(`venue ${width}: slot list has open/held/booked/blocked/mine rows`, counts.open > 0 && counts.held >= 4 && counts.booked >= 2 && counts.blocked >= 2 && counts.mine >= 6, JSON.stringify(counts));
  // held-by-others never reads as booked and is dashed + hourglass
  const heldInfo = await dlg.locator('[data-state="held"]').first().evaluate((el) => ({ dashed: getComputedStyle(el).borderStyle.includes("dashed"), icon: !!el.querySelector("svg"), text: el.innerText }));
  check(`venue ${width}: held by someone else = dashed + icon + "Kisi ne hold kiya"`, heldInfo.dashed && heldInfo.icon && /Kisi ne hold kiya/.test(heldInfo.text), JSON.stringify(heldInfo));
  const bookedStrike = await dlg.locator('[data-state="booked"] button').first().evaluate((el) => getComputedStyle(el.querySelector("span")).textDecorationLine);
  check(`venue ${width}: booked = strikethrough`, /line-through/.test(bookedStrike), bookedStrike);
  const mineTexts = await dlg.locator('[data-state="mine"]').allInnerTexts();
  const pakki = mineTexts.filter((x) => /Pakki/.test(x)).length;
  check(`venue ${width}: own rows honest (Pakki only on the booked one: 4 rows of 30 min = 2 slots x 1 booking)`, pakki === 2 && mineTexts.some((x) => /Venue check/.test(x)) && mineTexts.some((x) => /Hold/.test(x)), `pakki rows ${pakki}; ${mineTexts.map((x) => x.replace(/\s+/g, " ")).join(" | ").slice(0, 200)}`);
  await page.screenshot({ path: path.join(OUT_FL, `venue-${width}-slot-states.png`) });
  await dlg.locator('[data-state="mine"]').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT_FL, `venue-${width}-slot-states-mine-booked.png`) });
  await dlg.locator('[data-state="held"]').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT_FL, `venue-${width}-slot-states-held-mine.png`) });
  await contrastScan(page, `venue ${width} day popup`);
  // confirm sheet from a real quote + cancel policy
  await dlg.locator('[data-testid="slot-open"]').first().click();
  const sheet = page.locator('[data-testid="confirm-sheet"]');
  await sheet.waitFor({ state: "visible", timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const sheetText = (await sheet.textContent()) ?? "";
  check(`venue ${width}: confirm sheet shows Total / advance / balance from the quote`, /Total/.test(sheetText) && /Abhi advance/.test(sheetText) && /Venue par baqi/.test(sheetText) && /PKR/.test(sheetText), sheetText.slice(0, 160));
  check(`venue ${width}: confirm sheet shows the venue cancel policy`, (await sheet.locator('[data-testid="sheet-policy"]').count()) === 1);
  const btnColors = await sheet.getByRole("button", { name: /Aage barhein/ }).evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).color]);
  check(`venue ${width}: player primary = orange with ink text`, btnColors[0] === "rgb(255, 106, 43)" && btnColors[1] === "rgb(12, 31, 29)", btnColors.join(" / "));
  await page.screenshot({ path: path.join(OUT_FL, `venue-${width}-confirm-sheet.png`) });
  await contrastScan(page, `venue ${width} confirm sheet`);
  await ctx.close();
}

async function statusChecks(browser, width) {
  const ctx = await newCtx(browser, { width, phone: "+923000000003" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => check(`status ${width}: no page error`, false, String(e).slice(0, 200)));
  const cases = [
    ["held", `/booking/${states.mine_held}/pay`, /Hold · Pay baqi/, false],
    ["submitted-pay", `/booking/${states.mine_submitted}/pay`, /Venue check/, false],
    ["submitted-done", `/booking/${states.mine_submitted}/done`, /Venue check/, false],
    ["booked", `/booking/${states.mine_booked}/done`, /Pakki ✓/, true],
  ];
  for (const [name, url, re, booked] of cases) {
    await page.goto(BASE + url);
    await settle(page, 1800);
    const txt = await page.locator("main").innerText();
    check(`status ${width} ${name}: honest label`, re.test(txt), txt.replace(/\s+/g, " ").slice(0, 140));
    const saysYours = /Court aapka hai|Court is yours/.test(txt);
    check(`status ${width} ${name}: "Court aapka hai"/QR only when booked`, booked ? saysYours && (await page.locator('[data-testid="ticket"] svg').count()) > 0 : !saysYours && !/Pakki ✓/.test(txt));
    if (name === "held") {
      check(`status ${width} held: countdown ring from held_until`, (await page.getByRole("timer").count()) === 1);
      const steps = await page.locator('[data-testid="pay-journey"] li').count();
      check(`status ${width} held: journey Hold -> Screenshot -> Venue check -> Pakki`, steps === 4);
    }
    await noHorizontalOverflow(page, `status ${width} ${name}`);
    await page.screenshot({ path: path.join(OUT_FL, `status-${width}-${name}.png`), fullPage: true });
    await contrastScan(page, `status ${width} ${name}`);
  }
  await page.goto(`${BASE}/bookings`);
  await settle(page, 1800);
  await page.screenshot({ path: path.join(OUT_FL, `bookings-${width}.png`), fullPage: true });
  await contrastScan(page, `bookings ${width}`);
  await ctx.close();
}

async function ownerChecks(browser, width) {
  const ctx = await newCtx(browser, { width, phone: "+923000000002" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => check(`owner ${width}: no page error`, false, String(e).slice(0, 200)));
  for (const route of ["today", "approvals", "ledger", "walkin", "refunds", "growth", "staff"]) {
    await page.goto(`${BASE}/dashboard/owner/${route}`);
    await settle(page, 1800);
    if (route === "today" && width >= 1024) {
      const nav = page.locator('[data-testid="nav-today"]');
      const [bg, fg] = await nav.evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).color]);
      check(`owner ${width}: active nav is the teal role pill (white text)`, bg === "rgb(14, 124, 116)" && fg === "rgb(255, 255, 255)", `${bg} / ${fg}`);
    }
    const orangeBtns = await page.evaluate(() =>
      [...document.querySelectorAll("button, a")]
        .filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 60 && r.height >= 30 && getComputedStyle(e).backgroundColor === "rgb(255, 106, 43)";
        })
        .map((e) => e.innerText.trim().slice(0, 30)),
    );
    check(`owner ${width} ${route}: no orange primary action`, orangeBtns.length === 0, orangeBtns.join(", "));
    if (route === "walkin") {
      const chip = page.locator("button[aria-pressed]").first();
      check(`owner ${width} walkin: selected chips are aria-pressed Chips`, (await chip.count()) > 0);
    }
    await noHorizontalOverflow(page, `owner ${width} ${route}`);
    await page.screenshot({ path: path.join(OUT_FL, `owner-${width}-${route}.png`), fullPage: true });
    await contrastScan(page, `owner ${width} ${route}`);
  }
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  for (const w of [390, 768, 1280]) {
    if (ONLY === "all" || ONLY === "search") await searchChecks(browser, w);
    if (ONLY === "all" || ONLY === "venue") await venueChecks(browser, w);
    if (ONLY === "all" || ONLY === "status") await statusChecks(browser, w);
    if (ONLY === "all" || ONLY === "owner") await ownerChecks(browser, w);
  }
  await browser.close();
  const fails = results.filter((r) => !r.ok);
  console.log(`\nTOTAL ${results.length} checks, ${results.length - fails.length} pass, ${fails.length} fail`);
  fs.writeFileSync(path.join(__dirname, `w1_qa_results_${ONLY}.json`), JSON.stringify(results, null, 1));
})();
