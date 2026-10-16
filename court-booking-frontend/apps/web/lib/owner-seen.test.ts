import test from "node:test";
import assert from "node:assert/strict";
import { capCount, isNaya, readSeen, releaseSnapshot, seenKey, snapshotSeen, writeSeen } from "./owner-seen";

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

test("key includes user, venue and page; missing ids give no key", () => {
  assert.equal(seenKey("u1", "v1", "approvals"), "khelo.seen.u1.v1.approvals");
  assert.notEqual(seenKey("u1", "v1", "approvals"), seenKey("u2", "v1", "approvals"));
  assert.notEqual(seenKey("u1", "v1", "approvals"), seenKey("u1", "v2", "approvals"));
  assert.equal(seenKey(undefined, "v1", "refunds"), null);
  assert.equal(seenKey("u1", undefined, "refunds"), null);
});

test("write then read; garbage and empty storage read as null", () => {
  const s = memory();
  assert.equal(readSeen("k", s), null);
  writeSeen("k", 1_700_000_000_000, s);
  assert.equal(readSeen("k", s), 1_700_000_000_000);
  s.setItem("bad", "abc");
  assert.equal(readSeen("bad", s), null);
  assert.equal(readSeen("k", null), null);
});

test("naya only when newer than the last visit; a first visit flags nothing", () => {
  const since = new Date("2026-10-16T10:00:00Z").getTime();
  assert.equal(isNaya("2026-10-16T10:00:01Z", since), true);
  assert.equal(isNaya("2026-10-16T09:59:59Z", since), false);
  assert.equal(isNaya("2026-10-16T10:00:00Z", since), false);
  assert.equal(isNaya("2026-10-16T10:00:01Z", null), false);
  assert.equal(isNaya(null, since), false);
  assert.equal(isNaya("not a date", since), false);
});

test("count badge caps at 99+ (and 9+ for the bell)", () => {
  assert.equal(capCount(0), "");
  assert.equal(capCount(-3), "");
  assert.equal(capCount(3), "3");
  assert.equal(capCount(99), "99");
  assert.equal(capCount(100), "99+");
  assert.equal(capCount(9, 9), "9");
  assert.equal(capCount(10, 9), "9+");
});

test("the visit snapshot is stable until released", () => {
  const key = "khelo.seen.test.snapshot";
  assert.equal(snapshotSeen(key), null);
  writeSeen(key, 5, memory()); // a different storage: the snapshot is untouched
  assert.equal(snapshotSeen(key), null);
  releaseSnapshot(key);
});
