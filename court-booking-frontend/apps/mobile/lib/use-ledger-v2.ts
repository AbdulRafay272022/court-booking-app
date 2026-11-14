import { useFeatureFlags } from "@/lib/use-feature-flags";

/** Ledger v2 (flag `ledger_v2`, default OFF): true only once the flags are loaded AND the flag is on, so the new Paisa never
 * flashes for a venue still on the old screens (useFeatureFlags().on is true while unknown). */
export function useLedgerV2(): { v2: boolean; loaded: boolean } {
  const flags = useFeatureFlags();
  return { v2: flags.loaded && flags.on("ledger_v2"), loaded: flags.loaded };
}
