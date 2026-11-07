"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { LedgerEntry } from "@court-booking/types";
import { api } from "@/lib/api";
import { ErrorState } from "@/components/error-state";
import { CorrectPaymentSheet } from "@/components/owner/correct-payment-sheet";
import { courtLabel } from "@/components/court-label";
import { Chip } from "@/components/fl";
import { useT } from "@/components/i18n/lang-provider";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR } from "@/lib/format";
import { useFmt } from "@/lib/use-fmt";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { useOwnerCourtSports } from "@/lib/court-sports";
import { PAISA_PERIODS, correctionChange, entryKind, groupByDay, milaSplit, periodRange, type PaisaPeriod } from "@/lib/paisa";

const PERIOD_LABEL: Record<PaisaPeriod, string> = { aaj: "Aaj", hafta: "Is hafta", mahina: "Is mahina" };
const pkr = (n: number) => `PKR ${formatPKR(n)}`;

/**
 * fix/nov-7: the Hisaab tab of the owner "Paisa" page (it replaces the old Ledger table). Three tiles -- Mila (cash /
 * transfer split, for the chosen period), Lena baqi (balance still due on bookings) and Wapas dena (refunds still owed) --
 * period chips Aaj / Is hafta / Is mahina, then every money row grouped by day. A row's "⋯" menu has "Ghalti theek karein"
 * (the reversing correction, never an edit); a correction row reads "Raqam theek ki gayi" with the booking's old -> new
 * total paid. Text is Roman Urdu in both languages: these are the words the owner asked for.
 */
export function HisaabTab() {
  const t = useT();
  const fmt = useFmt();
  const sports = useOwnerCourtSports();
  const queryClient = useQueryClient();
  const { activeVenue, activeVenueId, isLoading: venuesLoading } = useOwnerVenues();
  const [period, setPeriod] = useState<PaisaPeriod>("aaj");
  const [courtId, setCourtId] = useState<string | undefined>(undefined);
  const [correcting, setCorrecting] = useState<LedgerEntry | null>(null);
  const [exporting, setExporting] = useState(false);
  const { start, end } = useMemo(() => periodRange(period), [period]);

  const query = useQuery({
    queryKey: ["owner-ledger", activeVenueId, courtId, start, end],
    queryFn: () => api.owners.ledger(start, end, { venueId: activeVenueId, courtId }),
    enabled: !!activeVenueId,
  });
  const ledger = query.data;
  const courts = activeVenue?.courts ?? [];
  const split = useMemo(() => milaSplit(ledger?.entries ?? []), [ledger]);
  const days = useMemo(() => groupByDay(ledger?.entries ?? []), [ledger]);

  async function exportCsv() {
    setExporting(true);
    try {
      const csv = await api.owners.ledgerExportCsv(start, end, { venueId: activeVenueId, courtId });
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `hisaab_${start}_${end}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(friendlyErrorMessage(e, t));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="paisa-hisaab">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="radiogroup" aria-label="Muddat" className="flex flex-wrap gap-2">
          {PAISA_PERIODS.map((p) => (
            <Chip key={p} label={PERIOD_LABEL[p]} selected={period === p} onClick={() => setPeriod(p)} />
          ))}
        </div>
        <button
          type="button"
          onClick={exportCsv}
          disabled={exporting || !ledger || ledger.entries.length === 0}
          className="min-h-10 rounded-lg border border-owner-border px-4 text-sm font-semibold disabled:opacity-50"
        >
          {exporting ? "Ban raha hai…" : "CSV download"}
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3" data-testid="paisa-tiles">
        <Tile label={`Mila · ${PERIOD_LABEL[period]}`} value={ledger ? pkr(split.total) : "—"} testId="tile-mila">
          {ledger ? (
            <span className="text-[13px] text-owner-ink-muted" data-testid="tile-mila-split">
              Cash {pkr(split.cash)} · Transfer {pkr(split.transfer)}
              {split.other !== 0 ? ` · Doosra ${pkr(split.other)}` : ""}
            </span>
          ) : null}
        </Tile>
        <Tile label="Lena baqi" value={ledger ? pkr(ledger.summary.outstanding_balance) : "—"} tone={ledger && ledger.summary.outstanding_balance > 0 ? "warn" : undefined} testId="tile-baqi">
          <span className="text-[13px] text-owner-ink-muted">Bookings par jo players ne abhi dena hai</span>
        </Tile>
        <Tile label="Wapas dena" value={ledger ? pkr(ledger.summary.cancelled_refund_pending) : "—"} tone={ledger && ledger.summary.cancelled_refund_pending > 0 ? "danger" : undefined} testId="tile-wapas">
          <span className="text-[13px] text-owner-ink-muted">Cancel hui bookings ke paise jo lautane hain</span>
        </Tile>
      </div>

      {courts.length > 1 ? (
        <div className="flex flex-wrap gap-2" aria-label="Court">
          <Chip label="Sab courts" selected={!courtId} onClick={() => setCourtId(undefined)} />
          {courts.map((c) => (
            <Chip key={c.id} label={courtLabel(c.name, c.sport)} selected={courtId === c.id} onClick={() => setCourtId(c.id)} />
          ))}
        </div>
      ) : null}

      {venuesLoading || query.isLoading ? (
        <p className="py-10 text-center text-owner-ink-faint" role="status">Load ho raha hai…</p>
      ) : query.isError && !ledger ? (
        <ErrorState message={friendlyErrorMessage(query.error, t)} onRetry={() => query.refetch()} tone="owner" />
      ) : days.length === 0 ? (
        <p className="rounded-xl border border-owner-border bg-owner-surface py-10 text-center text-owner-ink-faint">
          {PERIOD_LABEL[period]} koi paisa darj nahi hua.
        </p>
      ) : (
        <div className="flex flex-col gap-4" data-testid="paisa-days">
          {days.map((d) => (
            <section key={d.day} aria-label={d.label} className="rounded-xl border border-owner-border bg-owner-surface">
              <header className="flex items-baseline justify-between gap-3 rounded-t-xl border-b border-owner-border-light bg-owner-bg px-4 py-2.5">
                <h3 className="text-[14px] font-bold text-owner-ink" data-testid="paisa-day">{d.label}</h3>
                <span className="text-[13px] font-semibold tabular-nums text-owner-ink-muted">Kul {pkr(d.total)}</span>
              </header>
              <ul className="divide-y divide-owner-border-light">
                {d.entries.map((entry) => {
                  const change = correctionChange(entry, pkr);
                  const out = entry.amount_pkr < 0;
                  return (
                    <li key={entry.entry_id} className="flex items-center gap-3 px-4 py-3" data-testid={entry.entry_type === "correction" ? "paisa-row-correction" : "paisa-row"}>
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-[14.5px] font-semibold">{entry.player ?? "Walk-in"}</span>
                        <span className="text-[12.5px] text-owner-ink-muted">
                          <span className="tabular-nums">{fmt.time(entry.recorded_at)}</span> · {courtLabel(entry.court, entry.court_sport ?? sports.byName(entry.court))} · {fmt.bookingStatus(entry.booking_status)}
                        </span>
                        <span className="flex flex-wrap items-baseline gap-x-2 text-[12.5px]">
                          <span className={`font-bold ${entry.entry_type === "correction" ? "text-owner-warn-dark" : entry.entry_type === "refund" ? "text-owner-danger" : "text-owner-ink-muted"}`}>{entryKind(entry)}</span>
                          {change ? <span className="tabular-nums text-owner-ink-muted" data-testid="paisa-change">{change}</span> : null}
                          {entry.entry_type === "refund" && entry.note ? <span className="text-owner-ink-faint">{entry.note}</span> : null}
                        </span>
                      </div>
                      <span className={`shrink-0 text-right text-[15px] font-bold tabular-nums ${out ? "text-owner-danger" : "text-owner-ink"}`}>
                        {out ? "−" : "+"}
                        {pkr(Math.abs(entry.amount_pkr))}
                      </span>
                      <span className="w-9 shrink-0 text-right">
                        {entry.entry_type === "payment" && entry.amount_pkr > 0 ? <RowMenu onFix={() => setCorrecting(entry)} /> : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {correcting ? (
        <CorrectPaymentSheet
          entry={correcting}
          onClose={() => setCorrecting(null)}
          onReversed={() => {
            setCorrecting(null);
            void queryClient.invalidateQueries({ queryKey: ["owner-ledger"] });
            void queryClient.invalidateQueries({ queryKey: ["owner-today"] });
          }}
        />
      ) : null}
    </div>
  );
}

function Tile({ label, value, tone, testId, children }: { label: string; value: string; tone?: "warn" | "danger"; testId: string; children?: React.ReactNode }) {
  const color = tone === "danger" ? "text-owner-danger" : tone === "warn" ? "text-owner-warn-dark" : "text-owner-ink";
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-owner-border bg-owner-surface px-4 py-3" data-testid={testId}>
      <span className="text-[12px] font-bold tracking-wide text-owner-ink-faint">{label}</span>
      <span className={`text-2xl font-bold tabular-nums ${color}`}>{value}</span>
      {children}
    </div>
  );
}

/** "⋯" on a row: one item, "Ghalti theek karein". Closes on Escape, on a click outside and after choosing. */
function RowMenu({ onFix }: { onFix: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        aria-label="Aur options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-testid="paisa-row-menu"
        className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-lg font-bold text-owner-ink-muted hover:bg-owner-bg"
      >
        ⋯
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-52 rounded-xl border border-owner-border bg-owner-surface p-1 shadow-lg">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onFix();
            }}
            data-testid="paisa-fix"
            className="w-full cursor-pointer rounded-lg px-3 py-2 text-left text-[14px] font-semibold text-owner-danger hover:bg-owner-bg"
          >
            Ghalti theek karein
          </button>
        </div>
      ) : null}
    </div>
  );
}
