import {
  REMINDER_LIMITS,
  VENUE_TIMER_DEFAULTS,
  reminderPreviewText,
  reminderSchedule,
  validateReminderInput,
  type TextLang,
  type VenueTimerEffective,
  type VenueTimerValues,
} from "@court-booking/types";

/**
 * Round 2 Stage 2: the venue timers form (hold, owner reminders, auto-cancel), pure logic shared by Venue Settings and the
 * wizard's "Advanced" section. A field that is `null` is UNSET: the default runs, the input shows the default value and the
 * hint says "Abhi default chal raha hai". Number fields hold the typed text so a half-typed value is not lost.
 */
export interface TimerDraft {
  hold_minutes: string | null;
  reminders_enabled: boolean | null;
  first_reminder_after_min: string | null;
  repeat_every_min: string | null;
  max_reminders: string | null;
  auto_cancel_enabled: boolean | null;
  auto_cancel_after_min: string | null;
}

export type TimerKey = keyof TimerDraft;
export type TimerNumberKey = "hold_minutes" | "first_reminder_after_min" | "repeat_every_min" | "max_reminders" | "auto_cancel_after_min";

export const TIMER_KEYS: TimerKey[] = [
  "hold_minutes",
  "reminders_enabled",
  "first_reminder_after_min",
  "repeat_every_min",
  "max_reminders",
  "auto_cancel_enabled",
  "auto_cancel_after_min",
];

/** Backend CHECKs (docs/stage2-contract.md section 1.3). */
export const HOLD_LIMITS = { min: 5, max: 180 } as const;

export const EMPTY_TIMER_DRAFT: TimerDraft = {
  hold_minutes: null,
  reminders_enabled: null,
  first_reminder_after_min: null,
  repeat_every_min: null,
  max_reminders: null,
  auto_cancel_enabled: null,
  auto_cancel_after_min: null,
};

const str = (n: number | null): string | null => (n === null ? null : String(n));

export function draftFromValues(v: VenueTimerValues): TimerDraft {
  return {
    hold_minutes: str(v.hold_minutes),
    reminders_enabled: v.reminders_enabled,
    first_reminder_after_min: str(v.first_reminder_after_min),
    repeat_every_min: str(v.repeat_every_min),
    max_reminders: str(v.max_reminders),
    auto_cancel_enabled: v.auto_cancel_enabled,
    auto_cancel_after_min: str(v.auto_cancel_after_min),
  };
}

const num = (s: string | null): number | null => (s === null || s.trim() === "" ? null : Number(s));

/** The PUT body: null = default. An emptied number box also means "back to the default". */
export function valuesFromDraft(d: TimerDraft): VenueTimerValues {
  return {
    hold_minutes: num(d.hold_minutes),
    reminders_enabled: d.reminders_enabled,
    first_reminder_after_min: num(d.first_reminder_after_min),
    repeat_every_min: num(d.repeat_every_min),
    max_reminders: num(d.max_reminders),
    auto_cancel_enabled: d.auto_cancel_enabled,
    auto_cancel_after_min: num(d.auto_cancel_after_min),
  };
}

/** What will actually run (null -> the default). Numbers may be NaN while typing; `validateTimers` catches that. */
export function effectiveFromDraft(d: TimerDraft, defaults: VenueTimerEffective = VENUE_TIMER_DEFAULTS): VenueTimerEffective {
  const v = valuesFromDraft(d);
  return {
    hold_minutes: v.hold_minutes ?? defaults.hold_minutes,
    reminders_enabled: v.reminders_enabled ?? defaults.reminders_enabled,
    first_reminder_after_min: v.first_reminder_after_min ?? defaults.first_reminder_after_min,
    repeat_every_min: v.repeat_every_min ?? defaults.repeat_every_min,
    max_reminders: v.max_reminders ?? defaults.max_reminders,
    auto_cancel_enabled: v.auto_cancel_enabled ?? defaults.auto_cancel_enabled,
    auto_cancel_after_min: v.auto_cancel_after_min ?? defaults.auto_cancel_after_min,
  };
}

/** Is anything set at all? (Used to skip the PUT in the wizard when the owner touched nothing.) */
export function draftHasValues(d: TimerDraft): boolean {
  return Object.values(valuesFromDraft(d)).some((v) => v !== null);
}

export interface TimerValidation {
  errors: Partial<Record<TimerNumberKey, string>>;
  warnings: string[];
}

const HOLD_MSG = {
  ru: (a: number, b: number) => `Hold ${a} se ${b} minute ke beech rakhein (sirf poore number).`,
  en: (a: number, b: number) => `Hold must be a whole number between ${a} and ${b} minutes.`,
} as const;

/** Same ranges as the backend CHECKs; the reminder rules come from the shared validateReminderInput. */
export function validateTimers(d: TimerDraft, lang: TextLang, defaults: VenueTimerEffective = VENUE_TIMER_DEFAULTS): TimerValidation {
  const e = effectiveFromDraft(d, defaults);
  const errors: TimerValidation["errors"] = {};
  const hold = e.hold_minutes;
  if (!Number.isInteger(hold) || hold < HOLD_LIMITS.min || hold > HOLD_LIMITS.max) {
    errors.hold_minutes = HOLD_MSG[lang](HOLD_LIMITS.min, HOLD_LIMITS.max);
  }
  const r = validateReminderInput(
    {
      firstAfterMin: e.first_reminder_after_min,
      everyMin: e.repeat_every_min,
      maxReminders: e.max_reminders,
      autoCancelMin: e.auto_cancel_after_min,
    },
    e.auto_cancel_enabled,
    lang,
  );
  const map = {
    firstAfterMin: "first_reminder_after_min",
    everyMin: "repeat_every_min",
    maxReminders: "max_reminders",
    autoCancelMin: "auto_cancel_after_min",
  } as const;
  for (const err of r.errors) {
    const key = map[err.field];
    // reminder boxes are hidden (and ignored) while reminders are off
    if (!e.reminders_enabled && key !== "auto_cancel_after_min") continue;
    errors[key] ??= err.message;
  }
  const warnings = e.reminders_enabled ? r.warnings : [];
  return { errors, warnings };
}

/** "Reminder 10, 40, 70, 100 minute par. 115 par aakhri warning, 120 par cancel." from the effective values. */
export function timerPreview(d: TimerDraft, lang: TextLang, defaults: VenueTimerEffective = VENUE_TIMER_DEFAULTS): string | null {
  if (Object.keys(validateTimers(d, lang, defaults).errors).length > 0) return null;
  const e = effectiveFromDraft(d, defaults);
  return reminderPreviewText(
    reminderSchedule({
      firstAfterMin: e.first_reminder_after_min,
      everyMin: e.repeat_every_min,
      maxReminders: e.reminders_enabled ? e.max_reminders : 0,
      autoCancelMin: e.auto_cancel_enabled ? e.auto_cancel_after_min : null,
    }),
    lang,
  );
}

export { REMINDER_LIMITS };
