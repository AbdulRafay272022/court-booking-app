"use client";

import { venueMissingLabel, type VenueMissingItem } from "@court-booking/types";
import { useLang, useT } from "@/components/i18n/lang-provider";

/** audit 2026-10-28 item 9: what this venue still needs before it can go live (the admin cannot approve until it is empty). */
export function VenueMissingCard({ missing }: { missing: VenueMissingItem[] | null | undefined }) {
  const t = useT();
  const lang = useLang();
  if (!missing || missing.length === 0) return null;
  return (
    <div className="rounded-2xl border border-owner-danger/30 bg-owner-danger/5 p-4 text-sm" data-testid="venue-missing" role="status">
      <p className="font-semibold text-owner-danger">{t("setup.missing.title")}</p>
      <ul className="mt-2 list-disc pl-5 text-owner-ink-muted">
        {missing.map((m, i) => (
          <li key={`${m.code}-${m.court ?? ""}-${i}`}>{venueMissingLabel(m, lang)}</li>
        ))}
      </ul>
      <p className="mt-2 text-owner-ink-faint">{t("setup.missing.hint")}</p>
    </div>
  );
}
