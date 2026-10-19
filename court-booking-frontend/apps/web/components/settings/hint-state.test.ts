import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SETTINGS_DEFAULTS, VENUE_TIMER_DEFAULTS } from "@court-booking/types";
import { BACKEND_SLOT_MINUTES_DEFAULT, defaultState, slotMinutesDefault } from "./hint-state";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..", "..", "..", "..");
const backend = (...p: string[]) => readFileSync(join(repo, "court-booking-backend", "app", ...p), "utf8");

test("timer defaults equal the spec (A.1) and the shared constant", () => {
  const want = { hold_minutes: 15, reminders_enabled: true, first_reminder_after_min: 10, repeat_every_min: 30, max_reminders: 5, auto_cancel_enabled: true, auto_cancel_after_min: 120 };
  assert.deepEqual({ ...VENUE_TIMER_DEFAULTS }, want);
  for (const k of Object.keys(want) as (keyof typeof want)[]) assert.equal(SETTINGS_DEFAULTS[k].value, want[k], k);
});

test("venue / court / pricing defaults match the backend models", () => {
  const venue = backend("models", "venue.py");
  const pricing = backend("models", "pricing.py");
  const court = backend("models", "court.py");
  assert.match(venue, /booking_horizon_days[\s\S]{0,120}default=90/);
  assert.equal(SETTINGS_DEFAULTS.booking_horizon_days.value, 90);
  assert.match(venue, /cancellation_allowed: Mapped\[bool\][\s\S]{0,120}default=True/);
  assert.equal(SETTINGS_DEFAULTS.cancellation_allowed.value, true);
  assert.match(venue, /cancellation_cutoff_hours: Mapped\[int \| None\]/);
  assert.equal(SETTINGS_DEFAULTS.cancellation_cutoff_hours.value, null);
  assert.match(pricing, /advance_percentage[\s\S]{0,120}default=100/);
  assert.equal(SETTINGS_DEFAULTS.advance_percentage.value, 100);
  assert.match(pricing, /floodlight_surcharge[\s\S]{0,120}default=0/);
  assert.equal(SETTINGS_DEFAULTS.floodlight_surcharge.value, 0);
  // slot length: backend 60, wizard prefill 90 -- each screen shows the one that really applies there
  assert.match(court, /slot_minutes: Mapped\[int\][\s\S]{0,80}default=60/);
  assert.equal(BACKEND_SLOT_MINUTES_DEFAULT, 60);
  assert.equal(slotMinutesDefault("settings"), 60);
  assert.equal(slotMinutesDefault("wizard"), 90);
});

test("defaultState: unset / same / differs", () => {
  assert.equal(defaultState(null, 15), "unset");
  assert.equal(defaultState(undefined, 15), "unset");
  assert.equal(defaultState(15, 15), "same");
  assert.equal(defaultState(20, 15), "differs");
  assert.equal(defaultState(null, null), "unset");
  assert.equal(defaultState(24, null), "differs");
  assert.equal(defaultState(false, true), "differs");
});
