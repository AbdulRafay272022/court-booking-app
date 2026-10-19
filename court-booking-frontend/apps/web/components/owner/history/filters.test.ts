import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHistoryQuery,
  detectPreset,
  historyLinkForBooking,
  nextSort,
  normaliseRange,
  pageCount,
  parseHistoryQuery,
  parseSort,
  presetRange,
} from "./filters";

const TODAY = "2026-10-16"; // a Friday
const ID = "3b9a41d7-1111-4222-8333-444455556666";
const getter = (qs: string) => {
  const usp = new URLSearchParams(qs);
  return (k: string) => usp.get(k);
};

test("preset ranges", () => {
  assert.deepEqual(presetRange("today", TODAY), { from: TODAY, to: TODAY });
  assert.deepEqual(presetRange("yesterday", TODAY), { from: "2026-10-15", to: "2026-10-15" });
  assert.deepEqual(presetRange("week", TODAY), { from: "2026-10-12", to: "2026-10-18" });
  assert.deepEqual(presetRange("month", TODAY), { from: "2026-10-01", to: "2026-10-31" });
  assert.deepEqual(presetRange("month", "2026-02-10"), { from: "2026-02-01", to: "2026-02-28" });
  // Monday and Sunday belong to their own Monday-first week
  assert.deepEqual(presetRange("week", "2026-10-12"), { from: "2026-10-12", to: "2026-10-18" });
  assert.deepEqual(presetRange("week", "2026-10-18"), { from: "2026-10-12", to: "2026-10-18" });
});

test("detectPreset", () => {
  assert.equal(detectPreset({ from: TODAY, to: TODAY }, TODAY), "today");
  assert.equal(detectPreset({ from: "2026-10-12", to: "2026-10-18" }, TODAY), "week");
  assert.equal(detectPreset({ from: "2026-10-01", to: "2026-10-31" }, TODAY), "month");
  assert.equal(detectPreset({ from: "2026-10-01", to: "2026-10-02" }, TODAY), "custom");
});

test("normaliseRange fixes bad input", () => {
  assert.deepEqual(normaliseRange(null, null, TODAY), { from: TODAY, to: TODAY });
  assert.deepEqual(normaliseRange("2026-10-20", "2026-10-10", TODAY), { from: "2026-10-10", to: "2026-10-20" });
  assert.deepEqual(normaliseRange("nope", "2026-10-10", TODAY), { from: "2026-10-10", to: "2026-10-10" });
  assert.deepEqual(normaliseRange("2026-02-31", null, TODAY), { from: TODAY, to: TODAY });
});

test("URL -> state defaults", () => {
  const s = parseHistoryQuery(getter(""), TODAY);
  assert.deepEqual(s, { from: TODAY, to: TODAY, courts: [], status: [], q: "", page: 1, size: 25, sort: null, booking: null });
});

test("URL -> state and back", () => {
  const qs = `from=2026-10-01&to=2026-10-31&courts=a,b&status=booked,pending&q=Usman&page=3&size=50&sort=total:desc&booking=${ID}`;
  const s = parseHistoryQuery(getter(qs), TODAY);
  assert.deepEqual(s.courts, ["a", "b"]);
  assert.deepEqual(s.status, ["booked", "pending"]);
  assert.equal(s.page, 3);
  assert.equal(s.size, 50);
  assert.deepEqual(s.sort, { field: "total", dir: "desc" });
  assert.equal(s.booking, ID);
  const back = new URLSearchParams(buildHistoryQuery(s, TODAY));
  assert.equal(back.get("from"), "2026-10-01");
  assert.equal(back.get("courts"), "a,b");
  assert.equal(back.get("status"), "booked,pending");
  assert.equal(back.get("sort"), "total:desc");
  assert.equal(back.get("booking"), ID);
  assert.deepEqual(parseHistoryQuery(getter(buildHistoryQuery(s, TODAY)), TODAY), s);
});

test("bad URL values are dropped", () => {
  const s = parseHistoryQuery(getter("status=booked,bogus&page=-2&size=7&sort=evil:up&booking=not-a-uuid"), TODAY);
  assert.deepEqual(s.status, ["booked"]);
  assert.equal(s.page, 1);
  assert.equal(s.size, 25);
  assert.equal(s.sort, null);
  assert.equal(s.booking, null);
});

test("Stage 2: status_pending is a filter value (the Overview 'status baqi' link)", () => {
  const s = parseHistoryQuery(getter("from=2025-10-20&to=2027-10-20&status=status_pending"), TODAY);
  assert.deepEqual(s.status, ["status_pending"]);
  assert.equal(new URLSearchParams(buildHistoryQuery(s, TODAY)).get("status"), "status_pending");
});

test("defaults are omitted from the query string", () => {
  assert.equal(buildHistoryQuery(parseHistoryQuery(getter(""), TODAY), TODAY), "");
});

test("sort cycling", () => {
  assert.deepEqual(nextSort(null, "due"), { field: "due", dir: "asc" });
  assert.deepEqual(nextSort({ field: "due", dir: "asc" }, "due"), { field: "due", dir: "desc" });
  assert.equal(nextSort({ field: "due", dir: "desc" }, "due"), null);
  assert.deepEqual(nextSort({ field: "due", dir: "desc" }, "total"), { field: "total", dir: "asc" });
  assert.deepEqual(parseSort("total"), { field: "total", dir: "asc" });
});

test("history link uses the booking's own PKT date", () => {
  // 2026-10-16 20:30 UTC is 2026-10-17 01:30 in Karachi (the next calendar day)
  assert.equal(historyLinkForBooking(ID, "2026-10-16T20:30:00Z"), `/dashboard/bookings?booking=${ID}&from=2026-10-17&to=2026-10-17`);
});

test("pageCount", () => {
  assert.equal(pageCount(0, 25), 1);
  assert.equal(pageCount(25, 25), 1);
  assert.equal(pageCount(26, 25), 2);
});
