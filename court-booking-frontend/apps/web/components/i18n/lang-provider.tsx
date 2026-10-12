"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { DEFAULT_LANG, makeT, type Lang, type TFunction } from "@/lib/i18n";

const LangContext = createContext<Lang>(DEFAULT_LANG);

/** Mounted once in the root layout with the language read from the cookie on the server, so client components render the same text as the server did. */
export function LangProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

export function useLang(): Lang {
  return useContext(LangContext);
}

/** Client components: `const t = useT();` then `t("auth.login.title")`. */
export function useT(): TFunction {
  const lang = useLang();
  return useMemo(() => makeT(lang), [lang]);
}
