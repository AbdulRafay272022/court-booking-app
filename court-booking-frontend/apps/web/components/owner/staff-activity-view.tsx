"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { addDays, pktDateString, type StaffActivity, type StaffActivityKind } from "@court-booking/types";
import Link from "next/link";
import { paisaHref } from "@/lib/paisa-redirect";
import { ErrorState } from "@/components/error-state";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR } from "@/lib/format";
import { useFmt } from "@/lib/use-fmt";
import { useT } from "@/components/i18n/lang-provider";
import { NoShowReverseDialog, type ReverseTarget } from "@/components/owner/money-dialogs";

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
  const t = useT();
  const fmt = useFmt();
  const [reverse, setReverse] = useState<ReverseTarget | null>(null);
  const [decideError, setDecideError] = useState<string | null>(null);
  const refresh = () => decideClient.invalidateQueries({ queryKey: queryKey.slice(0, 1) });
  // "keep" is one tap; "reverse" asks the final price / received / cash or transfer first (audit fixes 2026-10-31)
  const onDecideNoShow = canDecide
    ? async (replyId: string, decision: "keep" | "reverse", bookingId: string, label: string) => {
        setDecideError(null);
        try {
          if (decision === "keep") {
            await api.phase3.decideNoShow(replyId, "keep");
            await refresh();
            return;
          }
          const detail = await api.owners.bookingDetail(bookingId);
          setReverse({ bookingId, label, total: detail.row.total, paid: detail.row.total_paid, replyId });
        } catch (e) {
          setDecideError(friendlyErrorMessage(e, t));
        }
      }
    : null;
  const [days, setDays] = useState<(typeof PRESETS)[number]>(30);
  const to = pktDateString();
  const from = addDays(to, -(days - 1));
  const query = useQuery({ queryKey: [...queryKey, from, to], queryFn: () => load(from, to) });
  const pkr = (n: number) => `PKR ${formatPKR(n)}`;
  // fix/nov-9 item 8: on the venue's own page each number opens Bookings history filtered to exactly those bookings
  // (who did it + what, in the same date range). The admin view stays plain.
  const linkable = canDecide;
  const hrefFor = (p: StaffActivity["people"][number], act: StaffActivityKind): string | null => {
    if (!linkable || !p.user_id) return null;
    const usp = new URLSearchParams({ from, to, staff: p.user_id, act, who: p.name ?? "" });
    return `/dashboard/bookings?${usp.toString()}`;
  };
  // audit fixes 2026-10-31 (b): a balance transfer the bank never got -- the owner chooses who pays
  const [bankBusy, setBankBusy] = useState<string | null>(null);
  const decideBank = canDecide
    ? async (entryId: string, decision: "staff" | "player") => {
        setDecideError(null);
        setBankBusy(entryId);
        try {
          await api.owners.bankMissingDecide(entryId, decision);
          await refresh();
        } catch (e) {
          setDecideError(friendlyErrorMessage(e, t));
        } finally {
          setBankBusy(null);
        }
      }
    : null;
  const bankMissing = query.data?.bank_missing ?? [];

  return (
    <div className="flex flex-col gap-5" data-testid="staff-activity">
      {reverse ? (
        <NoShowReverseDialog
          target={reverse}
          onClose={() => setReverse(null)}
          onDone={() => {
            setReverse(null);
            void refresh();
          }}
        />
      ) : null}
      {decideError ? (
        <p role="alert" className="text-owner-danger">
          {decideError}
        </p>
      ) : null}
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
            <table className="w-full min-w-[900px] text-sm tabular-nums">
              <thead className="bg-owner-bg text-left text-[12px] uppercase tracking-wide text-owner-ink-faint">
                <tr>
                  <th className="px-3 py-2">{t("odash.sact.col.person")}</th>
                  <ColHead label={t("odash.sact.col.created")} tip={t("odash.sact.col.createdTip")} testId="sact-col-created" />
                  <ColHead label={t("odash.sact.col.marked")} tip={t("odash.sact.col.markedTip")} testId="sact-col-marked" />
                  <th className="px-3 py-2">{t("odash.sact.col.noShows")}</th>
                  <th className="px-3 py-2">{t("odash.sact.col.checkIns")}</th>
                  <th className="px-3 py-2">{t("odash.sact.col.short")}</th>
                  <th className="px-3 py-2">{t("odash.sact.col.cash")}</th>
                  <th className="px-3 py-2">{t("odash.sact.col.transfers")}</th>
                  <th className="px-3 py-2">{t("odash.sact.col.refunds")}</th>
                  <th className="px-3 py-2">{t("odash.sact.col.total")}</th>
                  <th className="px-3 py-2">{t("odash.sact.col.bankMissing")}</th>
                </tr>
              </thead>
              <tbody>
                {query.data.people.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-3 py-6 text-center text-owner-ink-muted">
                      {t("odash.sact.empty")}
                    </td>
                  </tr>
                ) : (
                  query.data.people.map((p) => (
                    <tr
                      key={p.user_id ?? p.name ?? "?"}
                      className={`border-t border-owner-border-light ${(p.bank_missing_open ?? 0) > 0 ? "bg-red-50" : ""}`}
                      data-testid={(p.bank_missing_open ?? 0) > 0 ? "staff-activity-row-red" : "staff-activity-row"}
                    >
                      <td className="px-3 py-2 font-semibold text-owner-ink">
                        {p.name ?? "?"} <span className="text-[12px] font-normal text-owner-ink-faint">{p.role === "owner" ? t("odash.sact.owner") : t("odash.sact.staff")}</span>
                      </td>
                      {/* fix/nov-9 item 8: every number opens the bookings behind it */}
                      <td className="px-3 py-2" data-testid="sact-created"><Num n={p.bookings_created ?? p.walkins} href={hrefFor(p, "created")}>{p.bookings_created ?? p.walkins}</Num></td>
                      <td className="px-3 py-2"><Num n={p.bookings_marked} href={hrefFor(p, "marked")}>{p.bookings_marked}</Num></td>
                      <td className="px-3 py-2" data-testid="sact-noshow"><Num n={p.no_shows} href={hrefFor(p, "no_show")}>{p.no_shows}</Num></td>
                      <td className="px-3 py-2"><Num n={p.check_ins} href={hrefFor(p, "check_in")}>{p.check_ins}</Num></td>
                      <td className="px-3 py-2">
                        <Num n={p.short_payments} href={hrefFor(p, "short")}>{p.short_payments}</Num>
                        {p.short_amount_pkr > 0 ? <span className="block text-[12px] text-owner-danger">{pkr(p.short_amount_pkr)}</span> : null}
                      </td>
                      <td className="px-3 py-2"><Num n={p.cash_entries} href={hrefFor(p, "cash")}>{pkr(p.cash_pkr)}</Num></td>
                      <td className="px-3 py-2"><Num n={p.transfers} href={hrefFor(p, "transfer")}>{pkr(p.transfers_pkr)}</Num></td>
                      <td className="px-3 py-2"><Num n={p.refunds_paid_pkr} href={linkable ? paisaHref("wapas") : null}>{pkr(p.refunds_paid_pkr)}</Num></td>
                      <td className="px-3 py-2 font-bold">{pkr(p.total_recorded_pkr)}</td>
                      <td className={`px-3 py-2 ${(p.bank_missing_open ?? 0) > 0 ? "font-bold text-red-700" : ""}`}>
                        {p.bank_missing ? pkr(p.bank_missing_pkr ?? 0) : "0"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot className="border-t-2 border-owner-border font-bold">
                <tr>
                  <td className="px-3 py-2">{t("odash.sact.totals")}</td>
                  <td className="px-3 py-2">{query.data.totals.bookings_created ?? query.data.totals.walkins}</td>
                  <td className="px-3 py-2">{query.data.totals.bookings_marked}</td>
                  <td className="px-3 py-2">{query.data.totals.no_shows}</td>
                  <td className="px-3 py-2">{query.data.totals.check_ins}</td>
                  <td className="px-3 py-2">{query.data.totals.short_payments}</td>
                  <td className="px-3 py-2">{pkr(query.data.totals.cash_pkr)}</td>
                  <td className="px-3 py-2">{pkr(query.data.totals.transfers_pkr)}</td>
                  <td className="px-3 py-2">{pkr(query.data.totals.refunds_paid_pkr)}</td>
                  <td className="px-3 py-2">{pkr(query.data.totals.total_recorded_pkr)}</td>
                  <td className="px-3 py-2">{pkr(query.data.totals.bank_missing_pkr ?? 0)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {bankMissing.length > 0 ? (
            <section className="flex flex-col gap-2" data-testid="staff-bank-missing">
              <h2 className="text-lg font-bold text-red-700">{t("odash.sact.bank.title")}</h2>
              <p className="text-sm text-owner-ink-muted">{t("odash.sact.bank.sub")}</p>
              <ul className="flex flex-col divide-y divide-owner-border-light rounded-2xl border border-owner-border bg-owner-surface">
                {bankMissing.map((m) => (
                  <li
                    key={m.entry_id}
                    data-testid={m.decision ? "bank-missing-done" : "bank-missing-open"}
                    className={`flex flex-col gap-1.5 px-4 py-3 text-sm ${m.decision ? "" : "border-l-4 border-red-600 bg-red-50"}`}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-semibold">
                        {t("odash.sact.bank.line", { code: m.code, player: m.player_name ?? t("odash.sact.player"), amount: formatPKR(m.amount_pkr) })}
                      </span>
                      <span className={m.decision ? "text-owner-ink-muted" : "font-bold text-red-700"}>
                        {t("odash.sact.bank.by", { name: m.approved_by_name ?? "?", when: fmt.when(m.credited_at) })}
                      </span>
                    </div>
                    {m.decision ? (
                      <span className="text-owner-ink-muted">{m.decision === "staff" ? t("odash.sact.bank.doneStaff") : t("odash.sact.bank.donePlayer")}</span>
                    ) : decideBank ? (
                      <span className="flex flex-wrap gap-2">
                        {m.approved_by_role === "staff" ? (
                          <button
                            type="button"
                            disabled={bankBusy === m.entry_id}
                            onClick={() => decideBank(m.entry_id, "staff")}
                            data-testid="bank-missing-staff"
                            className="min-h-10 cursor-pointer whitespace-nowrap rounded-full border border-owner-ink px-4 text-[13px] font-bold disabled:opacity-60"
                          >
                            {t("odash.sact.bank.staff")}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={bankBusy === m.entry_id}
                          onClick={() => decideBank(m.entry_id, "player")}
                          data-testid="bank-missing-player"
                          className="min-h-10 cursor-pointer whitespace-nowrap rounded-full border border-owner-border px-4 text-[13px] font-bold disabled:opacity-60"
                        >
                          {t("odash.sact.bank.player")}
                        </button>
                      </span>
                    ) : (
                      <span className="font-semibold text-red-700">{t("odash.sact.bank.waiting")}</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

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
                        <button type="button" onClick={() => onDecideNoShow(n.reply_id!, "keep", n.booking_id, "")} className="cursor-pointer rounded-full border border-owner-border px-3 py-1 text-[12.5px] font-bold">
                          {t("odash.p3.keepNoShow")}
                        </button>
                        <button type="button" onClick={() =>
                            onDecideNoShow(
                              n.reply_id!,
                              "reverse",
                              n.booking_id,
                              [n.player_name ?? t("odash.sact.player"), n.court_name ?? "", n.starts_at ? fmt.when(n.starts_at) : ""].join(" · "),
                            )
                          } className="cursor-pointer rounded-full border border-owner-ink px-3 py-1 text-[12.5px] font-bold">
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

/** A column heading with a short explanation: shown on hover (title) and on keyboard focus / tap (the "?" button). */
/** A count that opens its list (a plain number when there is nothing to open). */
function Num({ n, href, children }: { n: number; href: string | null; children: React.ReactNode }) {
  if (!href || !n) return <>{children}</>;
  return (
    <Link href={href} className="font-bold text-owner-accent underline underline-offset-2 hover:no-underline" data-testid="sact-link">
      {children}
    </Link>
  );
}

function ColHead({ label, tip, testId }: { label: string; tip: string; testId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <th className="relative px-3 py-2" title={tip} data-testid={testId}>
      <span className="inline-flex items-center gap-1 whitespace-nowrap">
        {label}
        <button
          type="button"
          aria-label={tip}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          onBlur={() => setOpen(false)}
          className="inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border border-owner-border text-[11px] font-bold normal-case text-owner-ink-muted"
        >
          ?
        </button>
      </span>
      {open ? (
        <span role="tooltip" className="absolute left-2 top-full z-10 mt-1 w-56 rounded-lg bg-owner-ink px-3 py-2 text-[12px] font-normal normal-case tracking-normal text-white shadow-lg">
          {tip}
        </span>
      ) : null}
    </th>
  );
}

/** Today minus n days (exported for the tests of callers that build a range). */
export function rangeFrom(days: number): { from: string; to: string } {
  const to = pktDateString();
  return { from: addDays(to, -(days - 1)), to };
}
