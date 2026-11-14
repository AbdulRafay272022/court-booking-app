"use client";

import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { paisaNote, paisaT, type PaisaKey } from "@court-booking/types";
import { api } from "@/lib/api";
import { useLang } from "@/components/i18n/lang-provider";

/** The flag `ledger_v2` (default OFF on the server). Fail-CLOSED, unlike useFeatureFlags: the v1 Paisa page stays until the
 * flag map says the key is on, so nobody sees v2 flash in while the map loads. */
export function useLedgerV2(): { on: boolean; loading: boolean } {
  const q = useQuery({ queryKey: ["feature-flags"], queryFn: () => api.featureFlags.publicFlags(), staleTime: 60_000 });
  return { on: q.data?.flags?.ledger_v2 === true, loading: q.isLoading };
}

/** A stored payment / adjustment note in the site language (system notes translated, typed notes as they are). */
export function usePaisaNote() {
  const lang = useLang();
  return useCallback((note: string | null | undefined) => paisaNote(note, lang), [lang]);
}

/** Paisa labels from the ONE shared dictionary (packages/types paisa-text), in the site language. */
export function usePaisaT() {
  const lang = useLang();
  return useCallback((key: PaisaKey, vars?: Record<string, string | number>) => paisaT(lang, key, vars), [lang]);
}

export type PaisaTFn = ReturnType<typeof usePaisaT>;
