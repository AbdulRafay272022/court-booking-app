import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { VENUE_TIMER_DEFAULTS } from "@court-booking/types";
import {
  EMPTY_TIMER_DRAFT,
  FILLED_TIMER_DRAFT,
  draftFromValues,
  draftHasValues,
  effectiveFromDraft,
  timerPreview,
  validateTimers,
  valuesFromDraft,
} from "./venue-timers";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..", "..");
const src = (...p: string[]) => readFileSync(join(web, ...p), "utf8");

test("parity: Venue Settings and the wizard render the SAME timers fields and save the same values", () => {
  const card = src("components", "setup", "venue-timers-card.tsx");
  const settings = src("app", "dashboard", "owner", "settings", "page.tsx");
  const wizard = src("app", "venue-setup", "courts", "page.tsx");
  // Settings uses VenueTimersCard, which renders VenueTimersFields and PUTs valuesFromDraft(draft)
  assert.match(settings, /<VenueTimersCard\b/);
  assert.match(card, /<VenueTimersFields\b/);
  assert.match(card, /updateVenueTimers\(venueId, valuesFromDraft\(draft\)\)/);
  // the wizard renders the same VenueTimersFields and PUTs valuesFromDraft(...) right after the venue exists
  assert.match(wizard, /<VenueTimersFields\b/);
  assert.match(wizard, /updateVenueTimers\(venueId, valuesFromDraft\(/);
  const createAt = wizard.indexOf("api.venues.create(");
  const putAt = wizard.indexOf("updateVenueTimers(");
  assert.ok(createAt > 0 && putAt > createAt, "timers are PUT after the venue is created");
  // the old preview-only card is gone everywhere
  assert.doesNotMatch(settings + wizard, /PaymentRemindersCard/);
});

test("null = default; an empty draft sends all nulls and runs today's defaults", () => {
  assert.deepEqual(valuesFromDraft(EMPTY_TIMER_DRAFT), {
    hold_minutes: null,
    reminders_enabled: null,
    first_reminder_after_min: null,
    repeat_every_min: null,
    max_reminders: null,
    auto_cancel_enabled: null,
    auto_cancel_after_min: null,
  });
  assert.equal(draftHasValues(EMPTY_TIMER_DRAFT), false);
  assert.deepEqual(effectiveFromDraft(EMPTY_TIMER_DRAFT), VENUE_TIMER_DEFAULTS);
  // the default auto-cancel is ON at 120 (spec A.1)
  assert.equal(effectiveFromDraft(EMPTY_TIMER_DRAFT).auto_cancel_enabled, true);
  assert.equal(effectiveFromDraft(EMPTY_TIMER_DRAFT).auto_cancel_after_min, 120);
});

test("audit item 15: a server null is shown (and saved) as the real default value", () => {
  const v = { ...valuesFromDraft(EMPTY_TIMER_DRAFT), hold_minutes: 20, auto_cancel_enabled: false };
  const d = draftFromValues(v);
  assert.equal(d.hold_minutes, "20");
  assert.equal(d.first_reminder_after_min, "10"); // was null on the server: the default, as a value
  assert.equal(valuesFromDraft(d).first_reminder_after_min, 10);
  assert.equal(draftHasValues(d), true);
  assert.equal(FILLED_TIMER_DRAFT.hold_minutes, "15");
});

test("validation mirrors the backend CHECKs and an empty box is required", () => {
  const ok = validateTimers(FILLED_TIMER_DRAFT, "en");
  assert.deepEqual(ok.errors, {});
  assert.ok(validateTimers({ ...FILLED_TIMER_DRAFT, hold_minutes: "4" }, "en").errors.hold_minutes);
  assert.ok(validateTimers({ ...FILLED_TIMER_DRAFT, hold_minutes: "181" }, "ru").errors.hold_minutes);
  assert.equal(validateTimers({ ...FILLED_TIMER_DRAFT, hold_minutes: "180" }, "en").errors.hold_minutes, undefined);
  assert.ok(validateTimers({ ...FILLED_TIMER_DRAFT, max_reminders: "11" }, "en").errors.max_reminders);
  assert.ok(validateTimers({ ...FILLED_TIMER_DRAFT, repeat_every_min: "4" }, "en").errors.repeat_every_min);
  assert.ok(validateTimers({ ...FILLED_TIMER_DRAFT, auto_cancel_after_min: "1441" }, "en").errors.auto_cancel_after_min);
  // auto-cancel off: its minutes are ignored
  assert.deepEqual(validateTimers({ ...FILLED_TIMER_DRAFT, auto_cancel_enabled: false, auto_cancel_after_min: "1" }, "en").errors, {});
  // reminders off: the reminder boxes are ignored
  assert.deepEqual(validateTimers({ ...FILLED_TIMER_DRAFT, reminders_enabled: false, max_reminders: "99" }, "en").errors, {});
  // required: an emptied or never-filled box is an error, not "the default"
  assert.equal(validateTimers({ ...FILLED_TIMER_DRAFT, hold_minutes: "" }, "en").errors.hold_minutes, "This is required.");
  assert.equal(validateTimers({ ...FILLED_TIMER_DRAFT, repeat_every_min: null }, "ru").errors.repeat_every_min, "Ye bharna zaroori hai.");
  assert.ok(Object.keys(validateTimers(EMPTY_TIMER_DRAFT, "en").errors).length >= 2);
});

test("live preview from the effective values", () => {
  assert.equal(timerPreview(FILLED_TIMER_DRAFT, "en"), "Reminders at 10, 40, 70, 100 minutes. Final warning at 115, cancel at 120.");
  assert.equal(
    timerPreview({ ...FILLED_TIMER_DRAFT, auto_cancel_enabled: false }, "ru"),
    "Reminder 10, 40, 70, 100, 130 minute par. Auto-cancel band hai.",
  );
  assert.equal(timerPreview({ ...FILLED_TIMER_DRAFT, reminders_enabled: false }, "en"), "No reminders will be sent. Final warning at 115, cancel at 120.");
  assert.equal(timerPreview({ ...FILLED_TIMER_DRAFT, hold_minutes: "1" }, "en"), null);
});
