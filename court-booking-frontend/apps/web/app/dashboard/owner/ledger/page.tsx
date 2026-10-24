"use client";

import { useOwnerCourtSports } from "@/lib/court-sports";

import { courtLabel } from "@/components/court-label";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { LedgerEntry } from "@court-booking/types";
import { api } from "@/lib/api";
import { ErrorState } from "@/components/error-state";
import { CorrectPaymentSheet } from "@/components/owner/correct-payment-sheet";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { addDays, formatPKR, pktDateString } from "@/lib/format";
import { useT } from "@/components/i18n/lang-provider";
import { useFmt } from "@/lib/use-fmt";
import type { MessageKey } from "@/lib/i18n";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { Chip } from "@/components/fl";

type RangeKey = "7d" | "30d" | "month";

function rangeFor(key: RangeKey): { start: string; end: string } {
  // Pakistan calendar dates. `toISOString().slice(0, 10)` is the UTC date, which is yesterday until 5 AM in
  // Karachi and made the range end a day early (hiding the newest bookings).
  const end = pktDateString();
  const start = key === "7d" ? addDays(end, -6) : key === "30d" ? addDays(end, -29) : `${end.slice(0, 8)}01`;
  return { start, end };
}

const METHODS = ["bank_transfer_proof", "cash_at_venue", "other"];

const HEADERS: (MessageKey | null)[] = [
  "odash.ledger.h.date",
  "odash.ledger.h.time",
  "odash.ledger.h.player",
  "odash.ledger.h.court",
  "odash.ledger.h.method",
  "odash.ledger.h.status",
  "odash.ledger.h.amount",
  "odash.ledger.h.running",
  null, // i18n-ignore
];

export default function OwnerLedgerPage() {
  const t = useT();
  const fmt = useFmt();
  const { activeVenue, activeVenueId, isLoading: venuesLoading } = useOwnerVenues();
  const [rangeKey, setRangeKey] = useState<RangeKey>("30d");
  const [courtId, setCourtId] = useState<string | undefined>(undefined);
  const [exporting, setExporting] = useState(false);
  const [correcting, setCorrecting] = useState<LedgerEntry | null>(null);
  const { start, end } = useMemo(() => rangeFor(rangeKey), [rangeKey]);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["owner-ledger", activeVenueId, courtId, start, end],
    queryFn: () => api.owners.ledger(start, end, { venueId: activeVenueId, courtId }),
    enabled: !!activeVenueId,
  });

  const sports = useOwnerCourtSports();
  const courts = activeVenue?.courts ?? [];
  const ledger = query.data;
  const summary = ledger?.summary;

  async function handleExport() {
    setExporting(true);
    try {
      const csv = await api.owners.ledgerExportCsv(start, end, { venueId: activeVenueId, courtId });
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ledger_${start}_${end}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(friendlyErrorMessage(e, t));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="p-8 max-w-5xl flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("odash.ledger.title")}</h1>
        <button
          onClick={handleExport}
          disabled={exporting || !ledger || ledger.entries.length === 0}
          className="px-4 py-2.5 rounded-lg border border-owner-border font-semibold text-sm disabled:opacity-50"
        >
          {exporting ? t("odash.ledger.exporting") : t("odash.ledger.export")}
        </button>
      </div>

      {summary ? (
        <div className="grid grid-cols-3 gap-3 max-w-xl">
          <SummaryTile label={t("odash.ledger.tile.today")} value={summary.collected_today} />
          <SummaryTile label={t("odash.ledger.tile.week")} value={summary.collected_this_week} />
          <SummaryTile label={t("odash.ledger.tile.month")} value={summary.collected_this_month} />
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <p className="tabular-nums text-4xl font-semibold">PKR {ledger ? formatPKR(ledger.summary.total_in_range) : "—"}</p>
        <p className="text-owner-ink-faint text-sm">
          {ledger ? (ledger.entries.length === 1 ? t("odash.ledger.count.one") : t("odash.ledger.count.many", { n: ledger.entries.length })) : ""}
        </p>
        {summary && summary.outstanding_balance > 0 ? (
          <p className="text-sm font-semibold" style={{ color: "var(--color-fl-waiting)" }}>
            {t("odash.ledger.owed", { amount: formatPKR(summary.outstanding_balance) })}
          </p>
        ) : null}
        {summary && summary.cancelled_refund_pending > 0 ? (
          <p className="text-sm font-semibold" style={{ color: "var(--color-fl-danger)" }}>
            {t("odash.ledger.refundOwed", { amount: formatPKR(summary.cancelled_refund_pending) })}
          </p>
        ) : null}
      </div>

      <div className="flex gap-2 flex-wrap">
        {(["7d", "30d", "month"] as const).map((k) => (
          <Chip key={k} label={t(`odash.ledger.range.${k}`)} selected={rangeKey === k} onClick={() => setRangeKey(k)} />
        ))}
        {courts.length > 1 ? (
          <>
            <span className="w-px bg-owner-border mx-1" />
            <Chip label={t("odash.ledger.allCourts")} selected={!courtId} onClick={() => setCourtId(undefined)} />
            {courts.map((c) => (
              <Chip key={c.id} label={courtLabel(c.name, c.sport)} selected={courtId === c.id} onClick={() => setCourtId(c.id)} />
            ))}
          </>
        ) : null}
      </div>

      <div className="bg-owner-surface border border-owner-border rounded-xl overflow-hidden overflow-x-auto">
        <table className="w-full border-collapse min-w-[720px]">
          <thead>
            <tr className="bg-owner-bg border-b border-owner-border-light text-left">
              {HEADERS.map((h, i) => (
                <th key={i} className="px-4 py-3 text-[11px] font-bold tracking-wider text-owner-ink-faint">{h ? t(h).toUpperCase() : ""}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {venuesLoading || query.isLoading ? (
              <tr>
                <td colSpan={9} className="text-center py-10 text-owner-ink-faint">{t("odash.ledger.loading")}</td>
              </tr>
            ) : query.isError && !ledger ? (
              <tr>
                <td colSpan={9} className="py-4">
                  <ErrorState message={friendlyErrorMessage(query.error, t)} onRetry={() => query.refetch()} tone="owner" />
                </td>
              </tr>
            ) : !ledger || ledger.entries.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center py-10 text-owner-ink-faint">{t("odash.ledger.empty")}</td>
              </tr>
            ) : (
              ledger.entries.slice().reverse().map((entry) => {
                const isCorrection = entry.amount_pkr < 0;
                return (
                  <tr key={entry.entry_id} className="border-b border-owner-border-light last:border-0">
                    <td className="px-4 py-3 tabular-nums text-sm">{fmt.date(entry.recorded_at)}</td>
                    <td className="px-4 py-3 tabular-nums text-sm text-owner-ink-faint">{fmt.time(entry.recorded_at)}</td>
                    <td className="px-4 py-3 text-sm font-semibold">{entry.player ?? t("odash.ledger.walkin")}</td>
                    <td className="px-4 py-3 text-sm">{courtLabel(entry.court, entry.court_sport ?? sports.byName(entry.court))}</td>
                    <td className="px-4 py-3 text-xs font-semibold uppercase text-owner-ink-muted">
                      {entry.entry_type === "refund" ? t("odash.ledger.refund") : METHODS.includes(entry.method) ? t(`odash.ledger.method.${entry.method}` as MessageKey) : entry.method}
                      {entry.entry_type === "correction" ? t("odash.ledger.correction") : ""}
                      {entry.entry_type === "refund" && entry.note ? (
                        <span className="block normal-case font-normal text-owner-ink-faint">{entry.note}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-xs font-semibold uppercase text-owner-ink-muted">{fmt.bookingStatus(entry.booking_status)}</td>
                    <td className="px-4 py-3 tabular-nums text-sm font-semibold" style={{ color: isCorrection ? "var(--color-fl-danger)" : undefined }}>
                      {isCorrection ? "-" : ""}PKR {formatPKR(Math.abs(entry.amount_pkr))}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-sm text-owner-ink-faint">PKR {formatPKR(entry.running_total)}</td>
                    <td className="px-4 py-3 text-right">
                      {!isCorrection ? (
                        <button
                          onClick={() => setCorrecting(entry)}
                          className="text-[12px] font-semibold"
                          style={{ color: "var(--color-fl-danger)" }}
                        >
                          {t("odash.ledger.correct")}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {correcting ? (
        <CorrectPaymentSheet
          entry={correcting}
          onClose={() => setCorrecting(null)}
          onReversed={() => {
            setCorrecting(null);
            queryClient.invalidateQueries({ queryKey: ["owner-ledger"] });
            queryClient.invalidateQueries({ queryKey: ["owner-today"] });
          }}
        />
      ) : null}
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-owner-border-light bg-owner-surface px-4 py-3 flex flex-col gap-1">
      <span className="text-[11px] font-bold tracking-wider text-owner-ink-faint">{label.toUpperCase()}</span>
      <span className="tabular-nums text-lg font-semibold">PKR {formatPKR(value)}</span>
    </div>
  );
}
