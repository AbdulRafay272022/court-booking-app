// Renders a design board (design/khelo-mobile-floodlight/<Board>.dc.html) WITHOUT the design tool's support.js:
// a tiny stand-in for <x-dc>: runs the board's `class Component extends DCLogic { renderVals() }`, fills {{holes}},
// expands <sc-for list as> / <sc-if value>, binds onClick handlers (setState re-renders). Fonts come from the local
// @expo-google-fonts packages (no Google Fonts request); every non-file request is blocked.
// API: renderBoard(browser, file, { props, state, out, scale }) -> { width, height, frames } and writes `out` (PNG).
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const FONTS = path.join(ROOT, "court-booking-frontend", "node_modules", "@expo-google-fonts");
function fontFaces() {
  const out = [];
  const add = (family, pkg, w, file) => {
    const p = path.join(FONTS, pkg, file);
    if (fs.existsSync(p)) out.push(`@font-face{font-family:'${family}';font-weight:${w};font-style:normal;src:url('${pathToFileURL(p).href}') format('truetype')}`);
  };
  for (const [w, n] of [[400, "400Regular"], [500, "500Medium"], [600, "600SemiBold"], [700, "700Bold"], [800, "800ExtraBold"]]) {
    add("Bricolage Grotesque", "bricolage-grotesque", w, `${n}/BricolageGrotesque_${n}.ttf`);
    add("Plus Jakarta Sans", "plus-jakarta-sans", w, `${n}/PlusJakartaSans_${n}.ttf`);
  }
  return out.join("\n");
}

function parseBoard(file) {
  const src = fs.readFileSync(file, "utf8");
  const xdc = src.slice(src.indexOf("<x-dc>") + 6, src.lastIndexOf("</x-dc>") >= 0 ? src.lastIndexOf("</x-dc>") : src.indexOf('<script type="text/x-dc"'));
  const helmet = (xdc.match(/<helmet>([\s\S]*?)<\/helmet>/) || [, ""])[1].replace(/<link[^>]*>/g, "");
  let body = xdc.replace(/<helmet>[\s\S]*?<\/helmet>/, "").replace(/<script[\s\S]*?<\/script>/g, "").replace(/<script[^>]*>/g, "");
  const m = src.match(/<script type="text\/x-dc"([^>]*)>([\s\S]*?)<\/script>/);
  const attrs = m ? m[1] : "";
  const code = m ? m[2] : "";
  const propsJson = (attrs.match(/data-props='([^']*)'/) || [, "{}"])[1];
  let propsDef = {};
  try { propsDef = JSON.parse(propsJson); } catch {}
  const defaults = {};
  for (const [k, v] of Object.entries(propsDef)) if (!k.startsWith("$") && v && "default" in v) defaults[k] = v.default;
  const preview = propsDef.$preview || { width: 390, height: 1200 };
  return { helmet, body, code, defaults, preview };
}

const RUNTIME = `
(function(){
  const TPL = document.getElementById('dc-tpl');
  const ROOT = document.getElementById('dc-root');
  class DCLogic { constructor(props){ this.props = props || {}; this.state = {}; } setState(p){ const n = typeof p === 'function' ? p(this.state, this.props) : p; this.state = Object.assign({}, this.state, n); render(); } }
  window.DCLogic = DCLogic;
  let comp = null;
  try { comp = new (new Function('DCLogic', window.__DC_CODE + '\\n;return typeof Component !== "undefined" ? Component : null;')(DCLogic))(window.__DC_PROPS); } catch (e) { window.__DC_ERR = String(e); }
  if (comp && window.__DC_STATE) comp.state = Object.assign({}, comp.state, window.__DC_STATE);
  function evalExpr(expr, scope) {
    try { return new Function('__s', 'with(__s){ return (' + expr + '); }')(scope); } catch (e) { return undefined; }
  }
  const HOLE = /\\{\\{([\\s\\S]*?)\\}\\}/g;
  function interp(str, scope) {
    const whole = str.match(/^\\s*\\{\\{([\\s\\S]*?)\\}\\}\\s*$/);
    if (whole) return { raw: true, v: evalExpr(whole[1], scope) };
    return { raw: false, v: str.replace(HOLE, (_, e) => { const v = evalExpr(e, scope); return v == null ? '' : String(v); }) };
  }
  function build(node, scope, parent) {
    if (node.nodeType === 3) { parent.appendChild(document.createTextNode(interp(node.textContent, scope).v ?? '')); return; }
    if (node.nodeType !== 1) return;
    const tag = node.localName.toLowerCase();
    if (tag === 'sc-for') {
      const list = interp(node.getAttribute('list') || '', scope).v || [];
      const as = node.getAttribute('as') || 'item';
      (Array.isArray(list) ? list : []).forEach((item, i) => { const s = Object.create(scope); s[as] = item; s[as + 'Index'] = i; s.$index = i; for (const c of node.childNodes) build(c, s, parent); });
      return;
    }
    if (tag === 'sc-if') { const v = interp(node.getAttribute('value') || '', scope).v; if (v) for (const c of node.childNodes) build(c, scope, parent); return; }
    const el = document.createElementNS(node.namespaceURI, node.localName);
    for (const a of node.attributes) {
      const r = interp(a.value, scope);
      const name = a.name;
      if (/^on/i.test(name)) { if (typeof r.v === 'function') el.addEventListener(name.slice(2).toLowerCase(), (ev) => r.v(ev)); continue; }
      if (r.raw) {
        if (r.v === false || r.v == null) { if (/^aria-/.test(name)) el.setAttribute(name, 'false'); continue; }
        if (r.v === true) { el.setAttribute(name, /^aria-/.test(name) ? 'true' : ''); continue; }
        el.setAttribute(name, String(r.v));
      } else el.setAttribute(name, r.v);
    }
    const kids = tag === 'template' ? node.content.childNodes : node.childNodes;
    for (const c of kids) build(c, scope, el);
    parent.appendChild(el);
  }
  function render() {
    let vals = {};
    try { vals = comp && comp.renderVals ? comp.renderVals() || {} : {}; } catch (e) { window.__DC_ERR = String(e); }
    const scope = Object.assign(Object.create(null), { props: window.__DC_PROPS }, window.__DC_PROPS, vals);
    ROOT.innerHTML = '';
    for (const c of TPL.content.childNodes) build(c, scope, ROOT);
  }
  window.__dcRender = render;
  render();
})();
`;

function boardHtml(file, { props = {}, state = null } = {}) {
  const b = parseBoard(file);
  const p = { ...b.defaults, ...props };
  return {
    preview: b.preview,
    html: `<!doctype html><html><head><meta charset="utf-8"><style>${fontFaces()}</style>${b.helmet}<style>html,body{margin:0;background:#fff}#dc-root{display:inline-block}</style></head>
<body><template id="dc-tpl">${b.body}</template><div id="dc-root"></div>
<script>window.__DC_CODE=${JSON.stringify(b.code)};window.__DC_PROPS=${JSON.stringify(p)};window.__DC_STATE=${JSON.stringify(state)};</script>
<script>${RUNTIME}</script></body></html>`,
  };
}

async function renderBoard(browser, file, { props, state, out, scale = 1, page: existing } = {}) {
  const { html, preview } = boardHtml(file, { props, state });
  const tmp = path.join(require("os").tmpdir(), `board-${path.basename(file, ".dc.html")}-${process.pid}-${Date.now()}.html`);
  fs.writeFileSync(tmp, html);
  const ctx = existing ? null : await browser.newContext({ viewport: { width: Math.max(390, preview.width || 390), height: 900 }, deviceScaleFactor: scale });
  const page = existing || (await ctx.newPage());
  await page.route(/^(?!file:|data:|blob:).*/, (r) => r.abort());
  await page.goto(pathToFileURL(tmp).href);
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.waitForTimeout(300);
  const info = await page.evaluate(() => {
    const root = document.getElementById("dc-root");
    const r = root.getBoundingClientRect();
    return { width: Math.ceil(r.width), height: Math.ceil(r.height), err: window.__DC_ERR || null };
  });
  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await page.locator("#dc-root").screenshot({ path: out, animations: "disabled" });
  }
  if (ctx) await ctx.close();
  fs.unlinkSync(tmp);
  return info;
}

module.exports = { renderBoard, boardHtml, parseBoard };

if (require.main === module) {
  // node board-render.cjs <Board> [out.png] [stateJson] [propsJson]
  const { chromium } = require(process.env.PLAYWRIGHT_PATH);
  (async () => {
    const b = await chromium.launch();
    const name = process.argv[2];
    const file = path.join(ROOT, "design", "khelo-mobile-floodlight", `${name}.dc.html`);
    const info = await renderBoard(b, file, { out: process.argv[3] || `${name}.png`, state: process.argv[4] ? JSON.parse(process.argv[4]) : null, props: process.argv[5] ? JSON.parse(process.argv[5]) : {} });
    console.log(JSON.stringify(info));
    await b.close();
  })();
}
