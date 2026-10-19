/**
 * Round 2 Stage 2 (docs/stage2-spec.md A.2): ONE table of "what applies when the owner sets nothing", shared by web and
 * mobile so the "Default: ..." line under every owner setting is identical on both. Values come from their real
 * sources (VENUE_TIMER_DEFAULTS mirrors the backend's venue_timers.DEFAULTS; the rest mirror the backend schemas /
 * the wizard's own starting values) and are never retyped here.
 *
 * UI rule for every setting with a default:
 * - always the small line `defaultHintText(key, lang)` ("Default: 15 minute");
 * - nothing set (null, or the default untouched) -> the marker DEFAULT_HINT_COPY[lang].running;
 * - value differs from the default -> the link DEFAULT_HINT_COPY[lang].reset, which puts the default back.
 */
import { DEFAULT_ADVANCE_PERCENTAGE, formatPkrAmount } from "./advance-example";
import { defaultCourtSetup } from "./court-setup";
import type { TextLang } from "./locale-text";
import { VENUE_TIMER_DEFAULTS } from "./stage2";

export type SettingDefaultKey =
  | "hold_minutes"
  | "reminders_enabled"
  | "first_reminder_after_min"
  | "repeat_every_min"
  | "max_reminders"
  | "auto_cancel_enabled"
  | "auto_cancel_after_min"
  | "slot_minutes"
  | "court_slot_minutes"
  | "cancellation_allowed"
  | "cancellation_cutoff_hours"
  | "booking_horizon_days"
  | "advance"
  | "advance_minimum"
  | "advance_percentage"
  | "floodlight_surcharge";

export type SettingDefaultValue = number | boolean | string | null;

export interface SettingDefault {
  value: SettingDefaultValue;
  /** The text after "Default: ". */
  ru: string;
  en: string;
}

const COURT = defaultCourtSetup();

/** Backend VenueCreate.booking_horizon_days default (app/schemas/venue.py). */
export const DEFAULT_BOOKING_HORIZON_DAYS = 90;
/**
 * Backend court slot length default (app/models/court.py Court.slot_minutes default=60, app/schemas/court.py
 * CourtCreateIn.slot_minutes = 60). The wizards and the "+ Court" form prefill 90 instead (`slot_minutes` below), so a
 * NEW court shows 90 and an EXISTING court in Settings shows this one (`court_slot_minutes`).
 */
export const DEFAULT_COURT_SLOT_MINUTES = 60;
/** Backend PricingRuleIn.floodlight_surcharge default (app/schemas/court.py). */
export const DEFAULT_FLOODLIGHT_SURCHARGE = 0;

const onOff = (on: boolean, lang: TextLang) => (lang === "ru" ? (on ? "On" : "Band") : on ? "On" : "Off");
const min = (n: number, lang: TextLang) => (lang === "ru" ? `${n} minute` : `${n} minutes`);

function row(value: SettingDefaultValue, text: (lang: TextLang) => string): SettingDefault {
  return { value, ru: text("ru"), en: text("en") };
}

export const SETTINGS_DEFAULTS: Record<SettingDefaultKey, SettingDefault> = {
  hold_minutes: row(VENUE_TIMER_DEFAULTS.hold_minutes, (l) => min(VENUE_TIMER_DEFAULTS.hold_minutes, l)),
  reminders_enabled: row(VENUE_TIMER_DEFAULTS.reminders_enabled, (l) => onOff(VENUE_TIMER_DEFAULTS.reminders_enabled, l)),
  first_reminder_after_min: row(VENUE_TIMER_DEFAULTS.first_reminder_after_min, (l) => min(VENUE_TIMER_DEFAULTS.first_reminder_after_min, l)),
  repeat_every_min: row(VENUE_TIMER_DEFAULTS.repeat_every_min, (l) => min(VENUE_TIMER_DEFAULTS.repeat_every_min, l)),
  max_reminders: row(VENUE_TIMER_DEFAULTS.max_reminders, () => String(VENUE_TIMER_DEFAULTS.max_reminders)),
  auto_cancel_enabled: row(VENUE_TIMER_DEFAULTS.auto_cancel_enabled, (l) =>
    VENUE_TIMER_DEFAULTS.auto_cancel_enabled
      ? `${onOff(true, l)}, ${min(VENUE_TIMER_DEFAULTS.auto_cancel_after_min, l)}`
      : onOff(false, l),
  ),
  auto_cancel_after_min: row(VENUE_TIMER_DEFAULTS.auto_cancel_after_min, (l) => min(VENUE_TIMER_DEFAULTS.auto_cancel_after_min, l)),
  /** The wizard / new-court prefill (court-setup.ts defaultCourtSetup). */
  slot_minutes: row(COURT.slotMinutes, (l) => min(COURT.slotMinutes, l)),
  /** An existing court edited in Settings: the backend default. */
  court_slot_minutes: row(DEFAULT_COURT_SLOT_MINUTES, (l) => min(DEFAULT_COURT_SLOT_MINUTES, l)),
  cancellation_allowed: row(true, (l) => (l === "ru" ? "Allowed (cancel ho sakti hai)" : "Allowed")),
  cancellation_cutoff_hours: row(null, (l) => (l === "ru" ? "koi had nahi (start se pehle kabhi bhi)" : "no limit (any time before the start)")),
  booking_horizon_days: row(DEFAULT_BOOKING_HORIZON_DAYS, (l) => (l === "ru" ? `${DEFAULT_BOOKING_HORIZON_DAYS} din aage tak` : `${DEFAULT_BOOKING_HORIZON_DAYS} days ahead`)),
  advance: row(DEFAULT_ADVANCE_PERCENTAGE, (l) =>
    l === "ru" ? `pricing se (${DEFAULT_ADVANCE_PERCENTAGE}%, yani poori raqam)` : `from pricing (${DEFAULT_ADVANCE_PERCENTAGE}%, the full amount)`,
  ),
  advance_minimum: row(null, (l) => (l === "ru" ? "koi had nahi" : "no minimum")),
  advance_percentage: row(DEFAULT_ADVANCE_PERCENTAGE, () => `${DEFAULT_ADVANCE_PERCENTAGE}%`),
  floodlight_surcharge: row(DEFAULT_FLOODLIGHT_SURCHARGE, () => formatPkrAmount(DEFAULT_FLOODLIGHT_SURCHARGE)),
};

export const DEFAULT_HINT_COPY = {
  ru: {
    prefix: "Default",
    reset: "Default par wapas",
    running: "Abhi default chal raha hai",
    /** Added to the advance default when the split_payments flag is OFF: every booking is paid in full up front. */
    fullAmountNote: "abhi poori raqam",
    autoCancelOffWarning: "Band karne par approve na hone wali booking ka slot band rahega.",
  },
  en: {
    prefix: "Default",
    reset: "Back to default",
    running: "Using the default now",
    fullAmountNote: "full amount for now",
    autoCancelOffWarning: "If you switch this off, a booking that is never approved keeps its slot blocked.",
  },
} as const;

/** "Default: 15 minute". */
export function defaultHintText(key: SettingDefaultKey, lang: TextLang): string {
  return `${DEFAULT_HINT_COPY[lang].prefix}: ${SETTINGS_DEFAULTS[key][lang]}`;
}

/**
 * The advance line that REALLY applies: with split_payments OFF the backend makes every new booking pay the whole price
 * up front whatever the court's advance rule says, so the hint says so.
 */
export function advanceDefaultHintText(splitPaymentsOn: boolean, lang: TextLang): string {
  const base = defaultHintText("advance", lang);
  return splitPaymentsOn ? base : `${base} - ${DEFAULT_HINT_COPY[lang].fullAmountNote}`;
}

/** Hint state for one field: `isDefault` -> show the "running" marker; `canReset` -> show the reset link. */
export function defaultHintState(value: SettingDefaultValue | undefined, key: SettingDefaultKey): { isDefault: boolean; canReset: boolean } {
  const d = SETTINGS_DEFAULTS[key].value;
  if (value === null || value === undefined) return { isDefault: true, canReset: false };
  // a value equal to the default is shown like "nothing set": the default is what runs either way
  return value === d ? { isDefault: true, canReset: false } : { isDefault: false, canReset: true };
}

/**
 * Settings audit (spec A.2): owner/venue/court settings that have NO default (the owner must enter them, or they are
 * the owner's own data). Listed in the Stage 2 report; nothing renders a "Default" line for these.
 */
export const SETTINGS_WITHOUT_DEFAULT: readonly string[] = [
  "Venue name, address, area, description, location pin",
  "WhatsApp number",
  "Bank details (bank, account title, account number)",
  "Sports offered, amenities",
  "Court name, sport, indoor/outdoor",
  "Court opening hours (every court must send a schedule; the wizard's 6:00 AM - 11:00 PM is only a starting value)",
  "Court price per minimum booking (and extra peak/weekend rates)",
  "Blackout dates",
  "Venue and court photos",
  "Staff members and their permissions (new staff start with view_ledger only, a starting choice, not a running default)",
  "CNIC (identity)",
];
