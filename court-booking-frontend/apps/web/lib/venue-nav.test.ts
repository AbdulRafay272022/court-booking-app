import test from "node:test";
import assert from "node:assert/strict";
import { asSearchPath, decodeLastSearch, encodeLastSearch, resolveBackHref, searchPathFromReferrer } from "./venue-nav";

test("only same-site Search paths are accepted", () => {
  assert.equal(asSearchPath("/search"), "/search");
  assert.equal(asSearchPath("/search?city=Karachi&sport=padel"), "/search?city=Karachi&sport=padel");
  assert.equal(asSearchPath("/search?x=1#top"), "/search?x=1");
  for (const bad of ["https://evil.test/search", "//evil.test/search", "/searchx", "/venues/a", "javascript:alert(1)", "", null, undefined]) {
    assert.equal(asSearchPath(bad as string | null | undefined), null, String(bad));
  }
});

test("a stored search is used only for the venue it was stored for", () => {
  const raw = encodeLastSearch("test-arena-1", "/search?city=Karachi&area=DHA");
  assert.equal(decodeLastSearch(raw, "test-arena-1"), "/search?city=Karachi&area=DHA");
  assert.equal(decodeLastSearch(raw, "other-venue"), null);
  assert.equal(decodeLastSearch("not json", "test-arena-1"), null);
  assert.equal(decodeLastSearch(null, "test-arena-1"), null);
  assert.equal(decodeLastSearch(encodeLastSearch("test-arena-1", "https://evil.test"), "test-arena-1"), null);
});

test("referrer is honoured only for the same origin and a Search page", () => {
  const origin = "https://khelo.example";
  assert.equal(searchPathFromReferrer("https://khelo.example/search?sport=padel", origin), "/search?sport=padel");
  assert.equal(searchPathFromReferrer("https://other.example/search?sport=padel", origin), null);
  assert.equal(searchPathFromReferrer("https://khelo.example/", origin), null);
  assert.equal(searchPathFromReferrer("", origin), null);
  assert.equal(searchPathFromReferrer("garbage", origin), null);
});

test("back link falls back to /search when nothing is known", () => {
  const origin = "https://khelo.example";
  assert.equal(resolveBackHref({ stored: null, slug: "a", referrer: "", origin }), "/search");
  assert.equal(resolveBackHref({ stored: encodeLastSearch("a", "/search?city=Lahore"), slug: "a", referrer: "https://khelo.example/search?x=1", origin }), "/search?city=Lahore");
  assert.equal(resolveBackHref({ stored: null, slug: "a", referrer: "https://khelo.example/search?x=1", origin }), "/search?x=1");
});
