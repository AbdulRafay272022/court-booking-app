import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { REMINDER_DEFAULTS, reminderPreviewText, reminderSchedule, validateReminderInput } from "./reminder-schedule";

test("defaults (Stage 2: auto-cancel ON at 120): 10, 40, 70, 100, warning 115, cancel 120", () => {
  assert.deepEqual(REMINDER_DEFAULTS, { firstAfterMin: 10, everyMin: 30, maxReminders: 5, autoCancelMin: 120 });
  assert.deepEqual(reminderSchedule(REMINDER_DEFAULTS), { reminders: [10, 40, 70, 100], finalWarning: 115, cancelAt: 120 });
});

test("auto-cancel off: five reminders, no warning, no cancel", () => {
  assert.deepEqual(reminderSchedule({ ...REMINDER_DEFAULTS, autoCancelMin: null }), {
    reminders: [10, 40, 70, 100, 130],
    finalWarning: null,
    cancelAt: null,
  });
});

test("Y = 120 with defaults: 10, 40, 70, 100, warning 115, cancel 120 (warning not counted)", () => {
  const s = reminderSchedule({ ...REMINDER_DEFAULTS, autoCancelMin: 120 });
  assert.deepEqual(s, { reminders: [10, 40, 70, 100], finalWarning: 115, cancelAt: 120 });
  assert.equal(reminderPreviewText(s, "ru"), "Reminder 10, 40, 70, 100 minute par. 115 par aakhri warning, 120 par cancel.");
  assert.equal(reminderPreviewText(s, "en"), "Reminders at 10, 40, 70, 100 minutes. Final warning at 115, cancel at 120.");
});

test("Y = 30: one reminder at 10, warning at 25, cancel at 30", () => {
  const s = reminderSchedule({ ...REMINDER_DEFAULTS, autoCancelMin: 30 });
  assert.deepEqual(s, { reminders: [10], finalWarning: 25, cancelAt: 30 });
  assert.equal(reminderPreviewText(s, "ru"), "Reminder 10 minute par. 25 par aakhri warning, 30 par cancel.");
  assert.equal(reminderPreviewText(s, "en"), "Reminder at 10 minutes. Final warning at 25, cancel at 30.");
});

test("Y smaller than the first reminder: no reminders, only the warning", () => {
  assert.deepEqual(reminderSchedule({ ...REMINDER_DEFAULTS, autoCancelMin: 8 }), { reminders: [], finalWarning: 4, cancelAt: 8 });
  // first reminder at the warning minute is dropped too
  assert.deepEqual(reminderSchedule({ ...REMINDER_DEFAULTS, autoCancelMin: 15 }), { reminders: [], finalWarning: 10, cancelAt: 15 });
  assert.deepEqual(reminderSchedule({ ...REMINDER_DEFAULTS, autoCancelMin: 10 }), { reminders: [], finalWarning: 5, cancelAt: 10 });
  assert.deepEqual(reminderSchedule({ ...REMINDER_DEFAULTS, autoCancelMin: 5 }), { reminders: [], finalWarning: 2, cancelAt: 5 });
  assert.deepEqual(reminderSchedule({ ...REMINDER_DEFAULTS, autoCancelMin: 1 }).finalWarning, 1);
  assert.deepEqual(reminderSchedule({ firstAfterMin: 1, everyMin: 5, maxReminders: 5, autoCancelMin: 9 }), { reminders: [1], finalWarning: 4, cancelAt: 9 });
});

test("Y = 0 / null = off", () => {
  assert.equal(reminderSchedule({ ...REMINDER_DEFAULTS, autoCancelMin: 0 }).cancelAt, null);
  assert.equal(reminderSchedule({ ...REMINDER_DEFAULTS, autoCancelMin: null }).finalWarning, null);
  assert.match(reminderPreviewText(reminderSchedule({ ...REMINDER_DEFAULTS, autoCancelMin: null }), "ru"), /Auto-cancel band hai\.$/);
});

test("custom values and max", () => {
  assert.deepEqual(reminderSchedule({ firstAfterMin: 5, everyMin: 5, maxReminders: 3, autoCancelMin: null }).reminders, [5, 10, 15]);
  assert.deepEqual(reminderSchedule({ firstAfterMin: 15, everyMin: 20, maxReminders: 10, autoCancelMin: 60 }), {
    // a reminder at or after the final-warning minute is dropped
    reminders: [15, 35],
    finalWarning: 55,
    cancelAt: 60,
  });
});

test("validation: clear Roman Urdu / English messages", () => {
  const ok = validateReminderInput({ firstAfterMin: 10, everyMin: 30, maxReminders: 5, autoCancelMin: 120 }, true, "ru");
  assert.deepEqual(ok.errors, []);
  const bad = validateReminderInput({ firstAfterMin: 0, everyMin: 2, maxReminders: 11, autoCancelMin: null }, true, "ru");
  assert.deepEqual(bad.errors.map((e) => e.field), ["firstAfterMin", "everyMin", "maxReminders", "autoCancelMin"]);
  assert.match(bad.errors[1].message, /kam az kam 5 minute/);
  const en = validateReminderInput({ firstAfterMin: 10, everyMin: 2.5, maxReminders: 5, autoCancelMin: null }, false, "en");
  assert.equal(en.errors[0].message, "Use whole numbers only.");
  const warn = validateReminderInput({ firstAfterMin: 30, everyMin: 30, maxReminders: 5, autoCancelMin: 20 }, true, "ru");
  assert.equal(warn.errors.length, 0);
  assert.equal(warn.warnings.length, 1);
});

// Shared cases written by the backend from the Python twin (docs/round2-contract.md, B1).
const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "reminder-schedule-cases.json");

type Case = {
  name?: string;
  input?: Record<string, number | null>;
  expected?: Record<string, unknown>;
  [k: string]: unknown;
};

const pick = (o: Record<string, unknown>, ...keys: string[]) => {
  for (const k of keys) if (k in o) return o[k];
  return undefined;
};

test("shared backend cases (fixtures/reminder-schedule-cases.json)", (t) => {
  if (!existsSync(FIXTURE)) {
    t.skip("fixtures/reminder-schedule-cases.json not present yet (the backend agent writes it on its branch; the lead merges it)");
    return;
  }
  const raw = JSON.parse(readFileSync(FIXTURE, "utf8")) as Case[] | { cases: Case[] };
  const cases = Array.isArray(raw) ? raw : raw.cases;
  assert.ok(cases.length > 0, "fixture has cases");
  for (const c of cases) {
    const input = (c.input ?? c) as Record<string, unknown>;
    const exp = (c.expected ?? c) as Record<string, unknown>;
    const s = reminderSchedule({
      firstAfterMin: Number(pick(input, "firstAfterMin", "first_after_min", "first", "first_reminder_after_min")),
      everyMin: Number(pick(input, "everyMin", "every_min", "every", "repeat_every_min")),
      maxReminders: Number(pick(input, "maxReminders", "max_reminders", "max")),
      autoCancelMin: (pick(input, "autoCancelMin", "auto_cancel_min", "autoCancel", "auto_cancel") ?? null) as number | null,
    });
    const label = c.name ?? JSON.stringify(c);
    assert.deepEqual(s.reminders, pick(exp, "reminders"), label);
    assert.equal(s.finalWarning, pick(exp, "finalWarning", "final_warning") ?? null, label);
    assert.equal(s.cancelAt, pick(exp, "cancelAt", "cancel_at") ?? null, label);
  }
});
