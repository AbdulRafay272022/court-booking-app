"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { addDays, pktDateString } from "@court-booking/types";
import { api } from "@/lib/api";
import { formatPKR } from "@/lib/format";
import { useFmt } from "@/lib/use-fmt";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { useT } from "@/components/i18n/lang-provider";

/** audit 2026-10-28 Phase 3 item 2: "bank se mila lein" -- every transfer credited on one day (advance and balance screenshots
 * approved), to tick off against the bank statement. Owner, or staff with view_ledger. Read-only. */
export default function OwnerBankCheckPage() {
  const t = useT();
  const fmt = useFmt();
  const { activeVenueId, isLoading: venuesLoading } = useOwnerVenues();
  const today = pktDateString();
  const [day, setDay] = useState(today);
  const query = useQuery({
    queryKey: ["bank-check", activeVenueId, day],
    queryFn: () => api.owners.bankCheck(activeVenueId!, day),
    enabled: !!activeVenueId,
  });
  const data = query.data;
  const days = [0, -1, -2, -3, -4, -5, -6].map((n) => addDays(today, n));
  return (
    <div className="flex min-w-0 max-w-4xl flex-col gap-6 p-4 sm:p-8" data-testid="bank-check">
      <div>
        <h1 className="text-2xl font-bold">{t("odash.bank.title")}</h1>
        <p className="text-sm text-owner-ink-muted">{t("odash.bank.subtitle")}</p>
      </div>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("odash.bank.day")}>
        {days.map((d) => (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={day === d}
            onClick={() => setDay(d)}
            className={`cursor-pointer whitespace-nowrap rounded-full border px-3 py-1.5 text-[13px] font-semibold ${day === d ? "border-owner-ink bg-owner-ink text-white" : "border-owner-border bg-white text-owner-ink"}`}
          >
            {fmt.dateRelative(`${d}T12:00:00+05:00`)}
          </button>
        ))}
      </div>
      {query.isError ? (
        <p className="text-owner-danger">{friendlyErrorMessage(query.error, t)}</p>
      ) : venuesLoading || query.isLoading || !data ? (
        <p className="text-owner-ink-faint">…</p>
      ) : data.items.length === 0 ? (
        <p className="rounded-xl border border-owner-border bg-white p-5 text-owner-ink-muted">{t("odash.bank.empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-owner-border bg-white">
          <table className="w-full min-w-[560px] text-left text-[14px]">
            <thead className="text-[12px] uppercase tracking-wide text-owner-ink-muted">
              <tr>
                <th className="px-4 py-3">{t("odash.bank.colTime")}</th>
                <th className="px-4 py-3">{t("odash.bank.colBooking")}</th>
                <th className="px-4 py-3">{t("odash.bank.colKind")}</th>
                <th className="px-4 py-3">{t("odash.bank.colBy")}</th>
                <th className="px-4 py-3 text-right">{t("odash.bank.colAmount")}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((i) => (
                <tr key={i.entry_id} className="border-t border-owner-border-light" data-testid="bank-check-row">
                  <td className="whitespace-nowrap px-4 py-3 font-mono">{fmt.time(i.credited_at)}</td>
                  <td className="px-4 py-3">
                    <div className="font-semibold">{i.player_name ?? t("appr.player")}</div>
                    <div className="text-[12.5px] text-owner-ink-muted">{`${i.code} · ${i.court_name} · ${fmt.dateRelative(i.starts_at)}`}</div>
                  </td>
                  <td className="px-4 py-3">{i.kind === "balance" ? t("odash.bank.kindBalance") : t("odash.bank.kindAdvance")}</td>
                  <td className="px-4 py-3">{i.approved_by === "auto" ? t("odash.bank.auto") : i.approved_by}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-mono font-bold">{`PKR ${formatPKR(i.amount_pkr)}`}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-owner-border font-bold">
                <td className="px-4 py-3" colSpan={4}>{t("odash.bank.total")}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-mono" data-testid="bank-check-total">{`PKR ${formatPKR(data.total_pkr)}`}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
