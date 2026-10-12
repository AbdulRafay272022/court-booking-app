import type { MessageKey, TFunction } from "./i18n";

/**
 * Field-error texts come from the shared `packages/types` validators (English only, and packages are not edited here). This maps the
 * known message texts to dictionary keys so the Khelo forms show them in the visitor's language. An unknown text is returned unchanged.
 */
const BY_TEXT: Record<string, MessageKey> = {
  "Enter your full name": "auth.val.name",
  "Enter a valid email address": "auth.val.email",
  "Enter a valid mobile number, e.g. 300 1234567": "auth.val.phone",
  "Choose your city": "auth.val.city",
  "Choose an option": "auth.val.gender",
  "Confirm your password": "auth.val.confirm",
  "Passwords don't match": "auth.val.mismatch",
  "Enter your password": "auth.val.passwordRequired",
};

export function translateValidation(t: TFunction, message: string | null | undefined): string | null | undefined {
  if (!message) return message;
  const key = BY_TEXT[message];
  if (key) return t(key);
  const min = /^Use at least (\d+) characters$/.exec(message);
  if (min) return t("auth.val.passwordMin", { n: min[1] });
  return message;
}

/** Translate every message of a `FieldErrors` object. */
export function translateErrors<K extends string>(t: TFunction, errors: Partial<Record<K, string>>): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {};
  for (const k of Object.keys(errors) as K[]) out[k] = translateValidation(t, errors[k]) ?? undefined;
  return out;
}
