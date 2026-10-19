"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { CompletionResult, OwnerBookingRow } from "@court-booking/types";

import { formatPKR } from "@/lib/format";
import { useFmt } from "@/lib/use-fmt";
import { useT } from "@/components/i18n/lang-provider";
import { CompletionChips } from "./completion-chips";
import { NoShowButton, StatusChip, StatusPendingChip, isConfirmedBooked, isStatusPending } from "./status-chip";

export interface SortSpec {
  field: string;
  dir: "asc" | "desc";
}

export interface BookingRowsTableProps {
  rows: OwnerBookingRow[];
  /** Row / card click, and the name button (keyboard). */
  onOpen: (row: OwnerBookingRow) => void;
  /** Haan / Nahi picked in a row's dropdown. Omit for a read-only column (chips only). */
  onPickCompletion?: (row: OwnerBookingRow, result: CompletionResult) => void;
  /** Booking id whose completion call is in flight. */
  busyId?: string | null;
  /** Booking id to scroll to and highlight (the `?booking=` link). */
  highlightId?: string | null;
  /** Optional "naya" marker (Approvals/Refunds/Overview may pass one). */
  isNew?: (row: OwnerBookingRow) => boolean;
  /** Current sort and the click handler; omit `onSort` for plain headers. */
  sort?: SortSpec | null;
  onSort?: (field: string) => void;
  /** Prefix the time with the weekday and date (History spans many days). */
  showDate?: boolean;
  /** Before the slot has ended show only a hint instead of a disabled dropdown (History). */
  compactEarly?: boolean;
  /** Accessible table name. */
  caption: string;
  /** Container width in px from which the table replaces the card list. */
  tableMinWidth?: number;
  /** Stage 2 (C.3): "Nahi aaye (No-show)" on status-pending rows; omit when the user may not mark no-shows. */
  onNoShow?: (row: OwnerBookingRow) => void;
}

/** True when the element is at least `minPx` wide. Container-based, because the owner sidebar takes 240px from >= 768px viewports. */
function useWide(minPx: number) {
  const ref = useRef<HTMLDivElement>(null);
  const subscribe = useCallback(
    (cb: () => void) => {
      const el = ref.current;
      if (!el || typeof ResizeObserver === "undefined") return () => {};
      const ro = new ResizeObserver(cb);
      ro.observe(el);
      return () => ro.disconnect();
    },
    [],
  );
  const wide = useSyncExternalStore(
    subscribe,
    () => (ref.current ? ref.current.clientWidth >= minPx : false),
    () => false,
  );
  return [ref, wide] as const;
}

function Dash({ label }: { label: string }) {
  return (
    <>
      <span aria-hidden="true">-</span>
      <span className="sr-only">{label}</span>
    </>
  );
}

function rowTone(row: OwnerBookingRow): string {
  if (row.completion?.result === "yes") return "bg-owner-success-soft/60";
  if (row.completion?.result === "no") return "bg-owner-danger-soft/60";
  if (row.kind === "refund") return "bg-owner-warn-soft/50";
  if (row.kind === "cancelled" || row.status_key === "cancelled" || row.status_key === "expired") return "bg-owner-bg";
  return "bg-owner-surface";
}

function avatarTone(row: OwnerBookingRow): string {
  if (row.kind === "refund") return "bg-owner-warn";
  if (row.kind === "cancelled") return "bg-owner-ink-muted";
  return "bg-khelo-teal";
}

function rowKey(row: OwnerBookingRow): string {
  return `${row.booking_id}:${row.kind}`;
}

function Avatar({ row }: { row: OwnerBookingRow }) {
  const name = row.player_name?.trim() || "?";
  return (
    <span aria-hidden="true" className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[16px] font-bold text-white ${avatarTone(row)}`}>
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

/** "Booking completed" cell: dropdown (Haan / Nahi) once the slot ended, hint before, dash for rows that cannot be completed. */
function CompletionCell({
  row,
  onPick,
  busy,
  compactEarly,
  onNoShow,
}: {
  row: OwnerBookingRow;
  onPick?: (row: OwnerBookingRow, result: CompletionResult) => void;
  busy: boolean;
  compactEarly?: boolean;
  onNoShow?: (row: OwnerBookingRow) => void;
}) {
  const t = useT();
  if (!isConfirmedBooked(row)) {
    return (
      <span className="text-owner-ink-muted">
        <Dash label={t("hist.na")} />
      </span>
    );
  }
  const ended = row.slot_ended;
  const hintId = `hint-${rowKey(row)}`;
  const showSelect = !!onPick && (ended || !compactEarly);
  return (
    <div className="flex flex-col items-start gap-1.5">
      {showSelect ? (
        <select
          aria-label={t("hist.completed.aria", { name: row.player_name ?? row.short_code })}
          aria-describedby={ended ? undefined : hintId}
          value={row.completion?.result ?? ""}
          disabled={!ended || busy}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "yes" || v === "no") onPick?.(row, v);
          }}
          className="min-h-11 min-w-[8.5rem] rounded-xl border border-owner-border bg-owner-surface px-3 text-[14px] font-semibold text-owner-ink disabled:text-owner-ink-muted"
        >
          <option value="" disabled>
            {t("hist.completed.choose")}
          </option>
          <option value="yes">{t("hist.completed.yes")}</option>
          <option value="no">{t("hist.completed.no")}</option>
        </select>
      ) : null}
      {!ended ? (
        <span id={hintId} className="text-[12.5px] text-owner-ink-muted">
          {t("hist.completed.early")}
        </span>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        <CompletionChips row={row} showCheckedIn={false} />
      </div>
      {onNoShow && isStatusPending(row) ? <NoShowButton name={row.player_name?.trim() || row.short_code} compact onClick={() => onNoShow(row)} /> : null}
    </div>
  );
}

const COLS: { key: string; label: Parameters<ReturnType<typeof useT>>[0]; sort?: string; align?: "right" }[] = [
  { key: "player", label: "hist.col.player", sort: "starts_at" },
  { key: "court", label: "hist.col.court", sort: "court" },
  { key: "total", label: "hist.col.total", sort: "total", align: "right" },
  { key: "advance", label: "hist.col.advance", sort: "advance", align: "right" },
  { key: "due", label: "hist.col.due", sort: "due", align: "right" },
  { key: "paid", label: "hist.col.paid", sort: "total_paid", align: "right" },
  { key: "status", label: "hist.col.status", sort: "status" },
  { key: "completed", label: "hist.col.completed" },
];

function SortArrow({ dir }: { dir: "asc" | "desc" | null }) {
  return (
    <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden="true" className="shrink-0">
      <path d="M5 1L8.5 5H1.5z" fill="currentColor" opacity={dir === "asc" ? 1 : 0.28} />
      <path d="M5 11L1.5 7H8.5z" fill="currentColor" opacity={dir === "desc" ? 1 : 0.28} />
    </svg>
  );
}

export function BookingRowsTable(props: BookingRowsTableProps) {
  const { rows, onOpen, onPickCompletion, busyId, highlightId, isNew, sort, onSort, showDate, compactEarly, caption, tableMinWidth = 900, onNoShow } = props;
  const t = useT();
  const fmt = useFmt();
  const [wrapRef, wide] = useWide(tableMinWidth);
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
  }, []);

  // Scroll the linked booking into view once it is on the page.
  const scrolledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!highlightId || scrolledFor.current === highlightId || rows.length === 0) return;
    const el = wrapRef.current?.querySelector<HTMLElement>(`[data-booking-id="${highlightId}"]`);
    if (el) {
      scrolledFor.current = highlightId;
      el.scrollIntoView({ block: "center" });
    }
  }, [highlightId, rows, wrapRef, wide]);

  function jumpToOriginal(row: OwnerBookingRow) {
    const originalId = row.original_booking_id ?? row.booking_id;
    // The original is the other row of the same booking (a cancelled row for a refund, else the booked row).
    const target = rows.find((r) => r.booking_id === originalId && r.kind !== row.kind && (row.kind === "refund" ? r.kind === "cancelled" : r.kind === "booked")) ?? rows.find((r) => r.booking_id === originalId && r.kind !== row.kind);
    if (!target) {
      onOpen(row);
      return;
    }
    const el = wrapRef.current?.querySelector<HTMLElement>(`[data-row-key="${rowKey(target)}"]`);
    el?.scrollIntoView({ block: "center" });
    setFlashKey(rowKey(target));
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashKey(null), 2200);
  }

  function ringClass(row: OwnerBookingRow): string {
    const hit = flashKey === rowKey(row) || (highlightId && row.booking_id === highlightId && row.kind !== "refund");
    return hit ? "outline outline-[3px] -outline-offset-[3px] outline-owner-accent" : "";
  }

  function view(row: OwnerBookingRow) {
    const isRefund = row.kind === "refund";
    const name = row.player_name?.trim() || t("hist.walkin");
    const when = `${showDate ? `${fmt.date(row.starts_at)}, ` : ""}${fmt.timeRange(row.starts_at, row.ends_at)}, ${fmt.duration(row.duration_minutes)}`;
    return {
      isRefund,
      title: isRefund ? t("hist.row.refundTitle", { name }) : name,
      sub: isRefund ? (row.status_key === "refunded" ? t("hist.row.refunded") : t("hist.row.refundOwed")) : when,
      showMoney: !isRefund,
      due: row.kind === "booked" || row.status_key === "held" || row.status_key === "awaiting_approval" ? row.due : null,
      paid: isRefund ? (row.refund_amount ?? row.total_paid) : row.total_paid,
      hasOriginal: row.kind !== "booked" && !!row.original_booking_id,
    };
  }

  const na = t("hist.na");
  const money = (n: number | null, strong = false, danger = false) =>
    n === null ? (
      <span className="text-owner-ink-muted">
        <Dash label={na} />
      </span>
    ) : (
      <span className={`tabular-nums ${strong ? "font-bold" : ""} ${danger ? "font-bold text-owner-danger" : ""}`}>{formatPKR(n)}</span>
    );

  const originalChip = (row: OwnerBookingRow): ReactNode => (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        jumpToOriginal(row);
      }}
      className="inline-flex min-h-8 items-center rounded-full bg-owner-border-light px-3 text-[12.5px] font-bold text-owner-ink"
    >
      {t("hist.row.original")}
    </button>
  );

  const newBadge = (row: OwnerBookingRow) =>
    isNew?.(row) ? <span className="ml-2 rounded-full bg-khelo-orange px-2 py-0.5 text-[11px] font-bold text-khelo-ink">{t("hist.new")}</span> : null;

  return (
    <div ref={wrapRef} className="min-w-0">
      {wide ? (
        <table className="w-full border-collapse text-left text-[14px]">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-owner-border-light">
              {COLS.map((c) => {
                const active = c.sort && sort?.field === c.sort ? sort.dir : null;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={c.sort ? (active === "asc" ? "ascending" : active === "desc" ? "descending" : "none") : undefined}
                    className={`px-3 py-2 text-[11.5px] font-bold uppercase tracking-wider text-owner-ink-muted ${c.align === "right" ? "text-right" : ""}`}
                  >
                    {c.sort && onSort ? (
                      <button
                        type="button"
                        onClick={() => onSort(c.sort as string)}
                        className={`inline-flex min-h-11 items-center gap-1.5 uppercase tracking-wider ${c.align === "right" ? "flex-row-reverse" : ""} ${active ? "text-owner-ink" : ""}`}
                      >
                        {t(c.label)}
                        <SortArrow dir={active} />
                      </button>
                    ) : (
                      t(c.label)
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const v = view(row);
              return (
                <tr
                  key={rowKey(row)}
                  data-row-key={rowKey(row)}
                  data-booking-id={row.booking_id}
                  onClick={() => onOpen(row)}
                  className={`cursor-pointer border-b border-owner-border-light align-middle hover:brightness-[0.98] ${rowTone(row)} ${ringClass(row)}`}
                >
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar row={row} />
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpen(row);
                          }}
                          className="block max-w-[16rem] truncate text-left text-[15px] font-bold text-owner-ink underline-offset-2 hover:underline"
                        >
                          {v.title}
                        </button>
                        {newBadge(row)}
                        <div className="text-[12.5px] text-owner-ink-muted">{v.sub}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12.5px] text-owner-ink-muted">
                          <span className="tabular-nums">{row.short_code}</span>
                          {v.hasOriginal ? originalChip(row) : null}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-owner-ink">{row.court_name}</td>
                  <td className="px-3 py-3 text-right">{v.showMoney ? money(row.total) : money(null)}</td>
                  <td className="px-3 py-3 text-right">{v.showMoney ? money(row.advance) : money(null)}</td>
                  <td className="px-3 py-3 text-right">{v.showMoney && v.due !== null ? money(v.due, false, v.due > 0) : money(null)}</td>
                  <td className="px-3 py-3 text-right">{money(v.paid, v.isRefund)}</td>
                  <td className="px-3 py-3">
                    <div className="flex flex-col items-start gap-1">
                      <StatusChip statusKey={row.status_key} />
                      {row.checked_in ? <CompletionChips row={{ completion: null, checked_in: true }} /> : null}
                      {isStatusPending(row) ? <StatusPendingChip /> : null}
                    </div>
                  </td>
                  <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                    <CompletionCell row={row} onPick={onPickCompletion} busy={busyId === row.booking_id} compactEarly={compactEarly} onNoShow={onNoShow} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <ul aria-label={caption} className="flex flex-col gap-3">
          {rows.map((row) => {
            const v = view(row);
            return (
              <li
                key={rowKey(row)}
                data-row-key={rowKey(row)}
                data-booking-id={row.booking_id}
                onClick={() => onOpen(row)}
                className={`cursor-pointer rounded-2xl border border-owner-border p-4 ${rowTone(row)} ${ringClass(row)}`}
              >
                <div className="flex items-start gap-3">
                  <Avatar row={row} />
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(row);
                      }}
                      className="block max-w-full truncate text-left text-[16px] font-bold text-owner-ink"
                    >
                      {v.title}
                    </button>
                    {newBadge(row)}
                    <div className="text-[13px] text-owner-ink-muted">{v.sub}</div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <StatusChip statusKey={row.status_key} />
                    {isStatusPending(row) ? <StatusPendingChip /> : null}
                  </div>
                </div>
                {v.showMoney ? (
                  <dl className="mt-3 grid grid-cols-4 gap-2 text-[13px]">
                    <div>
                      <dt className="text-owner-ink-muted">{t("hist.col.court")}</dt>
                      <dd className="font-bold text-owner-ink">{row.court_name}</dd>
                    </div>
                    <div>
                      <dt className="text-owner-ink-muted">{t("hist.col.total")}</dt>
                      <dd className="font-bold text-owner-ink">{formatPKR(row.total)}</dd>
                    </div>
                    <div>
                      <dt className="text-owner-ink-muted">{t("hist.col.advance")}</dt>
                      <dd className="font-bold text-owner-ink">{formatPKR(row.advance)}</dd>
                    </div>
                    <div>
                      <dt className="text-owner-ink-muted">{t("hist.col.due")}</dt>
                      <dd className={`font-bold ${v.due !== null && v.due > 0 ? "text-owner-danger" : "text-owner-ink"}`}>{v.due === null ? "-" : formatPKR(v.due)}</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="mt-2 text-[13px] text-owner-ink-muted">
                    {row.court_name} {"·"} {t("hist.col.paid")} <b className="text-owner-ink">{formatPKR(v.paid)}</b>
                  </p>
                )}
                {isConfirmedBooked(row) || row.checked_in ? (
                  <div className="mt-3" onClick={(e) => e.stopPropagation()}>
                    <CompletionCell row={row} onPick={onPickCompletion} busy={busyId === row.booking_id} compactEarly={compactEarly} onNoShow={onNoShow} />
                    {row.checked_in ? (
                      <div className="mt-1.5 flex gap-1.5">
                        <CompletionChips row={{ completion: null, checked_in: true }} />
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px] text-owner-ink-muted">
                  <span className="tabular-nums">{row.short_code}</span>
                  {v.hasOriginal ? originalChip(row) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function BookingRowsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3 p-1">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex animate-pulse items-center gap-3">
          <div className="h-10 w-10 shrink-0 rounded-full bg-owner-border-light" />
          <div className="flex flex-1 flex-col gap-2">
            <div className="h-3.5 w-1/3 rounded bg-owner-border-light" />
            <div className="h-3 w-1/2 rounded bg-owner-border-light" />
          </div>
          <div className="hidden h-6 w-20 rounded-full bg-owner-border-light sm:block" />
        </div>
      ))}
    </div>
  );
}
