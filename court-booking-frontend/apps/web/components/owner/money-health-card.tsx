"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatPKR } from "@/lib/format";
import { useT } from "@/components/i18n/lang-provider";

/** audit 2026-10-28 Phase 3 item 9: the venue's points / dues / disputes at a glance on the staff dashboard. Hidden when there is
 * nothing to show. */
export function MoneyHealthCard({ venueId }: { venueId: string }) {
  const t = useT();
  const q = useQuery({ queryKey: ["owner-money-health", venueId], queryFn: () => api.phase3.moneyHealth(venueId) });
  const s = q.data?.totals;
  if (!s || (s.dues_open === 0 && s.short_disputes_waiting === 0 && s.noshow_replies_waiting === 0 && s.points_awarded === 0 && s.points_used === 0)) {
    return null;
  }
  const cells: [string, string, boolean][] = [
    [t("odash.p3.mh.dues"), `${s.dues_open} · PKR ${formatPKR(s.dues_open_pkr)}`, false],
    [t("odash.p3.mh.disputes"), String(s.short_disputes_waiting), s.short_disputes_waiting > 0],
    [t("odash.p3.mh.noshowReplies"), String(s.noshow_replies_waiting), s.noshow_replies_waiting > 0],
    [t("odash.p3.mh.points"), `${s.points_awarded} / ${s.points_used}`, false],
  ];
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-owner-border bg-owner-surface p-4" data-testid="money-health">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold">{t("odash.p3.mh.title")}</h2>
        <Link href="/dashboard/owner/dues" className="text-sm font-bold text-owner-accent hover:underline">
          {t("odash.p3.mh.open")}
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {cells.map(([label, value, warn]) => (
          <div key={label} className="rounded-xl bg-white p-3">
            <p className="text-[12px] text-owner-ink-muted">{label}</p>
            <p className={`font-mono text-[17px] font-bold ${warn ? "text-owner-danger" : ""}`}>{value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
