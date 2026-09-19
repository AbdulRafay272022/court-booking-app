"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ErrorState } from "@/components/error-state";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR, formatShortDate, formatTime, toDateInputValue } from "@/lib/format";
import { useOwnerVenues } from "@/lib/use-owner-venues";

type RangeKey = "7d" | "30d" | "month";

function rangeFor(key: RangeKey): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  if (key === "7d") start.setDate(end.getDate() - 6);
  else if (key === "30d") start.setDate(end.getDate() - 29);
  else start.setDate(1);
  return { start: toDateInputValue(start), end: toDateInputValue(end) };
}

export default function OwnerLedgerPage() {
  const { activeVenue, activeVenueId } = useOwnerVenues();
  const [rangeKey, setRangeKey] = useState<RangeKey>("30d");
  const [courtId, setCourtId] = useState<string | undefined>(undefined);
  const [exporting, setExporting] = useState(false);
  const { start, end } = useMemo(() => rangeFor(rangeKey), [rangeKey]);

  const query = useQuery({
    queryKey: ["owner-ledger", activeVenueId, start, end, courtId],
    queryFn: () => api.owners.ledger(start, end, courtId),
    enabled: !!activeVenueId,
  });

  const ledger = query.data;
  const courts = activeVenue?.courts ?? [];

  async function handleExport() {
    setExporting(true);
    try {
      const csv = await api.owners.ledgerExportCsv(start, end, courtId);
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
          disabled={exporting || !ledger || ledger.bookings.length === 0}
          className="px-4 py-2.5 rounded-lg border border-owner-border font-semibold text-sm disabled:opacity-50"
        >
          {exporting ? "Exporting…" : "Export CSV"}
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <p className="font-mono text-4xl font-semibold">PKR {ledger ? formatPKR(ledger.summary.total_revenue) : "—"}</p>
        <p className="text-owner-ink-faint text-sm">
          {ledger ? `${ledger.summary.total_bookings} bookings · PKR ${formatPKR(ledger.summary.avg_revenue_per_day)}/day avg` : ""}
        </p>
      </div>

      <div className="flex gap-2">
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
        <table className="w-full border-collapse min-w-[640px]">
          <thead>
            <tr className="bg-owner-bg border-b border-owner-border-light text-left">
              {["Date", "Time", "Player", "Court", "Source", "Status", "Amount", "Due"].map((h) => (
                <th key={h} className="px-4 py-3 text-[11px] font-bold tracking-wider text-owner-ink-faint">{h.toUpperCase()}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {query.isLoading ? (
              <tr>
                <td colSpan={8} className="text-center py-10 text-owner-ink-faint">Loading…</td>
              </tr>
            ) : query.isError && !ledger ? (
              <tr>
                <td colSpan={8} className="py-4">
                  <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} tone="owner" />
                </td>
              </tr>
            ) : !ledger || ledger.bookings.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-10 text-owner-ink-faint">No bookings in this range.</td>
              </tr>
            ) : (
              ledger.bookings.slice().reverse().map((row) => (
                <tr key={row.booking_id} className="border-b border-owner-border-light last:border-0">
                  <td className="px-4 py-3 font-mono text-sm">{formatShortDate(row.date)}</td>
                  <td className="px-4 py-3 font-mono text-sm text-owner-ink-faint">{formatTime(row.date)}</td>
                  <td className="px-4 py-3 text-sm font-semibold">{row.player ?? "Walk-in"}</td>
                  <td className="px-4 py-3 text-sm">{row.court}</td>
                  <td className="px-4 py-3 text-xs font-semibold uppercase text-owner-ink-muted">{row.source}</td>
                  <td className="px-4 py-3 text-xs font-semibold uppercase text-owner-ink-muted">{row.status}</td>
                  <td className="px-4 py-3 font-mono text-sm font-semibold">{formatPKR(row.amount_paid)}</td>
                  <td className="px-4 py-3 font-mono text-sm" style={{ color: row.balance_due > 0 ? "#9C5C0A" : "#A6B6BC" }}>
                    {row.balance_due > 0 ? formatPKR(row.balance_due) : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
