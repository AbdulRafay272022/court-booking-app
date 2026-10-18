import test from "node:test";
import assert from "node:assert/strict";
import { historyHref, parseQueueFilter } from "./queue-filter";

const p = (q: string) => parseQueueFilter(new URLSearchParams(q));

test("no params means no filter", () => {
  assert.deepEqual(p(""), { date: undefined, courtIds: [], active: false });
});

test("date and courts are read; junk is dropped", () => {
  const f = p("date=2026-10-16&courts=11111111-aaaa,22222222-bbbb");
  assert.equal(f.date, "2026-10-16");
  assert.deepEqual(f.courtIds, ["11111111-aaaa", "22222222-bbbb"]);
  assert.equal(f.active, true);
  assert.equal(p("date=tomorrow").date, undefined);
  assert.equal(p("date=tomorrow").active, false);
  assert.deepEqual(p("courts=x,<script>").courtIds, []);
  assert.equal(p("courts=11111111-aaaa").active, true);
});

test("history link uses the filter day, else the booking's Pakistan date", () => {
  assert.equal(historyHref("b1", "2026-10-16T10:00:00Z", "2026-10-20"), "/dashboard/bookings?booking=b1&from=2026-10-16&to=2026-10-16");
  // 22:00 UTC is already the next day in Karachi (+5)
  assert.equal(historyHref("b1", "2026-10-16T22:00:00Z"), "/dashboard/bookings?booking=b1&from=2026-10-17&to=2026-10-17");
});
