"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { formatPKR } from "@/lib/format";
import { formatDuration, type Court } from "@court-booking/types";
import { CourtMonthCalendar } from "@/components/booking/court-month-calendar";
import { CourtDayPopup } from "@/components/booking/court-day-popup";

/**
 * Calendar-first venue page (Section 32 Part 4b UPDATE, 2026-09-22 -- replaces the earlier slot-list-first
 * design). Per sport tab, each active court renders its own always-visible month calendar (no page-level week
 * strip anymore, and no "View calendar" button -- the calendar IS the default view). Tapping a date opens a
 * popup scoped to that one court.
 */
export function VenueScheduleClient({
  venueId,
  venueName,
  sports,
  courts,
}: {
  venueId: string;
  venueName: string;
  sports: string[];
  courts: Court[];
}) {
  const searchParams = useSearchParams();
  const sportParam = searchParams.get("sport");
  const [sport, setSport] = useState<string | undefined>(undefined);
  const [prices, setPrices] = useState<Record<string, number | null>>({});
  const [popup, setPopup] = useState<{ courtId: string; courtName: string; slotMinutes: number; date: string } | null>(null);

  // Default sport: the one the player arrived from (?sport=, if this venue actually offers it), else the
  // venue's first sport. Computed at render time, not stored via an effect, so an explicit tab click (which
  // sets `sport`) always wins and nothing needs to "undo" the default.
  const activeSport = sport ?? (sportParam && sports.includes(sportParam) ? sportParam : sports[0]);
  const activeCourts = courts.filter((c) => c.sport === activeSport);

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-bold tracking-tight">Availability</h2>

      {sports.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {sports.map((s) => (
            <button
              key={s}
              onClick={() => setSport(s)}
              className="shrink-0 px-4 py-2.5 rounded-full text-[13.5px] font-semibold"
              style={{ background: activeSport === s ? "#141A1D" : "#FFFFFF", border: activeSport === s ? "none" : "1px solid #EBE5E1", color: activeSport === s ? "#FFFFFF" : "#5C544D" }}
            >
              {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      ) : null}

      {activeCourts.length === 0 ? (
        <p className="text-center py-10 text-player-ink-faint text-sm">No active courts for this sport yet.</p>
      ) : (
        <div className={`grid gap-4 ${activeCourts.length > 1 ? "md:grid-cols-2" : ""}`}>
          {activeCourts.map((court) => {
            const price = prices[court.id];
            return (
              <section key={court.id} className="bg-player-surface border border-player-border-light rounded-2xl p-4 flex flex-col gap-3.5" data-testid={`court-card-${court.name}`}>
                <div className="flex flex-col items-center gap-0.5 rounded-xl px-4 py-3" style={{ background: "#F3EEE9" }}>
                  <h3 className="text-[15px] font-bold text-player-ink">{court.name}</h3>
                  <span className="text-[12.5px] font-medium text-player-ink-faint">
                    {formatDuration(court.slot_minutes)} slots{price != null ? ` · From PKR ${formatPKR(price)}` : ""}
                  </span>
                </div>
                <CourtMonthCalendar
                  courtId={court.id}
                  onSummary={(s) => setPrices((p) => ({ ...p, [court.id]: s.starts_from_price }))}
                  onSelectDate={(date) => setPopup({ courtId: court.id, courtName: court.name, slotMinutes: court.slot_minutes, date })}
                />
              </section>
            );
          })}
        </div>
      )}

      {popup ? (
        <CourtDayPopup
          courtId={popup.courtId}
          courtName={popup.courtName}
          slotMinutes={popup.slotMinutes}
          venueId={venueId}
          venueName={venueName}
          initialDate={popup.date}
          onClose={() => setPopup(null)}
        />
      ) : null}
    </div>
  );
}
