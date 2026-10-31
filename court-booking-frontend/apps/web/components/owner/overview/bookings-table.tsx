"use client";

import type { MouseEvent, ReactNode } from "react";
import type { CompletionResult, OwnerBookingRow } from "@court-booking/types";
import { useT } from "@/components/i18n/lang-provider";
import type { MessageKey } from "@/lib/i18n";
import { useFmt } from "@/lib/use-fmt";
import { completionValue, filterRows, initialOf, pkr, rowCounts, rowDomId, rowTone } from "@/lib/overview-helpers";
import type { RowFilter, RowTone } from "@/lib/overview-helpers";
import { useIsNarrow } from "./overlay";
import { NoShowButton, StatusPendingChip, isStatusPending } from "@/components/owner/booking-table/status-chip";

export interface BookingsTableProps {
  rows: OwnerBookingRow[];
  filter: RowFilter;
  onFilter: (f: RowFilter) => void;
  title: string;
  onOpen: (bookingId: string) => void;
  /** Haan / Chunein picked in a row's select ("no" opens the dialog in the parent). */
  onComplete: (row: OwnerBookingRow, result: CompletionResult) => void;
  onJumpToOriginal: (row: OwnerBookingRow) => void;
  /** The DOM id of the row to flash after "Original booking dekhein". */
  highlightId: string | null;
  /** The completion call answered 403: every select is disabled with a hint. */
  noPermission: boolean;
  busyBookingId: string | null;
  /** aria-live text for a failed completion (400 too early, 403, ...). */
  message: string | null;
  /** Stage 2 (B.b): false = this staff member may not record payments, so the Haan / Nahi dropdown is not shown at all. */
  canComplete?: boolean;
  /** Stage 2 (C.3): "Nahi aaye (No-show)" for a status-pending row; omitted when the user may not mark no-shows. */
  onNoShow?: (row: OwnerBookingRow) => void;
}

const TONE_ROW: Record<RowTone, string> = {
  green: "bg-fl-open-tint",
  red: "bg-owner-danger-soft",
  refund: "bg-fl-waiting-tint",
  cancelled: "bg-fl-ground",
  none: "bg-fl-white",
};

const TONE_AVATAR: Record<RowTone, string> = {
  green: "bg-fl-teal",
  red: "bg-fl-teal",
  refund: "bg-fl-waiting",
  cancelled: "bg-fl-muted",
  none: "bg-fl-teal",
};

function Icon({ d, size = 14 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const CHECK = "M5 12l5 5 9-10";
const WARN = "M12 8v5m0 3.5h.01M12 3a9 9 0 100 18 9 9 0 000-18z";

function Chip({ tone, children }: { tone: "mint" | "green" | "red" | "amber" | "grey"; children: ReactNode }) {
  const cls = {
    mint: "bg-fl-teal-tint text-fl-open",
    green: "bg-fl-open-tint text-fl-open",
    red: "bg-owner-danger-soft text-owner-danger",
    amber: "bg-fl-waiting-tint text-fl-waiting",
    grey: "bg-fl-booked-bg text-fl-night",
  }[tone];
  return <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12.5px] font-bold whitespace-nowrap ${cls}`}>{children}</span>;
}

function StatusChip({ row }: { row: OwnerBookingRow }) {
  const t = useT();
  const key = `ovw.status.${row.status_key}` as MessageKey;
  const label = row.status_key === "booked" || row.status_key === "no_show" || row.status_key === "cancelled" || row.status_key === "refund_owed" || row.status_key === "refunded" ? t(key) : row.status_key;
  const tone = row.status_key === "cancelled" ? "grey" : row.status_key === "refund_owed" ? "amber" : row.status_key === "no_show" ? "red" : "mint";
  return <Chip tone={tone}>{label}</Chip>;
}

function CompletionChip({ row }: { row: OwnerBookingRow }) {
  const t = useT();
  if (row.completion?.result === "yes")
    return (
      <Chip tone="green">
        <Icon d={CHECK} />
        {t("ovw.chip.done")}
      </Chip>
    );
  if (row.completion?.result === "no")
    return (
      <Chip tone="red">
        <Icon d={WARN} />
        {t("ovw.chip.short")}
      </Chip>
    );
  return null;
}

function CheckedInChip({ row }: { row: OwnerBookingRow }) {
  const t = useT();
  if (!row.checked_in || row.kind !== "booked") return null;
  return (
    <Chip tone="mint">
      <Icon d={CHECK} />
      {t("ovw.chip.checkedIn")}
    </Chip>
  );
}

function PlayerCell({
  row,
  onOpen,
  onJumpToOriginal,
}: {
  row: OwnerBookingRow;
  onOpen: (id: string) => void;
  onJumpToOriginal: (row: OwnerBookingRow) => void;
}) {
  const t = useT();
  const fmt = useFmt();
  const tone = rowTone(row);
  const name = row.player_name ?? t("ovw.table.noName");
  const isRefund = row.kind === "refund";
  const sub = isRefund
    ? row.refund_status === "paid"
      ? t("ovw.table.refundSubPaid")
      : t("ovw.table.refundSub")
    : `${fmt.timeRange(row.starts_at, row.ends_at)}, ${fmt.duration(row.duration_minutes)}`;
  return (
    <div className="flex items-center gap-3 min-w-0">
      {row.player_avatar_url ? (
        // audit 2026-10-28 item 6: the player's photo, the coloured initial only as the fallback
        // eslint-disable-next-line @next/next/no-img-element
        <img src={row.player_avatar_url} alt="" aria-hidden="true" className="w-11 h-11 shrink-0 rounded-full object-cover" />
      ) : (
        <span
          aria-hidden="true"
          className={`w-11 h-11 shrink-0 rounded-full flex items-center justify-center font-khelo-display font-extrabold text-lg text-white ${TONE_AVATAR[tone]}`}
        >
          {initialOf(row.player_name)}
        </span>
      )}
      <div className="min-w-0">
        <button
          type="button"
          onClick={() => onOpen(row.booking_id)}
          data-testid="ovw-open-detail"
          className="block max-w-full text-left font-bold text-[15px] text-fl-night truncate min-h-6"
        >
          {isRefund ? t("ovw.table.refundName", { name }) : name}
        </button>
        <p className="text-[13px] text-fl-muted">{sub}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-fl-muted">
          <span className="tabular-nums">{row.short_code}</span>
          {row.kind !== "booked" ? (
            <button
              type="button"
              onClick={() => onJumpToOriginal(row)}
              data-testid="ovw-original"
              className="min-h-8 px-2.5 rounded-full bg-fl-ground border border-fl-line-strong text-[12.5px] font-semibold text-fl-night whitespace-nowrap"
            >
              {t("ovw.table.original")}
            </button>
          ) : null}
        </p>
      </div>
    </div>
  );
}

function CompletionSelect({
  row,
  noPermission,
  busy,
  onComplete,
  canComplete = true,
  onNoShow,
}: {
  row: OwnerBookingRow;
  noPermission: boolean;
  busy: boolean;
  onComplete: (row: OwnerBookingRow, result: CompletionResult) => void;
  canComplete?: boolean;
  onNoShow?: (row: OwnerBookingRow) => void;
}) {
  const t = useT();
  const name = row.player_name ?? t("ovw.table.noName");
  const noShow = onNoShow && isStatusPending(row) ? <NoShowButton name={name} compact onClick={() => onNoShow(row)} /> : null;
  if (!canComplete) {
    // no record_payments permission: no dropdown (hidden up front), only the result chip and, if allowed, No-show
    return (
      <div className="flex flex-col items-start gap-1.5 min-w-0">
        <CompletionChip row={row} />
        {noShow}
      </div>
    );
  }
  const disabled = !row.slot_ended || noPermission || busy;
  const hint = !row.slot_ended ? t("ovw.complete.tooSoon") : noPermission ? t("ovw.complete.noPermission") : null;
  const hintId = `hint-${rowDomId(row)}`;
  return (
    <div className="flex flex-col items-start gap-1.5 min-w-0">
      <select
        value={completionValue(row)}
        disabled={disabled}
        aria-label={t("ovw.complete.label", { name })}
        aria-describedby={hint ? hintId : undefined}
        data-testid="ovw-completion-select"
        onChange={(e) => {
          const v = e.target.value;
          if (v === "yes" || v === "no") onComplete(row, v);
        }}
        className={`h-11 w-full max-w-[9.5rem] rounded-xl border-[1.5px] border-fl-line-strong bg-fl-white px-3 text-[15px] font-semibold ${
          disabled ? "text-fl-muted" : "text-fl-night"
        }`}
      >
        <option value="" disabled>
          {t("ovw.complete.choose")}
        </option>
        <option value="yes">{t("ovw.complete.yes")}</option>
        <option value="no">{t("ovw.complete.no")}</option>
      </select>
      {hint ? (
        <span id={hintId} className="text-[12.5px] text-fl-muted">
          {hint}
        </span>
      ) : (
        <CompletionChip row={row} />
      )}
      {noShow}
    </div>
  );
}

/** Clicks on a select / button / link inside a row must not open the detail popup. */
function rowClick(onOpen: (id: string) => void, id: string) {
  return (e: MouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest("select, button, a, input, label")) return;
    onOpen(id);
  };
}

function money(row: OwnerBookingRow) {
  const refund = row.kind === "refund";
  const cancelled = row.kind === "cancelled";
  const dash = "\u2013";
  return {
    total: refund ? dash : row.total.toLocaleString("en-US"),
    advance: refund ? dash : row.advance.toLocaleString("en-US"),
    due: refund || cancelled ? dash : row.due.toLocaleString("en-US"),
    paid: refund ? (row.refund_amount ?? 0).toLocaleString("en-US") : row.total_paid.toLocaleString("en-US"),
  };
}

export function BookingsTable(props: BookingsTableProps) {
  const { rows, filter, onFilter, title, onOpen, onComplete, onJumpToOriginal, highlightId, noPermission, busyBookingId, message, canComplete = true, onNoShow } = props;
  const t = useT();
  const narrow = useIsNarrow();
  const counts = rowCounts(rows);
  const shown = filterRows(rows, filter);

  const pills: { key: RowFilter; label: string; cls: string }[] = [
    { key: "all", label: t("ovw.table.pill.all", { n: counts.all }), cls: "bg-fl-ground text-fl-night" },
    { key: "booked", label: t("ovw.table.pill.booked", { n: counts.booked }), cls: "bg-fl-teal-tint text-fl-open" },
    { key: "cancelled", label: t("ovw.table.pill.cancelled", { n: counts.cancelled }), cls: "bg-fl-booked-bg text-fl-night" },
    { key: "refund", label: t("ovw.table.pill.refund", { n: counts.refund }), cls: "bg-fl-waiting-tint text-fl-waiting" },
  ];

  return (
    <section aria-labelledby="ovw-table-title" className="rounded-2xl border border-fl-line-strong bg-fl-white overflow-hidden" data-testid="ovw-table">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 md:px-6 pt-5 pb-4">
        <h2 id="ovw-table-title" className="font-khelo-display font-extrabold text-2xl text-fl-night">
          {title}
        </h2>
        <div role="group" aria-label={t("ovw.table.filterAria")} className="flex flex-wrap gap-2">
          {pills.map((p) => (
            <button
              key={p.key}
              type="button"
              aria-pressed={filter === p.key}
              onClick={() => onFilter(p.key)}
              data-testid={`ovw-pill-${p.key}`}
              className={`min-h-11 px-4 rounded-full text-sm font-bold whitespace-nowrap ${
                filter === p.key && p.key === "all" ? "bg-fl-night text-white" : p.cls
              } ${filter === p.key ? "ring-2 ring-fl-night ring-offset-1" : ""}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div aria-live="polite" role="status">
        {message ? (
          <p data-testid="ovw-message" className="mx-5 md:mx-6 mb-3 rounded-xl bg-owner-danger-soft px-4 py-3 text-sm font-semibold text-owner-danger">
            {message}
          </p>
        ) : null}
      </div>

      {shown.length === 0 ? (
        <p className="px-6 py-12 text-center text-fl-muted" data-testid="ovw-empty">
          {rows.length === 0 ? t("ovw.table.empty") : t("ovw.table.emptyFilter")}
        </p>
      ) : narrow ? (
        <ul className="flex flex-col gap-3 px-4 pb-4" data-testid="ovw-cards">
          {shown.map((row) => {
            const tone = rowTone(row);
            const m = money(row);
            const id = rowDomId(row);
            return (
              <li key={id}>
                <article
                  id={id}
                  data-testid="ovw-row"
                  data-tone={tone}
                  onClick={rowClick(onOpen, row.booking_id)}
                  className={`rounded-2xl border border-fl-line p-4 scroll-mt-24 ${TONE_ROW[tone]} ${highlightId === id ? "ring-4 ring-fl-teal" : ""}`}
                >
                  <PlayerCell row={row} onOpen={onOpen} onJumpToOriginal={onJumpToOriginal} />
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <StatusChip row={row} />
                    <CheckedInChip row={row} />
                    {isStatusPending(row) ? <StatusPendingChip /> : null}
                  </div>
                  {row.kind === "booked" ? (
                    <>
                      <dl className="mt-3 grid grid-cols-3 gap-2 text-[13px]">
                        {[
                          [t("ovw.table.courtShort"), row.court_name, false],
                          [t("ovw.table.col.total"), m.total, false],
                          [t("ovw.table.col.advance"), m.advance, false],
                          [t("ovw.table.col.paid"), m.paid, false],
                          [t("ovw.table.col.due"), m.due, row.due > 0],
                        ].map(([label, value, red]) => (
                          <div key={String(label)} className="min-w-0">
                            <dt className="text-fl-muted">{label}</dt>
                            <dd className={`font-bold tabular-nums truncate ${red ? "text-owner-danger" : "text-fl-night"}`}>{value}</dd>
                          </div>
                        ))}
                      </dl>
                      <div className="mt-3">
                        <CompletionSelect row={row} noPermission={noPermission} busy={busyBookingId === row.booking_id} onComplete={onComplete} canComplete={canComplete} onNoShow={onNoShow} />
                      </div>
                    </>
                  ) : (
                    <p className="mt-3 text-[13px] text-fl-muted">
                      {row.court_name} {"\u00b7"} {row.kind === "refund" ? pkr(row.refund_amount ?? 0) : pkr(row.total_paid)}
                    </p>
                  )}
                </article>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[15px] border-collapse">
            <thead>
              <tr className="text-left text-[11.5px] font-bold uppercase tracking-wider text-fl-muted border-b border-fl-line">
                <th scope="col" className="pl-6 pr-3 py-3">{t("ovw.table.col.player")}</th>
                <th scope="col" className="px-3 py-3">{t("ovw.table.col.court")}</th>
                <th scope="col" className="px-3 py-3 text-right">{t("ovw.table.col.total")}</th>
                <th scope="col" className="px-3 py-3 text-right">{t("ovw.table.col.advance")}</th>
                <th scope="col" className="px-3 py-3 text-right">{t("ovw.table.col.due")}</th>
                <th scope="col" className="px-3 py-3 text-right">{t("ovw.table.col.paid")}</th>
                <th scope="col" className="px-3 py-3">{t("ovw.table.col.status")}</th>
                <th scope="col" className="pl-3 pr-6 py-3">{t("ovw.table.col.completed")}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => {
                const tone = rowTone(row);
                const m = money(row);
                const id = rowDomId(row);
                return (
                  <tr
                    key={id}
                    id={id}
                    data-testid="ovw-row"
                    data-tone={tone}
                    onClick={rowClick(onOpen, row.booking_id)}
                    className={`border-b border-fl-line align-top cursor-pointer scroll-mt-24 transition-shadow ${TONE_ROW[tone]} ${
                      highlightId === id ? "shadow-[inset_0_0_0_3px_var(--color-fl-teal)]" : ""
                    }`}
                  >
                    <td className="pl-6 pr-3 py-4 min-w-[17rem]">
                      <PlayerCell row={row} onOpen={onOpen} onJumpToOriginal={onJumpToOriginal} />
                    </td>
                    <td className="px-3 py-4 whitespace-nowrap text-fl-night">{row.court_name}</td>
                    <td className="px-3 py-4 text-right tabular-nums text-fl-night">{m.total}</td>
                    <td className="px-3 py-4 text-right tabular-nums text-fl-night">{m.advance}</td>
                    <td className={`px-3 py-4 text-right tabular-nums ${row.kind === "booked" && row.due > 0 ? "font-bold text-owner-danger" : "text-fl-night"}`}>
                      {m.due}
                    </td>
                    <td className="px-3 py-4 text-right tabular-nums font-semibold text-fl-night">{m.paid}</td>
                    <td className="px-3 py-4">
                      <div className="flex flex-col items-start gap-1.5">
                        <StatusChip row={row} />
                        <CheckedInChip row={row} />
                        {isStatusPending(row) ? <StatusPendingChip /> : null}
                      </div>
                    </td>
                    <td className="pl-3 pr-6 py-4">
                      {row.kind === "booked" ? (
                        <CompletionSelect row={row} noPermission={noPermission} busy={busyBookingId === row.booking_id} onComplete={onComplete} canComplete={canComplete} onNoShow={onNoShow} />
                      ) : (
                        <span className="text-fl-muted">{"\u2013"}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="px-5 md:px-6 py-3 border-t border-fl-line text-[13px] text-fl-muted">
        {narrow ? t("ovw.table.hintCards") : t("ovw.table.hint")}
      </p>
    </section>
  );
}
