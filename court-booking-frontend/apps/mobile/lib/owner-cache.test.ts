import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { invalidateOwnerMoney, OWNER_MONEY_KEYS } from "./owner-cache";

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(name) && !name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

test("invalidateOwnerMoney: refreshes Overview, ledger, history, badges, approvals and refunds", async () => {
  const seen: string[] = [];
  await invalidateOwnerMoney({ invalidateQueries: async (f) => void seen.push(String(f.queryKey[0])) });
  for (const k of ["owner-overview", "owner-ledger", "owner-history", "owner-badges", "owner-approvals-queue", "owner-refunds"]) {
    assert.ok(seen.includes(k), k);
  }
  assert.equal(seen.length, OWNER_MONEY_KEYS.length);
});

test("every owner key that is invalidated is also a key some query reads (no dead keys like owner-today)", () => {
  const root = join(__dirname, "..");
  const files = ["app", "components", "lib"].flatMap((d) => sourceFiles(join(root, d)));
  const read = new Set<string>();
  const invalidated: string[] = [];
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    for (const m of text.matchAll(/queryKey: \[\s*"(owner-[a-z-]+)"/g)) read.add(m[1]);
    for (const m of text.matchAll(/invalidateQueries\(\{ queryKey: \["(owner-[a-z-]+)"/g)) invalidated.push(`${relative(root, f)} ${m[1]}`);
  }
  for (const [k] of OWNER_MONEY_KEYS) invalidated.push(`owner-cache.ts ${k}`);
  const dead = invalidated.filter((entry) => !read.has(entry.split(" ")[1]));
  assert.deepEqual(dead, []);
});
