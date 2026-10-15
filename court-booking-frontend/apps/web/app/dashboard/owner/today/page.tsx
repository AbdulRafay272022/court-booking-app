"use client";

import { useOwnerCourtSports } from "@/lib/court-sports";

import { courtLabel } from "@/components/court-label";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ErrorState } from "@/components/error-state";
import { RecordPaymentSheet } from "@/components/owner/record-payment-sheet";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR } from "@/lib/format";
import { useT } from "@/components/i18n/lang-provider";
import { useFmt } from "@/lib/use-fmt";
import type { TFunction } from "@/lib/i18n";
import { bookingSourceLabel } from "@court-booking/types";
import { pollInterval } from "@/lib/polling";
import { useOwnerVenues } from "@/lib/use-owner-venues";

const STATUS_COLOR: Record<string, string> = {
  booked: "#1F7A52",
  payment_submitted: "#9C5C0A",
  held: "#5B7079",
  available: "#C6D2D7",
  blocked: "#DCE3E6",
  completed: "#5B7079",
  no_show: "#8C3823",
};

export default function OwnerTodayPage() {
  const t = useT();
  const fmt = useFmt();
  const { venues, activeVenue, activeVenueId, setVenueId, showSwitcher, isLoading: venuesLoading } = useOwnerVenues();
  const [activeCourt, setActiveCourt] = useState<string | "all">("all");
  const [busyBookingId, setBusyBookingId] = useState<string | null>(null);
  const [recording, setRecording] = useState<{ bookingId: string; playerLabel: string; balanceDue: number } | null>(null);
  const queryClient = useQueryClient();

  const todayQuery = useQuery({
    queryKey: ["owner-today", activeVenueId],
    queryFn: () => api.owners.today({ venue_id: activeVenueId }),
    enabled: !!activeVenueId,
    refetchInterval: (query) => pollInterval(query, 15_000),
  });

  async function handleCheckIn(bookingId: string) {
    setBusyBookingId(bookingId);
    try {
      await api.bookings.checkin(bookingId);
      await queryClient.invalidateQueries({ queryKey: ["owner-today"] });
    } catch (e) {
      alert(friendlyErrorMessage(e, t));
    } finally {
      setBusyBookingId(null);
    }
  }

  async function handleNoShow(bookingId: string) {
    if (!confirm(t("odash.today.confirmNoShow"))) return;
    setBusyBookingId(bookingId);
    try {
      await api.bookings.noShow(bookingId);
      await queryClient.invalidateQueries({ queryKey: ["owner-today"] });
    } catch (e) {
      alert(friendlyErrorMessage(e, t));
    } finally {
      setBusyBookingId(null);
    }
  }

  const sports = useOwnerCourtSports();
  const data = todayQuery.data;
  const courts = data?.courts ?? [];
  const courtId = activeCourt === "all" ? undefined : activeCourt;
  const rows = courts
    .filter((c) => !courtId || c.court_id === courtId)
    .flatMap((c) =>
      c.slots.map((s) => ({
        ...s,
        courtName: s.court_name ?? c.name,
        // The API carries the sport now; the owner-venues lookup only covers an old backend.
        courtSport: s.court_sport ?? c.sport ?? sports.byId(c.court_id),
      })),
    )
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  return (
    <div className="p-8 flex flex-col gap-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{activeVenue?.name ?? t("odash.today.title")}</h1>
          {data ? <p className="text-owner-ink-faint text-sm">{fmt.dateString(data.date)}</p> : null}
        </div>
        <div className="flex shrink-0 gap-2">
          <Link href="/dashboard/owner/checkin" className="px-4 py-2.5 rounded-lg border border-owner-border font-semibold text-sm whitespace-nowrap">
            {t("odash.today.checkinTools")}
          </Link>
        </div>
      </div>

      {showSwitcher ? (
        <div className="flex flex-wrap gap-2">
          {venues.map((v) => (
            <button
              key={v.id}
              onClick={() => setVenueId(v.id)}
              className="px-3 py-1.5 rounded-lg text-[13px] font-semibold whitespace-nowrap"
              style={{ background: v.id === activeVenueId ? "#0E6274" : "#F4F6F7", color: v.id === activeVenueId ? "#fff" : "#5B7079" }}
            >
              {v.name}
            </button>
          ))}
        </div>
      ) : null}

      <div className="grid grid-cols-3 gap-3">
        <Stat label={t("odash.today.stat.booked")} value={data ? `${rows.filter((r) => r.status === "booked" || r.status === "payment_submitted").length}/${rows.length}` : "—"} />
        <Stat label={t("odash.today.stat.revenue")} value={data ? formatPKR(data.summary.total_revenue) : "—"} />
        <Link href="/dashboard/owner/approvals">
          <Stat label={t("odash.today.stat.pending")} value={data ? String(data.summary.pending_approvals) : "—"} warn />
        </Link>
      </div>

      {courts.length > 1 ? (
        <div className="flex gap-2">
          <button
            onClick={() => setActiveCourt("all")}
            className="px-3.5 py-2 rounded-lg text-[13px] font-semibold"
            style={{ background: activeCourt === "all" ? "#0E6274" : "#F4F6F7", color: activeCourt === "all" ? "#fff" : "#5B7079" }}
          >
            {t("odash.today.all")}
          </button>
          {courts.map((c) => (
            <button
              key={c.court_id}
              onClick={() => setActiveCourt(c.court_id)}
              className="px-3.5 py-2 rounded-lg text-[13px] font-semibold"
              style={{ background: activeCourt === c.court_id ? "#0E6274" : "#F4F6F7", color: activeCourt === c.court_id ? "#fff" : "#5B7079" }}
            >
              {courtLabel(c.name, c.sport ?? sports.byId(c.court_id))}
            </button>
          ))}
        </div>
      ) : null}

      <div className="bg-owner-surface border border-owner-border rounded-xl overflow-hidden">
        {venuesLoading || todayQuery.isLoading ? (
          <p className="p-8 text-center text-owner-ink-faint">{t("odash.today.loading")}</p>
        ) : todayQuery.isError && !data ? (
          <ErrorState message={friendlyErrorMessage(todayQuery.error, t)} onRetry={() => todayQuery.refetch()} tone="owner" />
        ) : rows.length === 0 ? (
          <p className="p-8 text-center text-owner-ink-faint">{t("odash.today.empty")}</p>
        ) : (
          rows.map((slot) => (
            <div
              key={`${slot.courtName}-${slot.starts_at}`}
              className="flex items-center gap-4 px-5 py-3.5 border-b border-owner-border-light last:border-0"
              style={{ borderLeft: `3px solid ${STATUS_COLOR[slot.status] ?? "#DCE3E6"}` }}
            >
              <span className="font-mono text-sm font-semibold w-[4.75rem] shrink-0">{fmt.time(slot.starts_at)}</span>
              <div className="flex-1">
                <p className="font-semibold text-sm" data-testid="today-row-title">
                  {slot.booking_id || activeCourt === "all" ? `${courtLabel(slot.courtName, slot.courtSport)} · ` : ""}{slot.player_name ?? statusLabel(t, slot.status)}
                </p>
                <p className="text-xs text-owner-ink-faint">{statusSubtitle(t, slot.status)}</p>
                {slot.booking_id ? (
                  <p className="text-xs font-semibold" data-testid="today-row-range">
                    {fmt.timeRange(slot.starts_at, slot.ends_at)}
                  </p>
                ) : null}
                {slot.booking_id ? (
                  <>
                    <p className="text-xs text-owner-ink-faint" data-testid="today-row-origin">
                      {[
                        bookingSourceLabel(slot.booking_source) ? t("odash.today.bookedVia", { source: bookingSourceLabel(slot.booking_source) ?? "" }) : null,
                        slot.booked_at ? t("odash.today.bookedOn", { when: fmt.when(slot.booked_at) }) : null,
                        slot.account_name && slot.account_name !== slot.player_name ? t("odash.today.account", { name: slot.account_name }) : null,
                      ].filter(Boolean).join(" · ")}
                    </p>
                    {slot.price != null ? (
                      <p className="text-xs font-mono text-owner-ink-muted" data-testid="today-row-money">
                        {t("odash.today.money", { total: formatPKR(slot.price), paid: formatPKR(slot.amount_paid ?? 0), balance: formatPKR(slot.balance_due ?? 0) })}
                      </p>
                    ) : null}
                  </>
                ) : null}
              </div>
              {slot.status === "payment_submitted" ? (
                <Link href="/dashboard/owner/approvals" className="px-3 py-2 rounded-lg text-white text-xs font-semibold" style={{ background: "#9C5C0A" }}>
                  {t("odash.today.review")}
                </Link>
              ) : slot.status === "booked" && slot.balance_due != null && slot.balance_due > 0 && slot.booking_id ? (
                <button
                  onClick={() =>
                    setRecording({ bookingId: slot.booking_id!, playerLabel: slot.player_name ?? t("odash.today.player"), balanceDue: slot.balance_due! })
                  }
                  className="text-right"
                >
                  <span className="font-mono text-sm font-semibold block">PKR {formatPKR(slot.amount_paid ?? 0)}</span>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full inline-block mt-0.5" style={{ background: "#FBF0DD", color: "#9C5C0A" }}>
                    {t("odash.today.record", { amount: formatPKR(slot.balance_due) })}
                  </span>
                </button>
              ) : slot.amount_paid != null ? (
                <div className="text-right">
                  <span className="font-mono text-sm font-semibold block">PKR {formatPKR(slot.amount_paid)}</span>
                  {slot.status === "booked" && slot.balance_due != null ? (
                    <span className="text-[11px] font-semibold block" style={{ color: slot.balance_due > 0 ? "#9C5C0A" : "#1F7A52" }}>
                      {slot.balance_due > 0 ? t("odash.today.dueAtVenue", { amount: formatPKR(slot.balance_due) }) : t("odash.today.fullyPaid")}
                    </span>
                  ) : null}
                  {slot.status === "booked" && slot.booking_id ? (
                    <div className="flex gap-1.5 mt-1 justify-end">
                      <button
                        disabled={busyBookingId === slot.booking_id}
                        onClick={() => handleCheckIn(slot.booking_id as string)}
                        className="px-2.5 py-1 rounded text-white text-[11px] font-semibold disabled:opacity-50"
                        style={{ background: "#0E6274" }}
                      >
                        {t("odash.today.checkIn")}
                      </button>
                      <button
                        disabled={busyBookingId === slot.booking_id}
                        onClick={() => handleNoShow(slot.booking_id as string)}
                        className="px-2.5 py-1 rounded border text-[11px] font-semibold disabled:opacity-50"
                        style={{ borderColor: "#8C3823", color: "#8C3823" }}
                      >
                        {t("odash.today.noShow")}
                      </button>
                    </div>
                  ) : slot.status === "completed" && slot.checked_in_at ? (
                    <span className="text-[11px] font-semibold block" style={{ color: "#1F7A52" }}>
                      {slot.checked_in_by ? t("odash.today.checkedInBy", { time: fmt.time(slot.checked_in_at), by: slot.checked_in_by }) : t("odash.today.checkedIn", { time: fmt.time(slot.checked_in_at) })}
                    </span>
                  ) : slot.status === "no_show" ? (
                    <span className="text-[11px] font-semibold block" style={{ color: "#8C3823" }}>{t("odash.today.noShow")}</span>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>

      {recording ? (
        <RecordPaymentSheet
          bookingId={recording.bookingId}
          playerLabel={recording.playerLabel}
          balanceDue={recording.balanceDue}
          onClose={() => setRecording(null)}
          onRecorded={() => {
            setRecording(null);
            queryClient.invalidateQueries({ queryKey: ["owner-today"] });
          }}
        />
      ) : null}
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-xl p-4" style={{ background: warn ? "#FBF0DD" : "#F4F6F7" }}>
      <p className="text-[11px] font-bold tracking-wider" style={{ color: warn ? "#9C5C0A" : "#8399A1" }}>{label.toUpperCase()}</p>
      <p className="font-mono text-xl font-semibold mt-0.5" style={{ color: warn ? "#9C5C0A" : "#101C21" }}>{value}</p>
    </div>
  );
}

function statusLabel(t: TFunction, status: string): string {
  switch (status) {
    case "held": return t("odash.today.status.held");
    case "available": return t("odash.today.status.available");
    case "blocked": return t("odash.today.status.blocked");
    case "completed": return t("odash.today.status.completed");
    case "no_show": return t("odash.today.status.no_show");
    default: return t("odash.today.status.default");
  }
}

function statusSubtitle(t: TFunction, status: string): string {
  switch (status) {
    case "booked": return t("odash.today.sub.booked");
    case "payment_submitted": return t("odash.today.sub.payment_submitted");
    case "held": return t("odash.today.sub.held");
    case "available": return t("odash.today.sub.available");
    case "blocked": return t("odash.today.sub.blocked");
    case "completed": return t("odash.today.sub.completed");
    case "no_show": return t("odash.today.sub.no_show");
    default: return "";
  }
}
