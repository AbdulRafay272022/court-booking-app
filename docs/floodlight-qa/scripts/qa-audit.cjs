// In-page audit used by qa-screens.cjs on every screen visited (RN-web DOM of the Expo web build).
// Rendered-text contrast (>= 4.5, large text >= 3), icon (UI) contrast >= 3, tap targets >= 44, white text/icons on
// orange, orange primary surfaces inside owner routes, icon-only controls without a label, "…" / clipped text, and
// horizontal overflow. Returns plain JSON.
function auditInPage(opts) {
  const ORANGE = { r: 255, g: 106, b: 43 };
  const parse = (c) => {
    const m = c && c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(parseFloat);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const over = (t, b) => ({ r: t.r * t.a + b.r * (1 - t.a), g: t.g * t.a + b.g * (1 - t.a), b: t.b * t.a + b.b * (1 - t.a), a: 1 });
  const hex = (c) => "#" + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();
  const near = (c, d, tol = 4) => Math.abs(c.r - d.r) <= tol && Math.abs(c.g - d.g) <= tol && Math.abs(c.b - d.b) <= tol;
  const WHITE = { r: 255, g: 255, b: 255, a: 1 };
  const shown = (el) => {
    if (!el.getClientRects().length) return false;
    if (el.closest('[aria-hidden="true"]')) return false;
    if (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.right > 0 && r.left < window.innerWidth && r.bottom > 0 && r.top < window.innerHeight;
  };
  /** Opaque background candidates behind `el` (several for a gradient), and whether a photo is underneath. */
  function backgrounds(el) {
    const layers = [];
    let photo = false;
    let grad = null;
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e);
      const img = cs.backgroundImage;
      if (img && img !== "none") {
        if (/gradient/.test(img)) { grad = (img.match(/rgba?\([^)]+\)/g) || []).map(parse).filter(Boolean); if (grad.length) break; }
        else photo = true;
      }
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 0.999) break; }
    }
    let bases = grad && grad.length ? grad.map((g) => (g.a < 1 ? over(g, WHITE) : g)) : [WHITE];
    for (let i = layers.length - 1; i >= 0; i--) bases = bases.map((b) => over(layers[i], b));
    return { bases, photo };
  }
  const opacityOf = (el) => { let o = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity || "1"); return o; };
  const disabled = (el) => !!el.closest('[aria-disabled="true"],[disabled]');
  const label = (el) => (el.getAttribute("aria-label") || el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 50);

  const out = { textPairs: 0, textFails: [], uiPairs: 0, uiFails: [], whiteOnOrange: [], orangePrimary: [], small: [], unlabeled: [], clipped: [], ellipsis: [], overflowX: 0, onPhoto: 0, disabledSkipped: 0 };
  out.overflowX = Math.max(0, document.documentElement.scrollWidth - window.innerWidth);

  // ---- text ----
  for (const el of document.querySelectorAll("body *")) {
    if (!el.childNodes.length) continue;
    let text = "";
    for (const n of el.childNodes) if (n.nodeType === 3) text += n.textContent;
    text = text.trim();
    if (!text) continue;
    if (!shown(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden") continue;
    if (disabled(el)) { out.disabledSkipped++; continue; }
    let fg = parse(cs.color);
    if (!fg) continue;
    const op = opacityOf(el);
    const { bases, photo } = backgrounds(el);
    if (photo) out.onPhoto++;
    const size = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    let worst = Infinity, worstBg = null;
    for (const b of bases) {
      const f = over({ ...fg, a: fg.a * op }, b);
      const r = ratio(f, b);
      if (r < worst) { worst = r; worstBg = b; }
      if (fg.r >= 250 && fg.g >= 250 && fg.b >= 250 && near(b, ORANGE, 6)) out.whiteOnOrange.push(`"${text.slice(0, 30)}" white on ${hex(b)}`);
    }
    out.textPairs++;
    if (worst < need) out.textFails.push({ text: text.slice(0, 40), fg: hex(fg), bg: hex(worstBg), ratio: Math.round(worst * 100) / 100, need, size: Math.round(size * 10) / 10 });
    // clipping / ellipsis
    if (/…/.test(text)) out.ellipsis.push(text.slice(0, 50));
    const clamp = cs.webkitLineClamp && cs.webkitLineClamp !== "none";
    if ((cs.textOverflow === "ellipsis" || clamp) && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 2)) out.clipped.push(text.slice(0, 50));
  }

  // ---- interactive controls: targets, labels, icon contrast, orange surfaces ----
  const SEL = '[role="button"],[role="tab"],[role="link"],[role="checkbox"],[role="radio"],[role="switch"],button,a[href],input,textarea,[role="adjustable"]';
  for (const el of document.querySelectorAll(SEL)) {
    if (!shown(el)) continue;
    const r = el.getBoundingClientRect();
    const inner = el.parentElement && el.parentElement.closest(SEL);
    // a link/control nested inside a bigger pressable row is covered by that row's target
    if (!inner && !(el.tagName === "INPUT" && el.type === "file")) {
      if (Math.min(r.width, r.height) < 43.5 && !(r.left < 0 || r.right > window.innerWidth + 1)) out.small.push(`${label(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    const tag = el.tagName;
    if (tag !== "INPUT" && tag !== "TEXTAREA") {
      const name = (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.getAttribute("title") || el.innerText || "").trim();
      if (!name) out.unlabeled.push(`${el.getAttribute("role") || tag.toLowerCase()} ${Math.round(r.width)}x${Math.round(r.height)} testid=${el.getAttribute("data-testid") || ""}`);
    }
    if (disabled(el)) continue;
    for (const svg of el.querySelectorAll("svg")) {
      if (!shown(svg)) continue;
      const scs = getComputedStyle(svg);
      const pick = (v) => (v && v !== "none" ? (v === "currentColor" || v === "currentcolor" ? scs.color : v) : null);
      const shape = svg.querySelector("path,circle,rect,line,polyline,polygon");
      let col = null;
      if (shape) { const pcs = getComputedStyle(shape); col = parse(pick(pcs.stroke)) || parse(pick(pcs.fill)); }
      if (!col) col = parse(pick(svg.getAttribute("stroke"))) || parse(pick(svg.getAttribute("fill")));
      if (!col || col.a === 0) continue;
      const { bases } = backgrounds(svg.parentElement || el);
      out.uiPairs++;
      let worst = Infinity, wb = null;
      for (const b of bases) { const rr = ratio(over({ ...col, a: col.a * opacityOf(svg) }, b), b); if (rr < worst) { worst = rr; wb = b; } }
      if (worst < 3) out.uiFails.push({ control: label(el), icon: hex(col), bg: hex(wb), ratio: Math.round(worst * 100) / 100 });
      if (col.r >= 250 && col.g >= 250 && col.b >= 250 && bases.some((b) => near(b, ORANGE, 6))) out.whiteOnOrange.push(`icon in "${label(el)}" white on orange`);
      break;
    }
  }
  if (opts && opts.owner) {
    for (const el of document.querySelectorAll("div,button,a")) {
      if (!shown(el)) continue;
      const bg = parse(getComputedStyle(el).backgroundColor);
      if (!bg || bg.a < 0.9 || !near(bg, ORANGE, 6)) continue;
      const r = el.getBoundingClientRect();
      // allowed: the notification Badge (small pill) and the timeline "now" line (thin)
      if (r.height > 24 && (r.width > 40 || r.height > 30)) out.orangePrimary.push(`${Math.round(r.width)}x${Math.round(r.height)} "${label(el)}"`);
    }
  }
  for (const k of ["textFails", "uiFails", "whiteOnOrange", "orangePrimary", "small", "unlabeled", "clipped", "ellipsis"]) {
    const seen = new Set();
    out[k] = out[k].filter((x) => { const s = JSON.stringify(x); if (seen.has(s)) return false; seen.add(s); return true; });
  }
  return out;
}

async function audit(page, opts = {}) {
  return page.evaluate(auditInPage, opts);
}
module.exports = { audit, auditInPage };
