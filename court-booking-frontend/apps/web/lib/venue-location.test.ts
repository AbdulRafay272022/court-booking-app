import test from "node:test";
import assert from "node:assert/strict";
import { coordsOf, directionsUrl, pointUrl, shareText, whatsappShareUrl } from "./venue-location";

test("coordsOf accepts a real point and rejects anything else", () => {
  assert.deepEqual(coordsOf({ latitude: 24.9, longitude: 67.05 }), { lat: 24.9, lng: 67.05 });
  assert.deepEqual(coordsOf({ latitude: 0, longitude: 0 }), { lat: 0, lng: 0 });
  assert.equal(coordsOf({}), null);
  assert.equal(coordsOf({ latitude: null, longitude: 67 }), null);
  assert.equal(coordsOf({ latitude: Number.NaN, longitude: 67 }), null);
  assert.equal(coordsOf({ latitude: 91, longitude: 67 }), null);
  assert.equal(coordsOf({ latitude: 24, longitude: 181 }), null);
});

test("map links use the documented Google Maps URLs", () => {
  const c = { lat: 24.9, lng: 67.05 };
  assert.equal(directionsUrl(c), "https://www.google.com/maps/dir/?api=1&destination=24.9,67.05");
  assert.equal(pointUrl(c), "https://www.google.com/maps/search/?api=1&query=24.9,67.05");
});

test("share text is the venue name and area only", () => {
  assert.equal(shareText("Test Arena 1", "North Nazimabad", "Karachi"), "Test Arena 1, North Nazimabad");
  assert.equal(shareText("Test Arena 1", null, "Karachi"), "Test Arena 1, Karachi");
  assert.equal(shareText("Test Arena 1", null), "Test Arena 1");
});

test("whatsapp link encodes the text and the map link", () => {
  const url = whatsappShareUrl("A & B, Area", "https://www.google.com/maps/search/?api=1&query=1,2");
  assert.ok(url.startsWith("https://wa.me/?text="));
  const text = decodeURIComponent(url.slice("https://wa.me/?text=".length));
  assert.equal(text, "A & B, Area\nhttps://www.google.com/maps/search/?api=1&query=1,2");
});
