import test from "node:test";
import assert from "node:assert/strict";
import { availabilityTag, settingLabel } from "./venue-tags";
import { mapVenuesFor } from "./map-venues";
import type { VenueSummary } from "@court-booking/types";

test("setting label", () => {
  assert.equal(settingLabel({ has_indoor: true, has_outdoor: true }), "Indoor + Outdoor");
  assert.equal(settingLabel({ has_indoor: true }), "Indoor");
  assert.equal(settingLabel({ has_outdoor: true }), "Outdoor");
  assert.equal(settingLabel({ has_indoor: false, has_outdoor: false }), null);
  assert.equal(settingLabel({}), null);
});

test("availability tag", () => {
  assert.equal(availabilityTag(4)?.label, "Aaj khali");
  assert.equal(availabilityTag(3)?.label, "Kam slots");
  assert.equal(availabilityTag(1)?.label, "Kam slots");
  for (const x of [0, null, undefined]) assert.equal(availabilityTag(x), null);
});

test("map is offered at 70 percent coordinates, min one venue", () => {
  const v = (lat?: number | null) => ({ id: "i", name: "x", slug: "x", min_price: 1, latitude: lat, longitude: lat }) as unknown as VenueSummary;
  const h = () => "/v";
  const many = (withCoords: number, without: number) => [...Array(withCoords).fill(v(24.8)), ...Array(without).fill(v(null))] as VenueSummary[];
  assert.equal(mapVenuesFor([], h).offerMap, false);
  assert.equal(mapVenuesFor([v(24.8)], h).offerMap, true);
  assert.equal(mapVenuesFor([v(undefined)], h).offerMap, false);
  assert.equal(mapVenuesFor(many(3, 2), h).offerMap, false); // 60%
  assert.equal(mapVenuesFor(many(7, 3), h).offerMap, true); // 70%
});
