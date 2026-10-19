import { SETTINGS_DEFAULTS, type SettingDefaultKey, type TextLang } from "@court-booking/types";

/**
 * Round 2 Stage 2 (spec A.2): hint STATE helpers for the web. The default VALUES and their texts live in ONE place,
 * `packages/types/src/settings-defaults.ts` (shared with mobile; sources listed there and in docs/stage2-findings.md
 * section 3). The only value kept here is the backend's slot length for the one field whose layers disagree:
 *
 * - slot_minutes: the backend default is 60 (app/models/court.py Court.slot_minutes default=60, app/schemas/court.py
 *   CourtCreateIn.slot_minutes = 60), but both wizards (and the "+ Court" form in Settings) start a new court at 90
 *   (court-setup.ts defaultCourtSetup). The hint shows the default that REALLY applies on that screen: the wizard / new
 *   court form shows its prefill (90), Settings for an existing court shows the backend default (60). Behaviour unchanged.
 */
export const BACKEND_SLOT_MINUTES_DEFAULT = 60;

export type SlotScreen = "wizard" | "settings";

export function slotMinutesDefault(screen: SlotScreen): number {
  return screen === "wizard" ? (SETTINGS_DEFAULTS.slot_minutes.value as number) : BACKEND_SLOT_MINUTES_DEFAULT;
}

/** The text after "Default: " for a shared key, in the visitor's language. */
export function defaultValueText(key: SettingDefaultKey, lang: TextLang): string {
  return SETTINGS_DEFAULTS[key][lang];
}

/**
 * Where a field stands against its default:
 * - "unset": nothing saved (null), the default is running -> "Abhi default chal raha hai";
 * - "same": a value equal to the default -> for fields that can never be empty this is shown like "unset";
 * - "differs": the owner changed it -> "Default par wapas".
 */
export type DefaultState = "unset" | "same" | "differs";

export function defaultState<V>(value: V | null | undefined, def: V | null): DefaultState {
  if (value === null || value === undefined) return "unset";
  if (value === def) return "same";
  return "differs";
}
