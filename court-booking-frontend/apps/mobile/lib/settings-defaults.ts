/**
 * Round 2 Stage 2 (mobile): the pure half of the saveable "Payment reminders" card (venue timers). No React Native here,
 * so node tests load it. Defaults and the hint wording come from the shared table in packages/types
 * (`SETTINGS_DEFAULTS`, `VENUE_TIMER_DEFAULTS`) so Venue Settings, the wizard and the web all say the same thing.
 *
 * A TimerDraft field is `null` while the owner has set nothing (= the default runs, and `null` is what gets saved);
 * a string/boolean once they changed it. "Default par wapas" puts it back to null.
 */
import {
  REMINDER_LIMITS,
  VENUE_TIMER_DEFAULTS,
  reminderPreviewText,
  reminderSchedule,
  validateReminderInput,
  type VenueTimerValues,
} from "@court-booking/types";

export interface TimerDraft {
  hold: string | null;
  remindersOn: boolean | null;
  first: string | null;
  every: string | null;
  max: string | null;
  autoCancelOn: boolean | null;
  cancelAfter: string | null;
}

export type TimerField = keyof TimerDraft;

export const EMPTY_TIMER_DRAFT: TimerDraft = {
  hold: null,
  remindersOn: null,
  first: null,
  every: null,
  max: null,
  autoCancelOn: null,
  cancelAfter: null,
};

export const HOLD_LIMITS = { min: 5, max: 180 } as const;

const num = (v: number | null | undefined) => (v === null || v === undefined ? null : String(v));

/**
 * audit 2026-10-28 item 15: every timer holds a REAL value. What the server still has as null (the default runs) is shown as
 * that default number, so saving confirms it as the owner's own; an emptied box is an error (red), never "the default".
 */
export function timerDraftFromValues(v: VenueTimerValues | null | undefined): TimerDraft {
  const D = VENUE_TIMER_DEFAULTS;
  return {
    hold: num(v?.hold_minutes ?? D.hold_minutes),
    remindersOn: v?.reminders_enabled ?? D.reminders_enabled,
    first: num(v?.first_reminder_after_min ?? D.first_reminder_after_min),
    every: num(v?.repeat_every_min ?? D.repeat_every_min),
    max: num(v?.max_reminders ?? D.max_reminders),
    autoCancelOn: v?.auto_cancel_enabled ?? D.auto_cancel_enabled,
    cancelAfter: num(v?.auto_cancel_after_min ?? D.auto_cancel_after_min),
  };
}

/** The wizard's starting timers: the defaults, as real values the owner sends. */
export const FILLED_TIMER_DRAFT: TimerDraft = timerDraftFromValues(null);

const toNumOrNull = (s: string | null): number | null => (s === null || s.trim() === "" ? null : Number(s));

/** What PUT /owners/venues/{id}/timers gets: null = default. */
export function timerDraftToValues(d: TimerDraft): VenueTimerValues {
  return {
    hold_minutes: toNumOrNull(d.hold),
    reminders_enabled: d.remindersOn,
    first_reminder_after_min: toNumOrNull(d.first),
    repeat_every_min: toNumOrNull(d.every),
    max_reminders: toNumOrNull(d.max),
    auto_cancel_enabled: d.autoCancelOn,
    auto_cancel_after_min: toNumOrNull(d.cancelAfter),
  };
}

/** True when nothing is set (the wizard skips the PUT then: null everywhere is already what a new venue has). */
export function timerDraftIsEmpty(d: TimerDraft | null | undefined): boolean {
  if (!d) return true;
  return Object.values(d).every((v) => v === null);
}

/** The value a field SHOWS: the owner's own value, else the default. */
export function effectiveTimerDraft(d: TimerDraft) {
  const D = VENUE_TIMER_DEFAULTS;
  return {
    hold: d.hold ?? String(D.hold_minutes),
    remindersOn: d.remindersOn ?? D.reminders_enabled,
    first: d.first ?? String(D.first_reminder_after_min),
    every: d.every ?? String(D.repeat_every_min),
    max: d.max ?? String(D.max_reminders),
    autoCancelOn: d.autoCancelOn ?? D.auto_cancel_enabled,
    cancelAfter: d.cancelAfter ?? String(D.auto_cancel_after_min),
  };
}

export type TimerErrors = Partial<Record<TimerField, string>>;

/** Blocking errors (per field) and non-blocking warnings, Roman Urdu. Fields that are switched off are not checked. */
export function timerDraftProblems(d: TimerDraft): { errors: TimerErrors; warnings: string[] } {
  const e = effectiveTimerDraft(d);
  const errors: TimerErrors = {};
  // audit 2026-10-28 item 15: an empty (or never filled) box is required, not "the default"
  const blank = (f: "hold" | "first" | "every" | "max" | "cancelAfter") => d[f] === null || String(d[f]).trim() === "";
  const need: ("hold" | "first" | "every" | "max" | "cancelAfter")[] = ["hold"];
  if (e.remindersOn) need.push("first", "every", "max");
  if (e.autoCancelOn) need.push("cancelAfter");
  for (const f of need) if (blank(f)) errors[f] = "Ye bharna zaroori hai.";
  const hold = toNumOrNull(e.hold);
  if (!errors.hold && (hold === null || !Number.isInteger(hold) || hold < HOLD_LIMITS.min || hold > HOLD_LIMITS.max)) {
    errors.hold = `Hold ka waqt ${HOLD_LIMITS.min} se ${HOLD_LIMITS.max} minute ke beech rakhein.`;
  }
  const r = validateReminderInput(
    { firstAfterMin: toNumOrNull(e.first), everyMin: toNumOrNull(e.every), maxReminders: toNumOrNull(e.max), autoCancelMin: toNumOrNull(e.cancelAfter) },
    e.autoCancelOn,
    "ru",
  );
  const map = { firstAfterMin: "first", everyMin: "every", maxReminders: "max", autoCancelMin: "cancelAfter" } as const;
  for (const err of r.errors) {
    const f = map[err.field];
    if (!e.remindersOn && f !== "cancelAfter") continue; // reminders off: their boxes are hidden and not saved as wrong
    if (!errors[f]) errors[f] = err.message;
  }
  const warnings = e.remindersOn ? r.warnings : [];
  return { errors, warnings };
}

/** The live preview sentence ("Reminder 10, 40, 70, 100 minute par. 115 par aakhri warning, 120 par cancel."), or null
 * while a box has an error. */
export function timerPreview(d: TimerDraft): string | null {
  const { errors } = timerDraftProblems(d);
  if (Object.keys(errors).length > 0) return null;
  const e = effectiveTimerDraft(d);
  const s = reminderSchedule({
    firstAfterMin: Number(e.first),
    everyMin: Number(e.every),
    maxReminders: e.remindersOn ? Number(e.max) : 0,
    autoCancelMin: e.autoCancelOn ? Number(e.cancelAfter) : null,
  });
  return reminderPreviewText(s, "ru");
}

export { REMINDER_LIMITS };
