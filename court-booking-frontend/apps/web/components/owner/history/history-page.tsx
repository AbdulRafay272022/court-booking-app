"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { ErrorState } from "@/components/error-state";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR, pktDateString } from "@/lib/format";
import type { MessageKey } from "@/lib/i18n";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { useT } from "@/components/i18n/lang-provider";
import { BookingRowsSkeleton, BookingRowsTable } from "@/components/owner/booking-table/booking-rows-table";
import { BookingDetail } from "@/components/owner/booking-detail";
import { useCompletionFlow, useNoShowFlow } from "@/components/owner/completion-dialog";
import { useMyPermissions } from "@/lib/use-my-permissions";
import { DateFilter } from "./date-filter";
import { MultiSelect } from "./multi-select";
import {
  PAGE_SIZES,
  STATUS_FILTERS,
  buildHistoryQuery,
  formatSort,
  nextSort,
  pageCount,
  parseHistoryQuery,
  type HistoryState,
  type SortField,
} from "./filters";

/** Bookings history (`/dashboard/bookings`): every filter lives in the URL. */
export function HistoryPage() {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const { activeVenue, activeVenueId, isLoading: venuesLoading } = useOwnerVenues();
  const today = useMemo(() => pktDateString(), []);
  const state = useMemo(() => parseHistoryQuery((k) => search.get(k), today), [search, today]);

  function update(patch: Partial<HistoryState>, resetPage = true) {
    const next: HistoryState = { ...state, ...patch, page: patch.page ?? (resetPage ? 1 : state.page) };
    const qs = buildHistoryQuery(next, today);
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  // --- search box: local text, pushed to the URL 300 ms after the last keystroke ---
  const [qInput, setQInput] = useState(state.q);
  const [seenQ, setSeenQ] = useState(state.q);
  if (state.q !== seenQ) {
    // The URL changed from outside (back button, a link): follow it.
    setSeenQ(state.q);
    setQInput(state.q);
  }
  const qTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function onSearchChange(value: string) {
    setQInput(value);
    if (qTimer.current) clearTimeout(qTimer.current);
    qTimer.current = setTimeout(() => {
      setSeenQ(value.trim());
      update({ q: value.trim() });
    }, 300);
  }

  const courts = useMemo(() => activeVenue?.courts ?? [], [activeVenue]);
  const validCourts = useMemo(() => {
    if (courts.length === 0) return state.courts;
    const ids = new Set(courts.map((c) => c.id));
    return state.courts.filter((id) => ids.has(id));
  }, [courts, state.courts]);

  // Round 2 (A2): `?booking=` only highlights (and narrows the list to) that booking; the popup opens from a row click alone.
  const focusId = state.booking;
  const reqPage = focusId ? 1 : state.page;
  const reqSize = focusId ? 100 : state.size;
  const [openId, setOpenId] = useState<string | null>(null);
  const filtersKey = [activeVenueId, state.from, state.to, validCourts.join(","), state.status.join(","), state.q, reqPage, reqSize, formatSort(state.sort)];
  const filterArgs = {
    venueId: activeVenueId,
    dateFrom: state.from,
    dateTo: state.to,
    courtIds: validCourts,
    statuses: state.status,
    q: state.q,
    sort: formatSort(state.sort),
  };
  const query = useQuery({
    queryKey: ["owner-bookings-history", ...filtersKey],
    queryFn: () => api.owners.bookingsHistory({ ...filterArgs, page: reqPage, pageSize: reqSize }),
    enabled: !!activeVenueId,
    placeholderData: keepPreviousData,
  });
  const data = query.data;
  const loading = venuesLoading || query.isLoading;

  const flow = useCompletionFlow(() => {
    void query.refetch();
  });
  const noShow = useNoShowFlow(() => {
    void query.refetch();
  });
  // Stage 2 (B.b): staff without the permission never see the Haan / Nahi dropdown or the No-show button
  const perms = useMyPermissions();
  const canComplete = perms.can("record_payments");
  const canNoShow = perms.can("check_in");

  // --- CSV ---
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  async function exportCsv() {
    setExporting(true);
    setExportError(null);
    try {
      const csv = await api.owners.bookingsHistoryCsv(filterArgs);
      // The BOM makes Excel read the file as UTF-8 (names with accents).
      const blob = new Blob(["﻿" + csv.replace(/^﻿/, "")], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `bookings_${state.from}_${state.to}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(t("hist.csv.error") + " " + friendlyErrorMessage(e, t));
    } finally {
      setExporting(false);
    }
  }

  const focusRows = focusId && data ? data.items.filter((r) => r.booking_id === focusId) : [];
  const focused = focusRows.length > 0;
  const shownRows = focused ? focusRows : (data?.items ?? []);
  const clearFocusHref = (() => {
    const qs = buildHistoryQuery({ ...state, booking: null, courts: [], status: [], q: "", page: 1 }, today);
    return qs ? `${pathname}?${qs}` : pathname;
  })();
  const filtersActive = state.courts.length > 0 || state.status.length > 0 || state.q !== "";
  const total = data?.total ?? 0;
  const pages = pageCount(total, state.size);
  const firstShown = total === 0 ? 0 : (state.page - 1) * state.size + 1;
  const lastShown = Math.min(total, state.page * state.size);

  const statusOptions = STATUS_FILTERS.map((s) => ({ value: s, label: t(`hist.sf.${s}` as MessageKey) }));
  const courtOptions = courts.map((c) => ({ value: c.id, label: c.name }));

  function clearFilters() {
    setQInput("");
    setSeenQ("");
    update({ courts: [], status: [], q: "" });
  }

  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-5 p-4 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-khelo-display text-[32px] font-extrabold leading-tight text-owner-ink md:text-[40px]">{t("hist.title")}</h1>
          {activeVenue ? <p className="text-[14.5px] text-owner-ink-muted">{activeVenue.name}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/dashboard/owner/today" className="inline-flex min-h-11 items-center rounded-xl border-2 border-owner-ink px-4 text-[14px] font-bold text-owner-ink">
            {t("hist.backToOverview")}
          </Link>
          <button
            type="button"
            onClick={exportCsv}
            disabled={exporting || !data || data.total === 0}
            className="inline-flex min-h-11 items-center rounded-xl border-2 border-owner-ink px-4 text-[14px] font-bold text-owner-ink disabled:opacity-50"
          >
            {exporting ? t("hist.csv.exporting") : t("hist.csv.export")}
          </button>
        </div>
      </div>
      <p role="alert" className={exportError ? "rounded-xl bg-owner-danger-soft px-4 py-3 text-[14px] font-semibold text-owner-danger" : "sr-only"}>
        {exportError}
      </p>

      <section aria-label={t("hist.f.title")} className="grid gap-4 rounded-2xl border border-owner-border bg-owner-surface p-4 md:grid-cols-2 md:p-5 xl:grid-cols-[minmax(0,1.6fr)_repeat(2,minmax(0,1fr))]">
        <DateFilter range={{ from: state.from, to: state.to }} today={today} onChange={(r) => update({ from: r.from, to: r.to })} />
        <MultiSelect
          label={t("hist.f.courts")}
          options={courtOptions}
          selected={validCourts}
          onChange={(courtsNext) => update({ courts: courtsNext })}
          allLabel={t("hist.courts.all")}
          summary={(sel) => (sel.length === 1 ? sel[0].label : t("hist.courts.n", { n: sel.length }))}
        />
        <MultiSelect
          label={t("hist.f.status")}
          options={statusOptions}
          selected={state.status}
          onChange={(status) => update({ status: status as HistoryState["status"] })}
          allLabel={t("hist.status.all")}
          summary={(sel) => (sel.length === 1 ? sel[0].label : t("hist.status.n", { n: sel.length }))}
        />
        <div className="flex min-w-0 flex-col gap-1.5 md:col-span-2 xl:col-span-3">
          <label htmlFor="hist-search" className="text-[13px] font-bold text-owner-ink">
            {t("hist.f.search")}
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <input
              id="hist-search"
              type="search"
              value={qInput}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={t("hist.f.searchPh")}
              autoComplete="off"
              className="min-h-11 w-full max-w-md rounded-xl border border-owner-border bg-owner-surface px-4 text-[15px] text-owner-ink"
            />
            {filtersActive ? (
              <button type="button" onClick={clearFilters} className="min-h-11 rounded-xl px-3 text-[14px] font-bold text-owner-accent underline underline-offset-2">
                {t("hist.f.clear")}
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <p role="status" aria-live="polite" className={flow.message ? `text-[14px] font-semibold ${flow.message.kind === "ok" ? "text-owner-success-dark" : "text-owner-danger"}` : "sr-only"}>
        {flow.message?.text}
      </p>
      <p role="status" aria-live="polite" data-testid="hist-noshow-live" className={noShow.message ? "text-[14px] font-semibold text-owner-success-dark" : "sr-only"}>
        {noShow.message?.text}
      </p>

      {focusId && !loading ? (
        <div data-testid="focus-banner" role="status" className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-owner-accent-soft-border bg-owner-accent-soft px-4 py-2.5 text-[14px] font-semibold text-owner-ink">
          <span className="inline-flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M4 5h16l-6 7v6l-4 2v-8z" />
            </svg>
            {focused ? t("hist.focus.banner") : t("hist.focus.missing")}
          </span>
          <Link
            href={clearFocusHref}
            data-testid="focus-clear"
            className="inline-flex min-h-11 items-center font-bold text-owner-accent underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-owner-accent"
          >
            {t("hist.focus.clear")}
          </Link>
        </div>
      ) : null}

      <section aria-label={t("hist.results")} className={`rounded-2xl border border-owner-border bg-owner-surface p-3 md:p-4 ${query.isPlaceholderData ? "opacity-60" : ""}`} aria-busy={loading || query.isPlaceholderData}>
        {loading ? (
          <BookingRowsSkeleton />
        ) : query.isError && !data ? (
          <ErrorState message={friendlyErrorMessage(query.error, t)} onRetry={() => query.refetch()} tone="owner" />
        ) : !data || data.items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <p className="text-[18px] font-bold text-owner-ink">{t("hist.empty.title")}</p>
            <p className="max-w-sm text-[14.5px] text-owner-ink-muted">{t("hist.empty.text")}</p>
            {filtersActive ? (
              <button type="button" onClick={clearFilters} className="min-h-11 rounded-xl border-2 border-owner-ink px-5 text-[14px] font-bold text-owner-ink">
                {t("hist.f.clear")}
              </button>
            ) : null}
          </div>
        ) : (
          <>
            <BookingRowsTable
              rows={shownRows}
              caption={t("hist.title")}
              showDate
              compactEarly
              onOpen={(row) => setOpenId(row.booking_id)}
              onPickCompletion={canComplete ? flow.pick : undefined}
              onNoShow={canNoShow ? noShow.ask : undefined}
              busyId={flow.busyId}
              highlightId={state.booking}
              sort={state.sort}
              onSort={(field) => update({ sort: nextSort(state.sort, field as SortField) })}
            />
            {focused ? null : (
            <>
            <dl data-testid="totals" aria-label={t("hist.totals.title")} className="mt-3 grid grid-cols-2 gap-3 rounded-xl bg-owner-bg p-4 text-[14px] md:grid-cols-4">
              <div>
                <dt className="text-owner-ink-muted">{t("hist.totals.count")}</dt>
                <dd className="text-[18px] font-bold text-owner-ink">{data.totals.count}</dd>
              </div>
              <div>
                <dt className="text-owner-ink-muted">{t("hist.totals.total")}</dt>
                <dd className="text-[18px] font-bold tabular-nums text-owner-ink">PKR {formatPKR(data.totals.total)}</dd>
              </div>
              <div>
                <dt className="text-owner-ink-muted">{t("hist.totals.collected")}</dt>
                <dd className="text-[18px] font-bold tabular-nums text-owner-ink">PKR {formatPKR(data.totals.collected)}</dd>
              </div>
              <div>
                <dt className="text-owner-ink-muted">{t("hist.totals.due")}</dt>
                <dd className={`text-[18px] font-bold tabular-nums ${data.totals.due > 0 ? "text-owner-danger" : "text-owner-success-dark"}`}>PKR {formatPKR(data.totals.due)}</dd>
              </div>
            </dl>
            <nav aria-label={t("hist.page.nav")} className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-[14px] text-owner-ink-muted" role="status">
                {t("hist.page.showing", { from: firstShown, to: lastShown, total })}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-[14px] text-owner-ink-muted">
                  {t("hist.page.size")}
                  <select
                    value={state.size}
                    onChange={(e) => update({ size: Number(e.target.value) })}
                    className="min-h-11 rounded-xl border border-owner-border bg-owner-surface px-3 font-semibold text-owner-ink"
                  >
                    {PAGE_SIZES.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => update({ page: state.page - 1 })}
                  disabled={state.page <= 1}
                  className="min-h-11 rounded-xl border border-owner-border px-4 text-[14px] font-bold text-owner-ink disabled:opacity-50"
                >
                  {t("hist.page.prev")}
                </button>
                <span className="text-[14px] font-semibold text-owner-ink">{t("hist.page.of", { page: state.page, pages })}</span>
                <button
                  type="button"
                  onClick={() => update({ page: state.page + 1 })}
                  disabled={state.page >= pages}
                  className="min-h-11 rounded-xl border border-owner-border px-4 text-[14px] font-bold text-owner-ink disabled:opacity-50"
                >
                  {t("hist.page.next")}
                </button>
              </div>
            </nav>
            </>
            )}
          </>
        )}
      </section>

      <BookingDetail
        bookingId={openId}
        onClose={() => setOpenId(null)}
        onChanged={() => {
          void query.refetch();
        }}
      />
      {flow.dialog}
      {noShow.dialog}
    </div>
  );
}
