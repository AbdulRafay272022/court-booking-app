import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { REMINDER_DEFAULTS } from "./reminder-schedule";
import { SETTINGS_DEFAULTS } from "./settings-defaults";
import { VENUE_TIMER_DEFAULTS } from "./stage2";

// The backend pytest compares app/services/venue_timers.py DEFAULTS with the same file.
const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "venue-timer-defaults.json");

test("VENUE_TIMER_DEFAULTS equals fixtures/venue-timer-defaults.json", () => {
  const raw = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, unknown>;
  assert.deepEqual(raw, { ...VENUE_TIMER_DEFAULTS });
});

test("reminder defaults derive from VENUE_TIMER_DEFAULTS", () => {
  assert.equal(REMINDER_DEFAULTS.firstAfterMin, VENUE_TIMER_DEFAULTS.first_reminder_after_min);
  assert.equal(REMINDER_DEFAULTS.everyMin, VENUE_TIMER_DEFAULTS.repeat_every_min);
  assert.equal(REMINDER_DEFAULTS.maxReminders, VENUE_TIMER_DEFAULTS.max_reminders);
  assert.equal(REMINDER_DEFAULTS.autoCancelMin, VENUE_TIMER_DEFAULTS.auto_cancel_after_min);
});

test("settings defaults: wizard slot prefill 90, backend court slot_minutes 60", () => {
  assert.equal(SETTINGS_DEFAULTS.slot_minutes.value, 90);
  assert.equal(SETTINGS_DEFAULTS.court_slot_minutes.value, 60);
  assert.equal(SETTINGS_DEFAULTS.court_slot_minutes.ru, "60 minute");
});
