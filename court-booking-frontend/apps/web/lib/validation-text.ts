import { en } from "@/messages";
import type { MessageKey, TFunction } from "./i18n";

/**
 * Field-error texts come from the shared `packages/types` validators (English only). The full mapping now lives in
 * `fmt.validation()` (lib/format-i18n.ts, keys `validation.*`); this keeps the older `t`-based helpers working for the auth forms.
 * An unknown text is returned unchanged.
 */
const BY_TEXT: Record<string, MessageKey> = Object.fromEntries(
  (Object.keys(en) as MessageKey[])
    .filter((k) => k.startsWith("validation.") && !en[k].includes("{"))
    .map((k) => [en[k], k]),
);

export function translateValidation(t: TFunction, message: string | null | undefined): string | null | undefined {
  if (!message) return message;
  const key = BY_TEXT[message];
  if (key) return t(key);
  const min = /^Use at least (\d+) characters$/.exec(message);
  if (min) return t("validation.passwordMin", { n: min[1] });
  return message;
}

/** Translate every message of a `FieldErrors` object. */
export function translateErrors<K extends string>(t: TFunction, errors: Partial<Record<K, string>>): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {};
  for (const k of Object.keys(errors) as K[]) out[k] = translateValidation(t, errors[k]) ?? undefined;
  return out;
}
