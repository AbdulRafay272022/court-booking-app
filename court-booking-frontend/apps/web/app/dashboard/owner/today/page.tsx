"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ErrorState } from "@/components/error-state";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatDateString, formatPKR, formatTime } from "@/lib/format";
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
  const { venues, activeVenue, activeVenueId, setVenueId, showSwitcher, isLoading: venuesLoading } = useOwnerVenues();
  const [activeCourt, setActiveCourt] = useState<string | "all">("all");
  const [busyBookingId, setBusyBookingId] = useState<string | null>(null);
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
      alert(friendlyErrorMessage(e));
    } finally {
      setBusyBookingId(null);
    }
  }

  async function handleNoShow(bookingId: string) {
    if (!confirm("Mark this booking as a no-show? This records that the player never showed up.")) return;
    setBusyBookingId(bookingId);
    try {
      await api.bookings.noShow(bookingId);
      await queryClient.invalidateQueries({ queryKey: ["owner-today"] });
    } catch (e) {
      alert(friendlyErrorMessage(e));
    } finally {
      setBusyBookingId(null);
    }
  }

  const data = todayQuery.data;
  const courts = data?.courts ?? [];
  const courtId = activeCourt === "all" ? undefined : activeCourt;
  const rows = courts
    .filter((c) => !courtId || c.court_id === courtId)
    .flatMap((c) => c.slots.map((s) => ({ ...s, courtName: c.name })))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  return (
    <div className="p-8 flex flex-col gap-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{activeVenue?.name ?? "Today"}</h1>
          {data ? <p className="text-owner-ink-faint text-sm">{formatDateString(data.date)}</p> : null}
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/owner/checkin" className="px-4 py-2.5 rounded-lg border border-owner-border font-semibold text-sm">
            Check-in tools
          </Link>
          <Link href="/dashboard/owner/walkin" className="px-4 py-2.5 rounded-lg bg-owner-accent text-white font-semibold text-sm">
            + Add booking
          </Link>
        </div>
      </div>

      {showSwitcher ? (
        <div className="flex gap-2">
          {venues.map((v) => (
            <button
              key={v.id}
              onClick={() => setVenueId(v.id)}
              className="px-3 py-1.5 rounded-lg text-[13px] font-semibold"
              style={{ background: v.id === activeVenueId ? "#0E6274" : "#F4F6F7", color: v.id === activeVenueId ? "#fff" : "#5B7079" }}
            >
              {v.name}
            </button>
          ))}
        </div>
      ) : null}

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Booked" value={data ? `${rows.filter((r) => r.status === "booked" || r.status === "payment_submitted").length}/${rows.length}` : "—"} />
        <Stat label="Revenue today" value={data ? formatPKR(data.summary.total_revenue) : "—"} />
        <Link href="/dashboard/owner/approvals">
          <Stat label="Pending" value={data ? String(data.summary.pending_approvals) : "—"} warn />
        </Link>
      </div>

      {courts.length > 1 ? (
        <div className="flex gap-2">
          <button
            onClick={() => setActiveCourt("all")}
            className="px-3.5 py-2 rounded-lg text-[13px] font-semibold"
            style={{ background: activeCourt === "all" ? "#0E6274" : "#F4F6F7", color: activeCourt === "all" ? "#fff" : "#5B7079" }}
          >
            All
          </button>
          {courts.map((c) => (
            <button
              key={c.court_id}
              onClick={() => setActiveCourt(c.court_id)}
              className="px-3.5 py-2 rounded-lg text-[13px] font-semibold"
              style={{ background: activeCourt === c.court_id ? "#0E6274" : "#F4F6F7", color: activeCourt === c.court_id ? "#fff" : "#5B7079" }}
            >
              {c.name}
            </button>
          ))}
        </div>
      ) : null}

      <div className="bg-owner-surface border border-owner-border rounded-xl overflow-hidden">
        {venuesLoading || todayQuery.isLoading ? (
          <p className="p-8 text-center text-owner-ink-faint">Loading…</p>
        ) : todayQuery.isError && !data ? (
          <ErrorState message={friendlyErrorMessage(todayQuery.error)} onRetry={() => todayQuery.refetch()} tone="owner" />
        ) : rows.length === 0 ? (
          <p className="p-8 text-center text-owner-ink-faint">Nothing scheduled.</p>
        ) : (
          rows.map((slot) => (
            <div
              key={`${slot.courtName}-${slot.starts_at}`}
              className="flex items-center gap-4 px-5 py-3.5 border-b border-owner-border-light last:border-0"
              style={{ borderLeft: `3px solid ${STATUS_COLOR[slot.status] ?? "#DCE3E6"}` }}
            >
              <span className="font-mono text-sm font-semibold w-[4.75rem] shrink-0">{formatTime(slot.starts_at)}</span>
              <div className="flex-1">
                <p className="font-semibold text-sm">{activeCourt === "all" ? `${slot.courtName} · ` : ""}{slot.player_name ?? statusLabel(slot.status)}</p>
                <p className="text-xs text-owner-ink-faint">{statusSubtitle(slot.status)}</p>
              </div>
              {slot.status === "payment_submitted" ? (
                <Link href="/dashboard/owner/approvals" className="px-3 py-2 rounded-lg text-white text-xs font-semibold" style={{ background: "#9C5C0A" }}>
                  Review
                </Link>
              ) : slot.amount_paid != null ? (
                <div className="text-right">
                  <span className="font-mono text-sm font-semibold block">PKR {formatPKR(slot.amount_paid)}</span>
                  {slot.status === "booked" && slot.balance_due != null ? (
                    <span className="text-[11px] font-semibold block" style={{ color: slot.balance_due > 0 ? "#9C5C0A" : "#1F7A52" }}>
                      {slot.balance_due > 0 ? `PKR ${formatPKR(slot.balance_due)} due at venue` : "Fully paid"}
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
                        Check in
                      </button>
                      <button
                        disabled={busyBookingId === slot.booking_id}
                        onClick={() => handleNoShow(slot.booking_id as string)}
                        className="px-2.5 py-1 rounded border text-[11px] font-semibold disabled:opacity-50"
                        style={{ borderColor: "#8C3823", color: "#8C3823" }}
                      >
                        No-show
                      </button>
                    </div>
                  ) : slot.status === "completed" && slot.checked_in_at ? (
                    <span className="text-[11px] font-semibold block" style={{ color: "#1F7A52" }}>
                      Checked in {formatTime(slot.checked_in_at)}{slot.checked_in_by ? ` · ${slot.checked_in_by}` : ""}
                    </span>
                  ) : slot.status === "no_show" ? (
                    <span className="text-[11px] font-semibold block" style={{ color: "#8C3823" }}>No-show</span>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
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

function statusLabel(status: string): string {
  switch (status) {
    case "held": return "Held";
    case "available": return "Open";
    case "blocked": return "Closed";
    case "completed": return "Checked in";
    case "no_show": return "No-show";
    default: return "Booking";
  }
}

function statusSubtitle(status: string): string {
  switch (status) {
    case "booked": return "Confirmed booking";
    case "payment_submitted": return "Screenshot waiting for review";
    case "held": return "Player is paying now";
    case "available": return "No booking yet";
    case "blocked": return "Blocked by venue";
    case "completed": return "Player checked in";
    case "no_show": return "Player never checked in";
    default: return "";
  }
}
