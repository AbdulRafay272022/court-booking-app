"use client";

import { useRouter } from "next/navigation";
import { LANG_COOKIE, LANGS, type Lang } from "@/lib/i18n";
import { useLang, useT } from "./lang-provider";

/**
 * English / Roman Urdu switch. Writes the `khelo_lang` cookie (one year) and refreshes the route so server components re-render in the new
 * language; no URL change. `tone="dark"` is for the dark site header, `tone="light"` for pages (Account > Settings).
 */
export function LanguageSwitch({ tone = "dark", className = "" }: { tone?: "dark" | "light"; className?: string }) {
  const lang = useLang();
  const t = useT();
  const router = useRouter();

  function choose(next: Lang) {
    if (next === lang) return;
    // eslint-disable-next-line react-hooks/immutability -- the cookie IS the persisted language; this runs in a click handler
    document.cookie = `${LANG_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  const frame = tone === "dark" ? "border-white/25" : "border-khelo-divider bg-khelo-surface";
  const on = tone === "dark" ? "bg-khelo-orange text-khelo-ink" : "bg-khelo-ink text-white";
  const off = tone === "dark" ? "text-white hover:bg-white/10" : "text-khelo-ink hover:bg-khelo-page";

  return (
    <div role="group" aria-label={t("common.lang.label")} data-testid="language-switch" className={`inline-flex shrink-0 items-center rounded-full border p-0.5 ${frame} ${className}`}>
      {LANGS.map((code) => (
        <button
          key={code}
          type="button"
          aria-pressed={lang === code}
          data-testid={`lang-${code}`}
          onClick={() => choose(code)}
          className={`inline-flex min-h-10 min-w-10 cursor-pointer items-center justify-center whitespace-nowrap rounded-full px-2.5 text-[13px] font-bold min-[1200px]:min-w-11 min-[1200px]:px-3 ${lang === code ? on : off}`}
        >
          {code === "en" ? t("common.lang.en") : t("common.lang.ru")}
        </button>
      ))}
    </div>
  );
}
