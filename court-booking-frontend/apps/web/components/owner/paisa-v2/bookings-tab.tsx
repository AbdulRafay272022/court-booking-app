"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  MONEY_STATUSES,
  PAISA_DEFAULT_PERIOD,
  PAISA_PERIODS,
  deductionKey,
  moneyStatusKey,
  moneyStatusTone,
  pktDateString,
  periodKey,
  type MoneyStatus,
  type PaisaPeriod,
  type PaisaStatement,
} from "@court-booking/types";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useT } from "@/components/i18n/lang-provider";
import { useFmt } from "@/lib/use-fmt";
import { Pill } from "@/components/fl";
import { DateSelect } from "@/components/owner/overview/date-select";
import { paisaV2Href, pkrText, signedPkr } from "@/lib/paisa-v2";
import { usePaisaT } from "@/lib/use-paisa-v2";
import { ErrorText, MoneyLine, PrimaryButton, Section, Select } from "./ui";

export interface PaisaRangeState {
  period: PaisaPeriod;
  from: string;
  to: string;
  courtId: string;
}

export function usePaisaRange(): [PaisaRangeState, (patch: Partial<PaisaRangeState>) => void] {
  const today = pktDateString();
  const [s, set] = useState<PaisaRangeState>({ period: PAISA_DEFAULT_PERIOD, from: today, to: today, courtId: "" });
  return [s, (patch) => set((prev) => ({ ...prev, ...patch }))];
}

/** Muddat + Court dropdowns (one line), From / To only for "Apni tareekhen". */
export function RangeFilters({ range, setRange, courts, periods = PAISA_PERIODS }: { range: PaisaRangeState; setRange: (p: Partial<PaisaRangeState>) => void; courts: { id: string; name: string }[]; periods?: readonly PaisaPeriod[] }) {
  const pt = usePaisaT();
  const today = pktDateString();
  return (
    <div className="flex flex-wrap items-end gap-3" data-testid="paisa-filters">
      <Select<PaisaPeriod> label={pt("paisa.period")} value={range.period} onChange={(period) => setRange({ period })} testId="paisa-period" options={periods.map((p) => ({ value: p, label: pt(periodKey(p)) }))} className="min-w-[11rem]" />
      {courts.length > 1 ? (
        <Select<string>
          label={pt("paisa.court")}
          value={range.courtId}
          onChange={(courtId) => setRange({ courtId })}
          testId="paisa-court"
          options={[{ value: "", label: pt("paisa.court.all") }, ...courts.map((c) => ({ value: c.id, label: c.name }))]}
          className="min-w-[10rem]"
        />
      ) : null}
      {range.period === "custom" ? (
        <>
          <div className="min-w-[10rem]"><DateSelect date={range.from} today={today} onChange={(from) => setRange({ from })} /></div>
          <div className="min-w-[10rem]"><DateSelect date={range.to} today={today} onChange={(to) => setRange({ to })} /></div>
        </>
      ) : null}
    </div>
  );
}

export function rangeParams(r: PaisaRangeState, venueId?: string) {
  return { venueId, period: r.period, from: r.from, to: r.to, courtIds: r.courtId ? [r.courtId] : undefined };
}

/** Bookings tab (contract 6.1): Abhi tak, Statement, Paisa kaise aaya, month by month, then every booking in the period. */
export function BookingsTab({
  venueId,
  courts,
  staff,
  onOpenBooking,
  onRangeChange,
}: {
  venueId?: string;
  courts: { id: string; name: string }[];
  staff: { id: string; act: string; who: string } | null;
  onOpenBooking: (id: string) => void;
  /** the header's CSV exports exactly what this tab shows */
  onRangeChange?: (r: PaisaRangeState) => void;
}) {
  const t = useT();
  const pt = usePaisaT();
  const fmt = useFmt();
  const [range, setRange] = usePaisaRange();
  const [q, setQ] = useState("");
  const [typed, setTyped] = useState("");
  const [status, setStatus] = useState<MoneyStatus | "">("");
  const [pages, setPages] = useState(1);
  const [staffFilter, setStaffFilter] = useState(staff);
  const [months, setMonths] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setQ(typed.trim()), 350);
    return () => clearTimeout(id);
  }, [typed]);
  useEffect(() => {
    onRangeChange?.(range);
  }, [range, onRangeChange]);

  const params = rangeParams(range, venueId);
  const summary = useQuery({ queryKey: ["paisa", "summary", params], queryFn: () => api.paisa.summary(params), enabled: !!venueId });
  const list = useQuery({
    queryKey: ["paisa", "bookings", params, q, status, pages, staffFilter?.id, staffFilter?.act],
    queryFn: () => api.paisa.bookings({ ...params, q: q || undefined, moneyStatus: status || undefined, staff: staffFilter?.id, act: staffFilter?.act, page: 1, pageSize: 20 * pages }),
    enabled: !!venueId,
    placeholderData: (prev) => prev,
  });
  const s = summary.data;
  const rn = s?.right_now;
  const statusOptions = useMemo(() => [{ value: "" as const, label: pt("paisa.status.all") }, ...MONEY_STATUSES.map((m) => ({ value: m, label: pt(moneyStatusKey(m)) }))], [pt]);

  const filterBy = (m: MoneyStatus) => {
    setStatus(m);
    setPages(1);
    document.getElementById("paisa-booking-list")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="paisa-bookings">
      <Section title={pt("paisa.now.title")} testId="paisa-right-now">
        <div className="grid grid-cols-2 gap-2 min-[860px]:grid-cols-5">
          <NowCard label={pt("paisa.now.due")} value={rn?.due} href={paisaV2Href("players")} tone="warn" testId="now-due" />
          <NowCard label={pt("paisa.now.refundDue")} value={rn?.refund_due} href={paisaV2Href("kaam", "refund_due")} tone="danger" testId="now-refund" />
          <NowCard label={pt("paisa.now.advance")} value={rn?.advance_received} onClick={() => filterBy("advance_paid")} testId="now-advance" />
          <NowCard label={pt("paisa.now.credit")} value={rn?.player_credit} href={paisaV2Href("players")} testId="now-credit" />
          <NowCard label={pt("paisa.now.pending")} value={rn?.pending_approval} href="/dashboard/owner/approvals" testId="now-pending" />
        </div>
      </Section>

      <RangeFilters range={range} setRange={(p) => { setRange(p); setPages(1); }} courts={courts} />
      {s ? (
        <p className="text-[13px] text-owner-ink-muted" data-testid="paisa-range-line">
          {`${fmt.dateRelative(`${s.range.from}T12:00:00+05:00`)} – ${fmt.dateRelative(`${s.range.to}T12:00:00+05:00`)} · `}
          {pt("paisa.counts", { bookings: s.counts.bookings, played: s.counts.played, noshow: s.counts.no_show, cancelled: s.counts.cancelled })}
        </p>
      ) : null}
      {summary.isError ? <ErrorText text={friendlyErrorMessage(summary.error, t)} /> : null}

      {s ? (
        <div className="grid min-w-0 gap-4 min-[860px]:grid-cols-2">
          <StatementCard st={s.statement} onFilter={filterBy} />
          <Section title={pt("paisa.in.title")} testId="paisa-money-in">
            <MoneyBar cash={s.money_in.cash} transfer={s.money_in.transfer} other={s.money_in.other} />
            <MoneyLine label={pt("paisa.in.cash")} value={pkrText(s.money_in.cash)} />
            <MoneyLine label={pt("paisa.in.transfer")} value={pkrText(s.money_in.transfer)} />
            {s.money_in.other ? <MoneyLine label={pt("paisa.in.other")} value={pkrText(s.money_in.other)} /> : null}
            <MoneyLine label={pt("paisa.in.refunds")} value={signedPkr(-s.money_in.refunds_paid.total)} tone={s.money_in.refunds_paid.total ? "danger" : undefined} />
            <MoneyLine label={pt("paisa.in.net")} value={pkrText(s.money_in.net)} strong />
          </Section>
        </div>
      ) : null}

      {s && s.by_month.length ? (
        <Section
          title={pt("paisa.months.title")}
          right={<PrimaryButton label={months ? "−" : "+"} tone="ghost" onClick={() => setMonths((v) => !v)} testId="paisa-months-toggle" />}
          testId="paisa-months"
        >
          {months ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-[13.5px] tabular-nums">
                <thead className="text-left text-[12px] text-owner-ink-faint">
                  <tr>
                    <th className="py-1.5" />
                    <th className="py-1.5 text-right">{pt("paisa.st.final")}</th>
                    <th className="py-1.5 text-right">{pt("paisa.st.received")}</th>
                    <th className="py-1.5 text-right">{pt("paisa.st.due")}</th>
                    <th className="py-1.5 text-right">{pt("paisa.st.refundDue")}</th>
                    <th className="py-1.5 text-right">{pt("paisa.months.netIn")}</th>
                  </tr>
                </thead>
                <tbody>
                  {s.by_month.map((m) => (
                    <tr key={m.month} className="border-t border-owner-border-light">
                      <td className="py-1.5 font-semibold">{fmt.month(m.month)}</td>
                      <td className="py-1.5 text-right">{pkrText(m.final)}</td>
                      <td className="py-1.5 text-right">{pkrText(m.received)}</td>
                      <td className="py-1.5 text-right">{pkrText(m.due)}</td>
                      <td className="py-1.5 text-right">{pkrText(m.refund_due)}</td>
                      <td className="py-1.5 text-right">{pkrText(m.net_in)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Section>
      ) : null}

      <div id="paisa-booking-list" className="flex scroll-mt-6 flex-col gap-3">
        {staffFilter ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-owner-accent-soft px-3 py-2 text-[13.5px]" data-testid="paisa-staff-banner">
            <span>{pt("paisa.staffFilter", { who: staffFilter.who, what: staffFilter.act })}</span>
            <PrimaryButton label={pt("paisa.clearFilter")} tone="ghost" onClick={() => setStaffFilter(null)} />
          </div>
        ) : null}
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[14rem] flex-1 flex-col gap-1">
            <span className="text-[11.5px] font-bold tracking-wide text-owner-ink-faint">{pt("paisa.search")}</span>
            <input
              value={typed}
              onChange={(e) => { setTyped(e.target.value); setPages(1); }}
              placeholder={pt("paisa.search")}
              data-testid="paisa-search"
              className="h-10 rounded-lg border border-owner-border bg-owner-surface px-3 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-owner-accent"
            />
          </label>
          <Select<MoneyStatus | ""> label={pt("paisa.status")} value={status} onChange={(v) => { setStatus(v); setPages(1); }} options={statusOptions} testId="paisa-status" className="min-w-[12rem]" />
        </div>
        {list.data?.search_all_dates && q ? <p className="text-[12.5px] text-owner-ink-muted">{pt("paisa.searchAllDates")}</p> : null}
        {list.isError ? <ErrorText text={friendlyErrorMessage(list.error, t)} /> : null}
        {list.isLoading ? <p className="py-6 text-center text-owner-ink-faint">{pt("paisa.loading")}</p> : null}
        {list.data && list.data.items.length === 0 ? (
          <p className="rounded-xl border border-owner-border bg-owner-surface py-8 text-center text-owner-ink-faint">{pt("paisa.empty.bookings")}</p>
        ) : null}
        <ul className="flex flex-col gap-2" data-testid="paisa-booking-rows">
          {list.data?.items.map((r) => (
            <li key={r.booking_id}>
              <button
                type="button"
                onClick={() => onOpenBooking(r.booking_id)}
                data-testid="paisa-booking-row"
                className="flex w-full cursor-pointer flex-wrap items-center justify-between gap-3 rounded-xl border border-owner-border bg-owner-surface px-4 py-3 text-left hover:border-owner-accent"
              >
                <span className="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
                  <span className="truncate text-[15px] font-bold text-owner-ink">{r.player}</span>
                  <span className="text-[12.5px] text-owner-ink-muted">{`${fmt.when(r.starts_at)} · ${r.court} · ${r.short_code}`}</span>
                  <span className="text-[12.5px] tabular-nums text-owner-ink-muted">{pt("paisa.row.final", { final: pkrText(r.final), received: pkrText(r.received) })}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <Pill label={pt(moneyStatusKey(r.money_status))} tone={moneyStatusTone(r.money_status)} size="sm" />
                  <span className={`text-[15px] font-extrabold tabular-nums ${r.refund_due ? "text-owner-danger" : r.due ? "text-owner-warn-dark" : "text-owner-ink"}`}>
                    {r.refund_due ? signedPkr(-r.refund_due) : pkrText(r.due || r.due_at_slot)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {list.data && list.data.items.length < list.data.total ? (
          <PrimaryButton label={pt("paisa.more")} tone="ghost" onClick={() => setPages((p) => p + 1)} testId="paisa-more" />
        ) : list.data && list.data.total > 0 ? (
          <p className="text-center text-[12.5px] text-owner-ink-faint">{pt("paisa.allShown", { n: list.data.total })}</p>
        ) : null}
      </div>
    </div>
  );
}

function NowCard({ label, value, href, onClick, tone, testId }: { label: string; value: number | undefined; href?: string; onClick?: () => void; tone?: "warn" | "danger"; testId: string }) {
  const color = value && tone === "danger" ? "text-owner-danger" : value && tone === "warn" ? "text-owner-warn-dark" : "text-owner-ink";
  const body = (
    <>
      <span className="text-[12px] font-bold text-owner-ink-faint">{label}</span>
      <span className={`text-[18px] font-extrabold tabular-nums ${color}`}>{value === undefined ? "—" : pkrText(value)}</span>
    </>
  );
  const cls = "flex min-w-0 flex-col gap-1 rounded-xl border border-owner-border bg-owner-bg px-3 py-2.5 text-left hover:border-owner-accent";
  return href ? (
    <Link href={href} className={cls} data-testid={testId}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={`${cls} cursor-pointer`} data-testid={testId}>
      {body}
    </button>
  );
}

function StatementCard({ st, onFilter }: { st: PaisaStatement; onFilter: (m: MoneyStatus) => void }) {
  const pt = usePaisaT();
  const kinds = ["points", "no_show", "cancellation", "price_reduced"] as const;
  return (
    <Section title={pt("paisa.st.title")} testId="paisa-statement">
      <MoneyLine label={pt("paisa.st.bookingAmount")} value={pkrText(st.booking_amount)} />
      <MoneyLine
        label={`− ${pt("paisa.st.deductions")}`}
        value={signedPkr(-st.deductions.total)}
        sub={kinds.filter((k) => st.deductions[k]).map((k) => `${pt(deductionKey(k))} ${pkrText(st.deductions[k])}`).join(" · ") || undefined}
      />
      <MoneyLine label={`= ${pt("paisa.st.final")}`} value={pkrText(st.final)} strong testId="st-final" />
      <div className="my-1 border-t border-owner-border-light" />
      <MoneyLine label={pt("paisa.st.received")} value={pkrText(st.received)} testId="st-received" />
      <MoneyLine label={`+ ${pt("paisa.st.due")}`} value={pkrText(st.due)} tone={st.due ? "warn" : undefined} onClick={() => onFilter("part_paid")} testId="st-due" />
      <MoneyLine label={`+ ${pt("paisa.st.dueAtSlot")}`} value={pkrText(st.due_at_slot)} onClick={() => onFilter("advance_paid")} testId="st-due-at-slot" />
      <MoneyLine label={`+ ${pt("paisa.st.waived")}`} value={pkrText(st.waived)} testId="st-waived" />
      <MoneyLine label={`− ${pt("paisa.st.refundDue")}`} value={signedPkr(-st.refund_due)} tone={st.refund_due ? "danger" : undefined} onClick={() => onFilter("refund_due")} testId="st-refund-due" />
    </Section>
  );
}

function MoneyBar({ cash, transfer, other }: { cash: number; transfer: number; other: number }) {
  const total = Math.max(cash, 0) + Math.max(transfer, 0) + Math.max(other, 0);
  if (total <= 0) return null;
  const pct = (n: number) => `${(Math.max(n, 0) / total) * 100}%`;
  return (
    <div aria-hidden className="flex h-2.5 overflow-hidden rounded-full bg-owner-bg">
      <span style={{ width: pct(cash), background: "var(--color-fl-open)" }} />
      <span style={{ width: pct(transfer), background: "var(--color-fl-teal)" }} />
      <span style={{ width: pct(other), background: "var(--color-fl-waiting)" }} />
    </div>
  );
}
