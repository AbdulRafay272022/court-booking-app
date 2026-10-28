"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { addDays, pktDateString, type StaffActivity } from "@court-booking/types";
import { ErrorState } from "@/components/error-state";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR } from "@/lib/format";
import { useFmt } from "@/lib/use-fmt";
import { useT } from "@/components/i18n/lang-provider";

/** Date presets (no native date input anywhere in this app: scripts/check-no-native-time-inputs.mjs). */
const PRESETS = [7, 30, 90] as const;

/**
 * Audit 2026-10-28 item 16: the read-only staff dashboard, shared by the owner page and the admin page. Per person (owner +
 * staff): bookings marked, no-shows, check-ins, walk-ins, short payments ("kam mila"), cash, transfers, refunds, total; and
 * the no-show list with who marked it and when. Numbers come from audit_log + payment_entries on the server.
 */
export function StaffActivityView({
  queryKey,
  load,
  canDecide = false,
}: {
  queryKey: unknown[];
  load: (from: string, to: string) => Promise<StaffActivity>;
  /** audit Phase 3 item 6: the venue's own view may keep / reverse a no-show the player answered ("Main aaya tha"). */
  canDecide?: boolean;
}) {
  const decideClient = useQueryClient();
  const onDecideNoShow = canDecide
    ? async (replyId: string, decision: "keep" | "reverse") => {
        await api.phase3.decideNoShow(replyId, decision);
        await decideClient.invalidateQueries({ queryKey: queryKey.slice(0, 1) });
      }
    : null;
  const t = useT();
  const fmt = useFmt();
  const [days, setDays] = useState<(typeof PRESETS)[number]>(30);
  const to = pktDateString();
  const from = addDays(to, -(days - 1));
  const query = useQuery({ queryKey: [...queryKey, from, to], queryFn: () => load(from, to) });
  const pkr = (n: number) => `PKR ${formatPKR(n)}`;

  return (
    <div className="flex flex-col gap-5" data-testid="staff-activity">
      <div role="group" aria-label={t("odash.sact.range")} className="flex flex-wrap gap-2">
        {PRESETS.map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={days === d}
            onClick={() => setDays(d)}
            className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${days === d ? "border-owner-accent bg-owner-accent text-white" : "border-owner-border bg-owner-surface text-owner-ink"}`}
          >
            {t("odash.sact.lastDays", { n: String(d) })}
          </button>
        ))}
      </div>

      {query.isError ? (
        <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} />
      ) : !query.data ? (
        <p className="text-owner-ink-muted" role="status">{t("odash.sact.loading")}</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-owner-border bg-owner-surface">
            <table className="w-full min-w-[820px] text-sm tabular-nums">
              <thead className="bg-owner-bg text-left text-[12px] uppercase tracking-wide text-owner-ink-faint">
                <tr>
                  <th className="px-3 py-2">{t("odash.sact.col.person")}</th>
                  <th className="px-3 py-2">{t("odash.sact.col.marked")}</th>
                  <th className="px-3 py-2">{t("odash.sact.col.noShows")}</th>
                  <th className="px-3 py-2">{t("odash.sact.col.checkIns")}</th>
                  <th className="px-3 py-2">{t("odash.sact.col.walkins")}</th>
                  <th className="px-3 py-2">{t("odash.sact.col.short")}</th>
                  <th className="px-3 py-2">{t("odash.sact.col.cash")}</th>
                  <th className="px-3 py-2">{t("odash.sact.col.transfers")}</th>
                  <th className="px-3 py-2">{t("odash.sact.col.refunds")}</th>
                  <th className="px-3 py-2">{t("odash.sact.col.total")}</th>
                </tr>
              </thead>
              <tbody>
                {query.data.people.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-3 py-6 text-center text-owner-ink-muted">
                      {t("odash.sact.empty")}
                    </td>
                  </tr>
                ) : (
                  query.data.people.map((p) => (
                    <tr key={p.user_id ?? p.name ?? "?"} className="border-t border-owner-border-light" data-testid="staff-activity-row">
                      <td className="px-3 py-2 font-semibold text-owner-ink">
                        {p.name ?? "?"} <span className="text-[12px] font-normal text-owner-ink-faint">{p.role === "owner" ? t("odash.sact.owner") : t("odash.sact.staff")}</span>
                      </td>
                      <td className="px-3 py-2">{p.bookings_marked}</td>
                      <td className="px-3 py-2">{p.no_shows}</td>
                      <td className="px-3 py-2">{p.check_ins}</td>
                      <td className="px-3 py-2">{p.walkins}</td>
                      <td className="px-3 py-2">
                        {p.short_payments}
                        {p.short_amount_pkr > 0 ? <span className="block text-[12px] text-owner-danger">{pkr(p.short_amount_pkr)}</span> : null}
                      </td>
                      <td className="px-3 py-2">{pkr(p.cash_pkr)}</td>
                      <td className="px-3 py-2">{pkr(p.transfers_pkr)}</td>
                      <td className="px-3 py-2">{pkr(p.refunds_paid_pkr)}</td>
                      <td className="px-3 py-2 font-bold">{pkr(p.total_recorded_pkr)}</td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot className="border-t-2 border-owner-border font-bold">
                <tr>
                  <td className="px-3 py-2">{t("odash.sact.totals")}</td>
                  <td className="px-3 py-2">{query.data.totals.bookings_marked}</td>
                  <td className="px-3 py-2">{query.data.totals.no_shows}</td>
                  <td className="px-3 py-2">{query.data.totals.check_ins}</td>
                  <td className="px-3 py-2">{query.data.totals.walkins}</td>
                  <td className="px-3 py-2">{query.data.totals.short_payments}</td>
                  <td className="px-3 py-2">{pkr(query.data.totals.cash_pkr)}</td>
                  <td className="px-3 py-2">{pkr(query.data.totals.transfers_pkr)}</td>
                  <td className="px-3 py-2">{pkr(query.data.totals.refunds_paid_pkr)}</td>
                  <td className="px-3 py-2">{pkr(query.data.totals.total_recorded_pkr)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <section className="flex flex-col gap-2" data-testid="staff-no-shows">
            <h2 className="text-lg font-bold">{t("odash.sact.noShowTitle")}</h2>
            {query.data.no_shows.length === 0 ? (
              <p className="text-owner-ink-muted">{t("odash.sact.noShowEmpty")}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-owner-border-light rounded-2xl border border-owner-border bg-owner-surface">
                {query.data.no_shows.map((n) => (
                  <li
                    key={n.booking_id}
                    data-testid={n.highlight ? "no-show-highlight" : "no-show-row"}
                    className={`flex flex-col gap-1 px-4 py-3 text-sm ${n.highlight ? "border-l-4 border-red-600 bg-red-50" : ""}`}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-semibold">
                        {n.player_name ?? t("odash.sact.player")} · {n.court_name ?? ""} · {n.starts_at ? fmt.when(n.starts_at) : ""}
                      </span>
                      <span className="text-owner-ink-muted">
                        {t("odash.sact.markedBy", { name: n.marked_by_name ?? "?", when: fmt.when(n.marked_at) })}
                      </span>
                    </div>
                    {n.highlight ? <span className="font-bold text-red-700">{t("odash.p3.gpsThere")}</span> : null}
                    {n.player_replied ? (
                      <span className="text-owner-ink">{t("odash.p3.playerSaysCame")}{n.player_note ? `: "${n.player_note}"` : ""}</span>
                    ) : null}
                    {n.reply_id && !n.owner_decision && onDecideNoShow ? (
                      <span className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => onDecideNoShow(n.reply_id!, "keep")} className="cursor-pointer rounded-full border border-owner-border px-3 py-1 text-[12.5px] font-bold">
                          {t("odash.p3.keepNoShow")}
                        </button>
                        <button type="button" onClick={() => onDecideNoShow(n.reply_id!, "reverse")} className="cursor-pointer rounded-full border border-owner-ink px-3 py-1 text-[12.5px] font-bold">
                          {t("odash.p3.reverseNoShow")}
                        </button>
                      </span>
                    ) : n.owner_decision ? (
                      <span className="text-owner-ink-muted">{n.owner_decision === "reverse" ? t("odash.p3.reversed") : t("odash.p3.kept")}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

/** Today minus n days (exported for the tests of callers that build a range). */
export function rangeFrom(days: number): { from: string; to: string } {
  const to = pktDateString();
  return { from: addDays(to, -(days - 1)), to };
}
