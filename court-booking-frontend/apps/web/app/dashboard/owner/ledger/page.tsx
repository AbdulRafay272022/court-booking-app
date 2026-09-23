"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { LedgerEntry } from "@court-booking/types";
import { api } from "@/lib/api";
import { ErrorState } from "@/components/error-state";
import { CorrectPaymentSheet } from "@/components/owner/correct-payment-sheet";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { addDays, formatPKR, formatShortDate, formatTime, pktDateString } from "@/lib/format";
import { useOwnerVenues } from "@/lib/use-owner-venues";

type RangeKey = "7d" | "30d" | "month";

function rangeFor(key: RangeKey): { start: string; end: string } {
  // Pakistan calendar dates. `toISOString().slice(0, 10)` is the UTC date, which is yesterday until 5 AM in
  // Karachi and made the range end a day early (hiding the newest bookings).
  const end = pktDateString();
  const start = key === "7d" ? addDays(end, -6) : key === "30d" ? addDays(end, -29) : `${end.slice(0, 8)}01`;
  return { start, end };
}

const METHOD_LABEL: Record<string, string> = {
  bank_transfer_proof: "Bank transfer",
  cash_at_venue: "Cash",
  other: "Other",
};

export default function OwnerLedgerPage() {
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
      alert(friendlyErrorMessage(e));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="p-8 max-w-5xl flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Ledger</h1>
        <button
          onClick={handleExport}
          disabled={exporting || !ledger || ledger.entries.length === 0}
          className="px-4 py-2.5 rounded-lg border border-owner-border font-semibold text-sm disabled:opacity-50"
        >
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
      </div>

      {summary ? (
        <div className="grid grid-cols-3 gap-3 max-w-xl">
          <SummaryTile label="Collected today" value={summary.collected_today} />
          <SummaryTile label="This week" value={summary.collected_this_week} />
          <SummaryTile label="This month" value={summary.collected_this_month} />
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <p className="font-mono text-4xl font-semibold">PKR {ledger ? formatPKR(ledger.summary.total_in_range) : "—"}</p>
        <p className="text-owner-ink-faint text-sm">
          {ledger ? `${ledger.entries.length} payment${ledger.entries.length === 1 ? "" : "s"} in this range` : ""}
        </p>
        {summary && summary.outstanding_balance > 0 ? (
          <p className="text-sm font-semibold" style={{ color: "#9C5C0A" }}>
            PKR {formatPKR(summary.outstanding_balance)} still owed on booked slots
          </p>
        ) : null}
        {summary && summary.cancelled_refund_pending > 0 ? (
          <p className="text-sm font-semibold" style={{ color: "#8C3823" }}>
            PKR {formatPKR(summary.cancelled_refund_pending)} may be owed back (cancelled, unresolved)
          </p>
        ) : null}
      </div>

      <div className="flex gap-2 flex-wrap">
        {(["7d", "30d", "month"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setRangeKey(k)}
            className="px-3.5 py-2 rounded-lg text-[13px] font-semibold"
            style={{ background: rangeKey === k ? "#0E6274" : "#F4F6F7", color: rangeKey === k ? "#fff" : "#5B7079" }}
          >
            {k === "7d" ? "7 days" : k === "30d" ? "30 days" : "This month"}
          </button>
        ))}
        {courts.length > 1 ? (
          <>
            <span className="w-px bg-owner-border mx-1" />
            <button
              onClick={() => setCourtId(undefined)}
              className="px-3.5 py-2 rounded-lg text-[13px] font-semibold"
              style={{ background: !courtId ? "#0E6274" : "#F4F6F7", color: !courtId ? "#fff" : "#5B7079" }}
            >
              All courts
            </button>
            {courts.map((c) => (
              <button
                key={c.id}
                onClick={() => setCourtId(c.id)}
                className="px-3.5 py-2 rounded-lg text-[13px] font-semibold"
                style={{ background: courtId === c.id ? "#0E6274" : "#F4F6F7", color: courtId === c.id ? "#fff" : "#5B7079" }}
              >
                {c.name}
              </button>
            ))}
          </>
        ) : null}
      </div>

      <div className="bg-owner-surface border border-owner-border rounded-xl overflow-hidden overflow-x-auto">
        <table className="w-full border-collapse min-w-[720px]">
          <thead>
            <tr className="bg-owner-bg border-b border-owner-border-light text-left">
              {["Date", "Time", "Player", "Court", "Method", "Booking status", "Amount", "Running total", ""].map((h) => (
                <th key={h} className="px-4 py-3 text-[11px] font-bold tracking-wider text-owner-ink-faint">{h.toUpperCase()}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {venuesLoading || query.isLoading ? (
              <tr>
                <td colSpan={9} className="text-center py-10 text-owner-ink-faint">Loading…</td>
              </tr>
            ) : query.isError && !ledger ? (
              <tr>
                <td colSpan={9} className="py-4">
                  <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} tone="owner" />
                </td>
              </tr>
            ) : !ledger || ledger.entries.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center py-10 text-owner-ink-faint">No payments in this range.</td>
              </tr>
            ) : (
              ledger.entries.slice().reverse().map((entry) => {
                const isCorrection = entry.amount_pkr < 0;
                return (
                  <tr key={entry.entry_id} className="border-b border-owner-border-light last:border-0">
                    <td className="px-4 py-3 font-mono text-sm">{formatShortDate(entry.recorded_at)}</td>
                    <td className="px-4 py-3 font-mono text-sm text-owner-ink-faint">{formatTime(entry.recorded_at)}</td>
                    <td className="px-4 py-3 text-sm font-semibold">{entry.player ?? "Walk-in"}</td>
                    <td className="px-4 py-3 text-sm">{entry.court}</td>
                    <td className="px-4 py-3 text-xs font-semibold uppercase text-owner-ink-muted">
                      {METHOD_LABEL[entry.method] ?? entry.method}
                      {isCorrection ? " · correction" : ""}
                    </td>
                    <td className="px-4 py-3 text-xs font-semibold uppercase text-owner-ink-muted">{entry.booking_status}</td>
                    <td className="px-4 py-3 font-mono text-sm font-semibold" style={{ color: isCorrection ? "#8C3823" : undefined }}>
                      {isCorrection ? "-" : ""}PKR {formatPKR(Math.abs(entry.amount_pkr))}
                    </td>
                    <td className="px-4 py-3 font-mono text-sm text-owner-ink-faint">PKR {formatPKR(entry.running_total)}</td>
                    <td className="px-4 py-3 text-right">
                      {!isCorrection ? (
                        <button
                          onClick={() => setCorrecting(entry)}
                          className="text-[12px] font-semibold"
                          style={{ color: "#8C3823" }}
                        >
                          Correct
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
      <span className="font-mono text-lg font-semibold">PKR {formatPKR(value)}</span>
    </div>
  );
}
