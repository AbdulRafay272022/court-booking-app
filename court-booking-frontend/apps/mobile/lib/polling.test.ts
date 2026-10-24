import test from "node:test";
import assert from "node:assert/strict";
import type { Query } from "@tanstack/react-query";

import { healthPollMs, pollInterval } from "./polling";

const q = (fetchFailureCount: number) => ({ state: { fetchFailureCount } }) as unknown as Query<any, any, any, any>;

test("healthPollMs: once a minute online, every 8 s offline", () => {
  assert.equal(healthPollMs(true), 60_000);
  assert.equal(healthPollMs(false), 8_000);
});

test("pollInterval: normal interval, doubling on failures, capped at 2 minutes", () => {
  assert.equal(pollInterval(q(0), 15_000), 15_000);
  assert.equal(pollInterval(q(1), 15_000), 30_000);
  assert.equal(pollInterval(q(3), 15_000), 120_000);
  assert.equal(pollInterval(q(9), 15_000), 120_000);
});
