"use client";

import { useMemo } from "react";
import { useLang } from "@/components/i18n/lang-provider";
import { makeFmt, type Fmt } from "./format-i18n";

/** Client components: `const fmt = useFmt();` then `fmt.date(iso)`, `fmt.bookingStatus(b.status)`. Follows the language switch. */
export function useFmt(): Fmt {
  const lang = useLang();
  return useMemo(() => makeFmt(lang), [lang]);
}
