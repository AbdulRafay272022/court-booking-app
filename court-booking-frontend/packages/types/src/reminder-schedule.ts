/**
 * Round 2 (B1): owner payment-approval reminders. ONE function for the settings preview (web + mobile); the backend
 * scheduler has a Python twin (`app/services/reminder_schedule.py`) checked against the same fixture file
 * (`src/fixtures/reminder-schedule-cases.json`).
 *
 * Rules (minutes after the payment screenshot arrived):
 * - reminders at first, first + every, first + 2*every, ... at most `maxReminders` of them;
 * - auto-cancel ON with Y minutes: drop every reminder at or after Y, add ONE final warning 5 minutes before Y
 *   (Y <= 10: at Y / 2), cancel at Y; the final warning does not count toward `maxReminders`;
 * - Y null or 0 (or negative) = auto-cancel off: no final warning, no cancel.
 * Shifting a reminder that falls outside the venue's operating hours is the scheduler's job, not this preview.
 */
import type { TextLang } from "./locale-text";

export interface ReminderScheduleInput {
  firstAfterMin: number;
  everyMin: number;
  maxReminders: number;
  /** Y; null / 0 = off. */
  autoCancelMin: number | null;
}

export interface ReminderSchedule {
  reminders: number[];
  finalWarning: number | null;
  cancelAt: number | null;
}

/** Today's behaviour (B1 defaults); auto-cancel is off by default. */
export const REMINDER_DEFAULTS: ReminderScheduleInput = {
  firstAfterMin: 10,
  everyMin: 30,
  maxReminders: 5,
  autoCancelMin: null,
};

export const REMINDER_LIMITS = {
  firstMin: 1,
  firstMax: 720,
  everyMin: 5,
  everyMax: 720,
  maxMin: 1,
  maxMax: 10,
  cancelMin: 5,
  cancelMax: 1440,
} as const;

export function reminderSchedule(input: ReminderScheduleInput): ReminderSchedule {
  const first = Math.max(0, Number(input.firstAfterMin) || 0);
  const every = Math.max(0, Number(input.everyMin) || 0);
  const max = Math.max(0, Math.floor(Number(input.maxReminders) || 0));
  const y = input.autoCancelMin && input.autoCancelMin > 0 ? Number(input.autoCancelMin) : null;

  const reminders: number[] = [];
  for (let i = 0; i < max; i++) {
    const at = first + i * every;
    if (y !== null && at >= y) break;
    if (i > 0 && every <= 0) break; // a zero interval would repeat the same minute
    reminders.push(at);
  }
  if (y === null) return { reminders, finalWarning: null, cancelAt: null };
  const finalWarning = y <= 10 ? y / 2 : y - 5;
  return { reminders, finalWarning, cancelAt: y };
}

function list(nums: number[]): string {
  return nums.join(", ");
}

/** "Reminder 10, 40, 70, 100 minute par. 115 par aakhri warning, 120 par cancel." */
export function reminderPreviewText(s: ReminderSchedule, lang: TextLang): string {
  const parts: string[] = [];
  if (lang === "ru") {
    parts.push(s.reminders.length ? `Reminder ${list(s.reminders)} minute par.` : "Koi reminder nahi jayega.");
    if (s.cancelAt !== null && s.finalWarning !== null) {
      parts.push(`${s.finalWarning} par aakhri warning, ${s.cancelAt} par cancel.`);
    } else {
      parts.push("Auto-cancel band hai.");
    }
  } else {
    if (s.reminders.length === 0) parts.push("No reminders will be sent.");
    else if (s.reminders.length === 1) parts.push(`Reminder at ${s.reminders[0]} minutes.`);
    else parts.push(`Reminders at ${list(s.reminders)} minutes.`);
    if (s.cancelAt !== null && s.finalWarning !== null) {
      parts.push(`Final warning at ${s.finalWarning}, cancel at ${s.cancelAt}.`);
    } else {
      parts.push("Auto-cancel is off.");
    }
  }
  return parts.join(" ");
}

export type ReminderField = "firstAfterMin" | "everyMin" | "maxReminders" | "autoCancelMin";

export interface ReminderInputError {
  field: ReminderField;
  message: string;
}

const MSG = {
  ru: {
    whole: "Sirf poore number likhein.",
    first: (a: number, b: number) => `Pehla reminder ${a} se ${b} minute ke beech rakhein.`,
    every: (a: number, b: number) => `Reminder ka waqfa kam az kam ${a} minute (zyada se zyada ${b}) rakhein.`,
    max: (a: number, b: number) => `Reminders ki tadaad ${a} se ${b} ke beech rakhein.`,
    cancel: (a: number, b: number) => `Auto-cancel ka waqt ${a} se ${b} minute ke beech rakhein.`,
    cancelBeforeFirst: "Auto-cancel pehle reminder se pehle hai, is liye koi reminder nahi jayega (sirf aakhri warning).",
  },
  en: {
    whole: "Use whole numbers only.",
    first: (a: number, b: number) => `First reminder must be between ${a} and ${b} minutes.`,
    every: (a: number, b: number) => `Repeat every must be at least ${a} minutes (at most ${b}).`,
    max: (a: number, b: number) => `Number of reminders must be between ${a} and ${b}.`,
    cancel: (a: number, b: number) => `Auto-cancel time must be between ${a} and ${b} minutes.`,
    cancelBeforeFirst: "Auto-cancel comes before the first reminder, so no reminder will be sent (only the final warning).",
  },
} as const;

/**
 * Errors block saving; `warnings` are shown but allowed. `autoCancelEnabled=false` ignores the minutes box.
 */
export function validateReminderInput(
  input: { firstAfterMin: number | null; everyMin: number | null; maxReminders: number | null; autoCancelMin: number | null },
  autoCancelEnabled: boolean,
  lang: TextLang,
): { errors: ReminderInputError[]; warnings: string[] } {
  const m = MSG[lang];
  const L = REMINDER_LIMITS;
  const errors: ReminderInputError[] = [];
  const warnings: string[] = [];
  const check = (field: ReminderField, v: number | null, lo: number, hi: number, msg: (a: number, b: number) => string) => {
    if (v === null || !Number.isFinite(v)) {
      errors.push({ field, message: msg(lo, hi) });
    } else if (!Number.isInteger(v)) {
      errors.push({ field, message: m.whole });
    } else if (v < lo || v > hi) {
      errors.push({ field, message: msg(lo, hi) });
    }
  };
  check("firstAfterMin", input.firstAfterMin, L.firstMin, L.firstMax, m.first);
  check("everyMin", input.everyMin, L.everyMin, L.everyMax, m.every);
  check("maxReminders", input.maxReminders, L.maxMin, L.maxMax, m.max);
  if (autoCancelEnabled) {
    check("autoCancelMin", input.autoCancelMin, L.cancelMin, L.cancelMax, m.cancel);
    if (
      errors.length === 0 &&
      input.autoCancelMin !== null &&
      input.firstAfterMin !== null &&
      input.autoCancelMin <= input.firstAfterMin
    ) {
      warnings.push(m.cancelBeforeFirst);
    }
  }
  return { errors, warnings };
}
