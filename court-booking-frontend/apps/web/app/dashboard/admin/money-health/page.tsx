"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatPKR } from "@/lib/format";
import { ErrorState } from "@/components/error-state";
import { friendlyErrorMessage } from "@/lib/error-messages";

/** audit 2026-10-28 Phase 3 item 9: points, dues and disputes across every venue, worst first (admin; English like the rest of
 * the console). Counts whatever exists, whether or not the flags are on. */
export default function AdminMoneyHealthPage() {
  const q = useQuery({ queryKey: ["admin-money-health"], queryFn: () => api.phase3.adminMoneyHealth() });
  const d = q.data;
  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="admin-money-health">
      <h1 className="text-2xl font-bold">Points, dues and disputes</h1>
      {q.isError ? (
        <ErrorState message={friendlyErrorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : !d ? (
        <p className="text-owner-ink-faint">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ["Open dues", String(d.totals.dues_open)],
              ["Due (PKR)", formatPKR(d.totals.dues_open_pkr)],
              ["Balance disputes waiting", String(d.totals.short_disputes_waiting)],
              ["No-show replies waiting", String(d.totals.noshow_replies_waiting)],
              ["Points given", String(d.totals.points_awarded)],
              ["Points used", String(d.totals.points_used)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-owner-border bg-white p-4">
                <p className="text-[12px] text-owner-ink-muted">{label}</p>
                <p className="font-mono text-[20px] font-bold">{value}</p>
              </div>
            ))}
          </div>
          {d.venues.length === 0 ? (
            <p className="text-owner-ink-muted">Nothing yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-owner-border bg-white">
              <table className="w-full min-w-[640px] text-left text-[14px]">
                <thead className="text-[12px] uppercase tracking-wide text-owner-ink-muted">
                  <tr>
                    <th className="px-4 py-3">Venue</th>
                    <th className="px-4 py-3">Open dues</th>
                    <th className="px-4 py-3">Due (PKR)</th>
                    <th className="px-4 py-3">Disputes</th>
                    <th className="px-4 py-3">No-show replies</th>
                    <th className="px-4 py-3">Points given / used</th>
                  </tr>
                </thead>
                <tbody>
                  {d.venues.map((v) => (
                    <tr key={v.venue_id} className="border-t border-owner-border-light">
                      <td className="px-4 py-3 font-semibold">{v.venue_name}</td>
                      <td className="px-4 py-3">{v.dues_open}</td>
                      <td className="px-4 py-3 font-mono">{formatPKR(v.dues_open_pkr)}</td>
                      <td className={`px-4 py-3 ${v.short_disputes_waiting ? "font-bold text-owner-danger" : ""}`}>{v.short_disputes_waiting}</td>
                      <td className={`px-4 py-3 ${v.noshow_replies_waiting ? "font-bold text-owner-danger" : ""}`}>{v.noshow_replies_waiting}</td>
                      <td className="px-4 py-3">{`${v.points_awarded} / ${v.points_used}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
