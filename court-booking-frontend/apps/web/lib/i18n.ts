import { DICTIONARIES, type MessageKey } from "@/messages";

/**
 * Two site languages: Roman Urdu (`ru`, the default for a first visit, it is what the site said before) and English (`en`).
 * Both are Latin script, so `<html lang>` stays "en" in both modes. The choice lives in a cookie, never in the URL
 * (all URLs and the sitemap are the same in both languages). This file is pure: it is imported by server and client code alike.
 */
export type Lang = "ru" | "en";
export const LANGS: readonly Lang[] = ["ru", "en"];
export const DEFAULT_LANG: Lang = "ru";
export const LANG_COOKIE = "khelo_lang";
export type { MessageKey };

export function parseLang(value: string | null | undefined): Lang {
  return value === "en" || value === "ru" ? value : DEFAULT_LANG;
}

export type Vars = Record<string, string | number>;

/** Replace `{name}` placeholders. A placeholder with no value is left visible as `{name}` so a missing variable is easy to spot in tests. */
export function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

export function translate(lang: Lang, key: MessageKey, vars?: Vars): string {
  return interpolate(DICTIONARIES[lang][key] ?? DICTIONARIES.ru[key] ?? key, vars);
}

export type TFunction = (key: MessageKey, vars?: Vars) => string;

export function makeT(lang: Lang): TFunction {
  return (key, vars) => translate(lang, key, vars);
}
