// Run: npx tsx --test lib/settings-defaults.test.ts   (from apps/mobile)
// Stage 2 (mobile): the shared defaults table, the saveable reminders card logic, the CNIC mask, and parity between
// Venue Settings and the onboarding wizard.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SETTINGS_DEFAULTS,
  VENUE_TIMER_DEFAULTS,
  advanceDefaultHintText,
  defaultCourtSetup,
  defaultHintState,
  defaultHintText,
} from "@court-booking/types";

import {
  EMPTY_TIMER_DRAFT,
  FILLED_TIMER_DRAFT,
  effectiveTimerDraft,
  timerDraftFromValues,
  timerDraftIsEmpty,
  timerDraftProblems,
  timerDraftToValues,
  timerPreview,
} from "./settings-defaults";
import { cnicDigits, cnicDraftComplete, cnicProblem, formatCnicInput, isValidCnic, maskCnic } from "../components/cnic-logic";

const root = join(__dirname, "..");
const src = (rel: string) => readFileSync(join(root, rel), "utf8");

test("defaults table = the spec's values and the real sources", () => {
  assert.equal(SETTINGS_DEFAULTS.hold_minutes.value, 15);
  assert.equal(SETTINGS_DEFAULTS.first_reminder_after_min.value, 10);
  assert.equal(SETTINGS_DEFAULTS.repeat_every_min.value, 30);
  assert.equal(SETTINGS_DEFAULTS.max_reminders.value, 5);
  assert.equal(SETTINGS_DEFAULTS.auto_cancel_enabled.value, true);
  assert.equal(SETTINGS_DEFAULTS.auto_cancel_after_min.value, 120);
  for (const k of Object.keys(VENUE_TIMER_DEFAULTS) as (keyof typeof VENUE_TIMER_DEFAULTS)[]) {
    assert.equal(SETTINGS_DEFAULTS[k].value, VENUE_TIMER_DEFAULTS[k], k);
  }
  assert.equal(SETTINGS_DEFAULTS.slot_minutes.value, defaultCourtSetup().slotMinutes);
  assert.equal(SETTINGS_DEFAULTS.booking_horizon_days.value, 90);
  assert.equal(SETTINGS_DEFAULTS.cancellation_allowed.value, true);
  assert.equal(SETTINGS_DEFAULTS.cancellation_cutoff_hours.value, null);
  assert.equal(SETTINGS_DEFAULTS.advance_percentage.value, 100);
  assert.equal(SETTINGS_DEFAULTS.floodlight_surcharge.value, 0);
  assert.equal(defaultHintText("hold_minutes", "ru"), "Default: 15 minute");
  assert.equal(defaultHintText("auto_cancel_enabled", "ru"), "Default: On, 120 minute");
  for (const k of Object.keys(SETTINGS_DEFAULTS) as (keyof typeof SETTINGS_DEFAULTS)[]) {
    assert.match(defaultHintText(k, "ru"), /^[\x20-\x7E]+$/, `${k} is plain ASCII`);
  }
});

test("hint state: null = running, equal = running, different = reset link", () => {
  assert.deepEqual(defaultHintState(null, "hold_minutes"), { isDefault: true, canReset: false });
  assert.deepEqual(defaultHintState(15, "hold_minutes"), { isDefault: true, canReset: false });
  assert.deepEqual(defaultHintState(20, "hold_minutes"), { isDefault: false, canReset: true });
  assert.deepEqual(defaultHintState(false, "auto_cancel_enabled"), { isDefault: false, canReset: true });
});

test("advance default says 'abhi poori raqam' only when split_payments is off", () => {
  assert.doesNotMatch(advanceDefaultHintText(true, "ru"), /abhi poori raqam/);
  assert.match(advanceDefaultHintText(false, "ru"), /abhi poori raqam$/);
});

test("timer draft (audit item 15): server nulls become the real defaults, empty boxes are required", () => {
  assert.ok(timerDraftIsEmpty(EMPTY_TIMER_DRAFT));
  assert.deepEqual(FILLED_TIMER_DRAFT, { hold: "15", remindersOn: true, first: "10", every: "30", max: "5", autoCancelOn: true, cancelAfter: "120" });
  assert.equal(timerPreview(FILLED_TIMER_DRAFT), "Reminder 10, 40, 70, 100 minute par. 115 par aakhri warning, 120 par cancel.");

  const v = { hold_minutes: 20, reminders_enabled: true, first_reminder_after_min: null, repeat_every_min: 15, max_reminders: null, auto_cancel_enabled: false, auto_cancel_after_min: null };
  // what the server had as null comes back as the default VALUE, which a save then confirms
  assert.deepEqual(timerDraftToValues(timerDraftFromValues(v)), { ...v, first_reminder_after_min: 10, max_reminders: 5, auto_cancel_after_min: 120 });
  assert.equal(timerPreview(timerDraftFromValues(v)), "Reminder 10, 25, 40, 55, 70 minute par. Auto-cancel band hai.");

  assert.ok(timerDraftProblems({ ...FILLED_TIMER_DRAFT, hold: "4" }).errors.hold);
  assert.ok(timerDraftProblems({ ...FILLED_TIMER_DRAFT, hold: "181" }).errors.hold);
  assert.ok(timerDraftProblems({ ...FILLED_TIMER_DRAFT, every: "2" }).errors.every);
  assert.equal(timerDraftProblems({ ...FILLED_TIMER_DRAFT, cancelAfter: "" }).errors.cancelAfter, "Ye bharna zaroori hai.");
  assert.equal(timerDraftProblems({ ...FILLED_TIMER_DRAFT, hold: "" }).errors.hold, "Ye bharna zaroori hai.");
  assert.equal(timerPreview({ ...FILLED_TIMER_DRAFT, every: "2" }), null);
  // reminders off: their boxes are not checked; auto-cancel off: its box is not checked
  assert.deepEqual(timerDraftProblems({ ...FILLED_TIMER_DRAFT, remindersOn: false, every: "2" }).errors, {});
  assert.deepEqual(timerDraftProblems({ ...FILLED_TIMER_DRAFT, autoCancelOn: false, cancelAfter: "1" }).errors, {});
  assert.equal(timerPreview({ ...FILLED_TIMER_DRAFT, remindersOn: false }), "Koi reminder nahi jayega. 115 par aakhri warning, 120 par cancel.");
});

test("CNIC mask", () => {
  assert.equal(formatCnicInput("12345"), "12345");
  assert.equal(formatCnicInput("123451"), "12345-1");
  assert.equal(formatCnicInput("123451234567"), "12345-1234567");
  assert.equal(formatCnicInput("1234512345671"), "12345-1234567-1");
  assert.equal(formatCnicInput("12345-1234567-1999"), "12345-1234567-1");
  assert.equal(formatCnicInput("ab12 345x"), "12345");
  assert.equal(cnicDigits("12345-1234567-1"), "1234512345671");
  assert.ok(isValidCnic("12345-1234567-1"));
  assert.ok(isValidCnic("1234512345671"));
  assert.ok(!isValidCnic("12345-123456-1"));
  assert.equal(cnicProblem(""), null);
  assert.match(cnicProblem("12345-12") ?? "", /13 hindse/);
  assert.equal(maskCnic("12345-1234567-8"), "*****-*******-8");
  assert.ok(!cnicDraftComplete({ number: "12345-1234567-1", front: "a", back: null }));
  assert.ok(cnicDraftComplete({ number: "12345-1234567-1", front: "a", back: "b" }));
});

test("CNIC is never persisted; the wizard store persists timers (v5) with a migration", () => {
  const store = src("lib/venue-setup-store.ts");
  assert.match(store, /version: 5/);
  assert.match(store, /state\.timers = \{ \.\.\.FILLED_TIMER_DRAFT/);
  assert.doesNotMatch(store.replace(/The CNIC is NOT here[^\n]*/g, ""), /cnic/i, "no CNIC field in the persisted draft");
  const form = src("components/cnic-form.tsx");
  assert.doesNotMatch(form, /zustand\/middleware|async-storage|secure-storage|localStorage\.setItem|setItemAsync/);
});

test("parity: Venue Settings and the wizard use the same reminders card, hints and CNIC fields", () => {
  const wizard = src("app/(owner)/venue-setup/courts.tsx");
  const settings = src("app/(owner)/venue-settings.tsx");
  const card = src("components/reminders-card.tsx");
  assert.match(wizard, /<RemindersCard value=\{store\.timers\}/);
  assert.match(wizard, /updateVenueTimers\(venueId, timerDraftToValues\(timers\)\)/);
  assert.match(settings, /<VenueRemindersCard\b/);
  assert.match(card, /updateVenueTimers\(venueId, timerDraftToValues\(draft\)\)/);
  assert.match(card, /<DefaultHint\b/);
  assert.match(card, /autoCancelOffWarning/);
  assert.match(wizard, /<CnicFields \/>/);
  assert.match(wizard, /submitCnicDraft\(/);
  assert.match(settings, /<IdentityCard \/>/);
  for (const f of ["components/court-setup-fields.tsx", "components/advance-settings.tsx"]) {
    assert.match(src(f), /<DefaultHint\b/, f);
  }
});
