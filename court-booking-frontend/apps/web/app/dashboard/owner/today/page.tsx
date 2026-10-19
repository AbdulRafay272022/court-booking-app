"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@court-booking/api-client";
import type { CompletionInput, CompletionResult, OwnerBookingRow, OwnerOverview } from "@court-booking/types";
import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { pollInterval } from "@/lib/polling";
import { pktDateString } from "@/lib/format";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { useT } from "@/components/i18n/lang-provider";
import { useFmt } from "@/lib/use-fmt";
import { ErrorState } from "@/components/error-state";
import { BookingDetail } from "@/components/owner/booking-detail";
import { BookingsTable } from "@/components/owner/overview/bookings-table";
import { CompletionDialog, completionErrorText } from "@/components/owner/overview/completion-dialog";
import { useNoShowFlow } from "@/components/owner/completion-dialog";
import { useMyPermissions } from "@/lib/use-my-permissions";
import { CourtSelect } from "@/components/owner/overview/court-select";
import { DateSelect } from "@/components/owner/overview/date-select";
import { KpiCards } from "@/components/owner/overview/kpi-cards";
import { SlotsDialog } from "@/components/owner/overview/slots-dialog";
import {
  applyCompletion,
  courtsParam,
  findOriginalRow,
  historyHref,
  isDateString,
  overviewHref,
  parseCourtIds,
  patchOverviewRow,
  rowDomId,
  rowMatchesFilter,
} from "@/lib/overview-helpers";
import type { RowFilter, SlotFilter } from "@/lib/overview-helpers";
import { applyReceivedNow } from "@/lib/overview-completion";

export default function OwnerOverviewPage() {
  // useSearchParams needs a Suspense boundary above it
  return (
    <Suspense fallback={null}>
      <OverviewScreen />
    </Suspense>
  );
}

function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-2xl bg-khelo-divider ${className}`} aria-hidden="true" />;
}

function OverviewSkeleton() {
  const t = useT();
  return (
    <div role="status" aria-busy="true" data-testid="ovw-skeleton" className="flex flex-col gap-4">
      <span className="sr-only">{t("ovw.state.loading")}</span>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4">
        <Skeleton className="md:col-span-2 h-56" />
        <Skeleton className="h-56" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 md:gap-4">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className={`h-36 ${i === 4 ? "col-span-2 lg:col-span-1" : ""}`} />
        ))}
      </div>
      <Skeleton className="h-72" />
    </div>
  );
}

function OverviewScreen() {
  const t = useT();
  const fmt = useFmt();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const queryClient = useQueryClient();
  const { venues, activeVenue, activeVenueId, setVenueId, showSwitcher, isLoading: venuesLoading } = useOwnerVenues();
  const perms = useMyPermissions();
  const canComplete = perms.can("record_payments");
  const canNoShow = perms.can("check_in");

  const today = pktDateString();
  const dateParam = search.get("date");
  const date = isDateString(dateParam) ? dateParam : today;

  const courts = useMemo(() => (activeVenue?.courts ?? []).filter((c) => c.is_active), [activeVenue]);
  const allIds = useMemo(() => courts.map((c) => c.id), [courts]);
  const selected = parseCourtIds(search.get("courts"), allIds);
  const courtsValue = courtsParam(selected, allIds);
  const effectiveCourts = selected.length > 0 ? courts.filter((c) => selected.includes(c.id)) : courts;

  function go(nextDate: string, nextCourts: string[]) {
    router.push(overviewHref(nextDate, today, courtsParam(nextCourts, allIds)), { scroll: false });
  }

  const [filter, setFilter] = useState<RowFilter>("all");
  const [slotsOpen, setSlotsOpen] = useState(false);
  const [slotsFilter, setSlotsFilter] = useState<SlotFilter>("all");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [dialogRow, setDialogRow] = useState<OwnerBookingRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [noPermission, setNoPermission] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
    },
    [],
  );

  const queryKey = ["owner-overview", activeVenueId, date, courtsValue ?? "all"] as const;
  const overviewQuery = useQuery({
    queryKey,
    queryFn: () => api.owners.overview({ date, venueId: activeVenueId, courtIds: selected }),
    enabled: !!activeVenueId && courts.length > 0,
    // a different day or court set must never show the previous one's numbers under the new label
    placeholderData: undefined,
    refetchInterval: (query) => pollInterval(query, 15_000),
  });
  const data = overviewQuery.data;

  function completionError(e: unknown): string {
    if (e instanceof ApiError && e.status === 403) setNoPermission(true);
    return completionErrorText(e, t);
  }

  function applyServerRow(row: OwnerBookingRow) {
    queryClient.setQueryData<OwnerOverview>(queryKey, (prev) => (prev ? patchOverviewRow(prev, row) : prev));
    void queryClient.invalidateQueries({ queryKey: ["owner-overview"] });
  }

  async function markYes(row: OwnerBookingRow) {
    setMessage(null);
    setBusyId(row.booking_id);
    await queryClient.cancelQueries({ queryKey });
    const previous = queryClient.getQueryData<OwnerOverview>(queryKey);
    // Stage 2: Haan also makes the booking "completed" on the server, so the row stops being "status baqi" at once
    queryClient.setQueryData<OwnerOverview>(queryKey, (prev) => (prev ? patchOverviewRow(prev, { ...applyCompletion(row, "yes"), status_pending: false }) : prev));
    try {
      applyServerRow(await api.owners.markCompletion(row.booking_id, { result: "yes" }));
    } catch (e) {
      queryClient.setQueryData(queryKey, previous); // roll the row back
      setMessage(completionError(e));
    } finally {
      setBusyId(null);
    }
  }

  function onComplete(row: OwnerBookingRow, result: CompletionResult) {
    if (result === "yes") void markYes(row);
    else {
      setMessage(null);
      setDialogRow(row);
    }
  }

  /** "Nahi": the row changes at once (paid += received now, due -= received now), the server's row replaces it, a failure rolls it back. */
  async function submitNo(row: OwnerBookingRow, body: CompletionInput): Promise<OwnerBookingRow> {
    await queryClient.cancelQueries({ queryKey });
    const previous = queryClient.getQueryData<OwnerOverview>(queryKey);
    queryClient.setQueryData<OwnerOverview>(queryKey, (prev) =>
      prev ? patchOverviewRow(prev, { ...applyReceivedNow(row, body.received_now ?? 0, body.reason ?? ""), status_pending: false }) : prev,
    );
    try {
      const updated = await api.owners.markCompletion(row.booking_id, body);
      applyServerRow(updated);
      return updated;
    } catch (e) {
      queryClient.setQueryData(queryKey, previous);
      if (e instanceof ApiError && e.status === 403) setNoPermission(true);
      throw e;
    }
  }

  const noShow = useNoShowFlow(() => {
    void queryClient.invalidateQueries({ queryKey: ["owner-overview"] });
  });

  function openSlots(f: SlotFilter) {
    setSlotsFilter(f);
    setSlotsOpen(true);
  }

  function jumpToOriginal(row: OwnerBookingRow) {
    const original = data ? findOriginalRow(data.rows, row) : null;
    if (!original) {
      setDetailId(row.original_booking_id ?? row.booking_id);
      return;
    }
    if (!rowMatchesFilter(original, filter)) setFilter("all");
    const id = rowDomId(original);
    setHighlightId(id);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightId(null), 2500);
    // wait a frame so a row hidden by the previous filter exists before scrolling to it
    requestAnimationFrame(() => {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      document.getElementById(id)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    });
  }

  const loading = venuesLoading || overviewQuery.isLoading || (!!activeVenueId && courts.length > 0 && !data && !overviewQuery.isError);
  const subtitle = [fmt.dateString(date), activeVenue?.name].filter(Boolean).join(" \u00b7 ");

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8 flex flex-col gap-5 md:gap-6 max-w-[1240px] [&_*:focus-visible]:outline-2 [&_*:focus-visible]:outline-offset-2 [&_*:focus-visible]:outline-khelo-teal">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h1 className="font-khelo-display font-extrabold text-4xl md:text-5xl text-khelo-ink leading-tight">{t("ovw.title")}</h1>
          <p className="mt-1 text-[15px] text-khelo-muted" data-testid="ovw-subtitle">
            {subtitle}
          </p>
        </div>
        <nav className="flex flex-wrap gap-2.5 w-full sm:w-auto">
          <Link
            href="/dashboard/owner/checkin"
            className="min-h-12 flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-5 rounded-xl border-[1.5px] border-khelo-ink bg-khelo-surface font-bold text-khelo-ink whitespace-nowrap"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12l5 5 9-10" />
            </svg>
            {t("ovw.checkin")}
          </Link>
          <Link
            href="/dashboard/owner/walkin"
            data-testid="ovw-add-booking"
            className="min-h-12 flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-5 rounded-xl bg-khelo-orange font-bold text-khelo-ink whitespace-nowrap"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            {t("ovw.addBooking")}
          </Link>
          <Link
            href={historyHref({ date, courts: courtsValue })}
            data-testid="ovw-history-link"
            className="min-h-12 flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-5 rounded-xl border-[1.5px] border-khelo-ink bg-khelo-surface font-bold text-khelo-ink whitespace-nowrap"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6" />
            </svg>
            {t("ovw.history")}
          </Link>
        </nav>
      </header>

      {showSwitcher ? (
        <div role="group" aria-label={t("ovw.venueAria")} className="flex flex-wrap gap-2">
          {venues.map((v) => (
            <button
              key={v.id}
              type="button"
              aria-pressed={v.id === activeVenueId}
              onClick={() => {
                setVenueId(v.id);
                router.push(`${pathname}${date === today ? "" : `?date=${date}`}`, { scroll: false });
              }}
              className={`min-h-11 px-4 rounded-full text-sm font-bold whitespace-nowrap ${
                v.id === activeVenueId ? "bg-khelo-ink text-white" : "bg-khelo-surface border border-khelo-border text-khelo-ink"
              }`}
            >
              {v.name}
            </button>
          ))}
        </div>
      ) : null}

      <section className="rounded-2xl border border-khelo-border bg-khelo-surface p-4 md:p-5 flex flex-wrap items-end gap-x-5 gap-y-4" data-testid="ovw-filters">
        <div className="w-full sm:w-auto">
          <DateSelect date={date} today={today} onChange={(d) => go(d, selected)} />
        </div>
        {courts.length > 0 ? (
          <div className="w-full sm:w-auto">
            <CourtSelect courts={courts.map((c) => ({ id: c.id, name: c.name, sport: c.sport }))} selected={selected} onChange={(ids) => go(date, ids)} />
          </div>
        ) : null}
        <p className="flex-1 min-w-[14rem] text-sm text-khelo-muted pb-2.5">{t("ovw.filters.hint")}</p>
      </section>

      {activeVenueId && courts.length === 0 && !venuesLoading ? (
        <p className="rounded-2xl border border-khelo-border bg-khelo-surface px-6 py-12 text-center text-khelo-muted">{t("ovw.state.noCourts")}</p>
      ) : loading ? (
        <OverviewSkeleton />
      ) : overviewQuery.isError && !data ? (
        <div className="rounded-2xl border border-khelo-border bg-khelo-surface">
          <ErrorState message={friendlyErrorMessage(overviewQuery.error, t)} onRetry={() => overviewQuery.refetch()} tone="owner" />
        </div>
      ) : data ? (
        <>
          <KpiCards overview={data} date={date} today={today} courts={courtsValue} onOpenSlots={openSlots} />
          <BookingsTable
            rows={data.rows}
            filter={filter}
            onFilter={setFilter}
            title={date === today ? t("ovw.table.titleToday") : t("ovw.table.titleDay", { date: fmt.dateString(date) })}
            onOpen={setDetailId}
            onComplete={onComplete}
            onJumpToOriginal={jumpToOriginal}
            highlightId={highlightId}
            noPermission={noPermission}
            busyBookingId={busyId}
            message={message ?? (noShow.message?.kind === "error" ? noShow.message.text : null)}
            canComplete={canComplete}
            onNoShow={canNoShow ? noShow.ask : undefined}
          />
          <p role="status" aria-live="polite" data-testid="ovw-noshow-live" className={noShow.message?.kind === "ok" ? "rounded-xl bg-owner-success-soft px-4 py-3 text-sm font-semibold text-owner-success-dark" : "sr-only"}>
            {noShow.message?.kind === "ok" ? noShow.message.text : null}
          </p>
        </>
      ) : null}

      <SlotsDialog
        open={slotsOpen}
        onClose={() => setSlotsOpen(false)}
        date={date}
        courts={effectiveCourts.map((c) => ({ id: c.id, name: c.name, sport: c.sport }))}
        filter={slotsFilter}
        onFilter={setSlotsFilter}
      />
      {dialogRow ? (
        <CompletionDialog
          key={dialogRow.booking_id}
          row={dialogRow}
          onClose={() => setDialogRow(null)}
          onSaved={() => {
            setDialogRow(null);
            setMessage(null);
          }}
          submit={(body) => submitNo(dialogRow, body)}
        />
      ) : null}
      {noShow.dialog}
      <BookingDetail bookingId={detailId} onClose={() => setDetailId(null)} onChanged={() => void queryClient.invalidateQueries({ queryKey: ["owner-overview"] })} />
    </div>
  );
}
