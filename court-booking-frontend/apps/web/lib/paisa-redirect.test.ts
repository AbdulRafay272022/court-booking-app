import assert from "node:assert/strict";
import test from "node:test";

import { paisaHref, parsePaisaTab } from "./paisa-redirect";

test("old money URLs land on the right Paisa tab and keep their query", () => {
  assert.equal(paisaHref("hisaab"), "/dashboard/owner/paisa");
  assert.equal(paisaHref("bank"), "/dashboard/owner/paisa?tab=bank");
  assert.equal(paisaHref("baqi"), "/dashboard/owner/paisa?tab=baqi");
  assert.equal(paisaHref("wapas", { date: "2026-11-07", court: ["a", "b"], tab: "x" }), "/dashboard/owner/paisa?tab=wapas&date=2026-11-07&court=a&court=b");
  assert.equal(parsePaisaTab("bank"), "bank");
  assert.equal(parsePaisaTab("nope"), "hisaab");
  assert.equal(parsePaisaTab(null), "hisaab");
});
