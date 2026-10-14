#!/usr/bin/env node
/**
 * Lists user-visible strings that are still hard-coded in .tsx files (so they would stay English in Roman Urdu mode).
 * Usage (from apps/web):  node scripts/find-hardcoded-strings.mjs app/dashboard/owner components/owner [--quiet]
 * It is a heuristic (regex, not a parser): it flags JSX text, string attributes that people read (placeholder, aria-label, title, alt, label,
 * aria-description), and string literals passed to alert/confirm/toast/setError/setMessage. Zero output = nothing found.
 * Lines marked `// i18n-ignore` are skipped (use only for non-copy values such as CSS class names, ids, brand names or sample data).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const targets = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const files = [];
function walk(p) {
  const st = statSync(p);
  if (st.isDirectory()) {
    for (const n of readdirSync(p)) if (n !== "node_modules" && n !== ".next") walk(join(p, n));
  } else if ([".tsx"].includes(extname(p))) files.push(p);
}
for (const t of targets) walk(t);

const ALLOW = new Set(["Khelo", "PKR", "WhatsApp", "AM", "PM", "OK", "Futsal", "Padel", "Cricket", "Tennis", "Badminton", "Ground", "Football", "Karachi", "EN"]);
const wordy = (s) => {
  const t = s.replace(/&[a-z#0-9]+;/g, " ").replace(/[^A-Za-z ]/g, " ").trim();
  if (!/[A-Za-z]{3,}/.test(t)) return false;
  const words = t.split(/\s+/).filter(Boolean);
  return !words.every((w) => ALLOW.has(w));
};

let count = 0;
for (const f of files) {
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (line.includes("i18n-ignore")) return;
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*") || trimmed.startsWith("import ")) return;
    const hits = [];
    // JSX text between tags on one line:  >Some text<
    for (const m of line.matchAll(/>([^<>{}=]*[A-Za-z][^<>{}]*)</g)) if (wordy(m[1])) hits.push(m[1].trim());
    // JSX text that starts a line (multi-line text)
    if (/^[A-Za-z][^<>{}=;]*$/.test(trimmed) && !/^\w+\s*:/.test(trimmed) && !/[\[\]]/.test(trimmed) && wordy(trimmed) && !/^(return|const|let|var|if|else|case|default|export|function|type|interface)\b/.test(trimmed)) hits.push(trimmed);
    // readable attributes
    for (const m of line.matchAll(/\b(placeholder|aria-label|title|alt|label|aria-description|aria-placeholder)="([^"]*)"/g)) if (wordy(m[2])) hits.push(`${m[1]}="${m[2]}"`);
    // strings handed to dialogs/messages
    for (const m of line.matchAll(/\b(alert|confirm|toast|setError|setMessage|setNotice|setStatus|setFormError)\(\s*(["'`])([^"'`]*[A-Za-z]{3,}[^"'`]*)\2/g)) if (wordy(m[3])) hits.push(`${m[1]}("${m[3]}")`);
    for (const h of hits) {
      count++;
      if (!process.argv.includes("--quiet")) console.log(`${f}:${i + 1}: ${h.slice(0, 140)}`);
    }
  });
}
console.log(`\n${count} hard-coded string(s) in ${files.length} file(s)`);
process.exit(0);
