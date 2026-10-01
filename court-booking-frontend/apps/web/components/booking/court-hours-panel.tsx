"use client";

import { useQuery } from "@tanstack/react-query";
import { bookingHorizonText, upcomingBlackouts, weeklyHoursLines } from "@court-booking/types";
import type { Court } from "@court-booking/types";

import { api } from "@/lib/api";

/**
 * "When can I book this court?" for the player venue page: the court's weekly booking hours (12-hour Pakistan time,
 * overnight and 24-hour courts spelled out, closed days listed), the booking horizon, and any closed/unavailable
 * periods (blackouts) still ahead. Everything here is already public: the court's schedule comes with the venue,
 * blackouts from GET /courts/{id}/blackouts.
 */
export function CourtHoursPanel({ court, horizonDays }: { court: Court; horizonDays: number | null | undefined }) {
  const blackoutsQuery = useQuery({
    queryKey: ["court-blackouts", court.id],
    queryFn: () => api.courts.listBlackouts(court.id),
    staleTime: 60_000,
  });
  const lines = weeklyHoursLines(court.schedule_templates ?? []);
  const blackouts = upcomingBlackouts(blackoutsQuery.data ?? []);
  const horizon = bookingHorizonText(horizonDays);

  return (
    <div className="rounded-xl border border-player-border-light px-3.5 py-3 flex flex-col gap-2.5" data-testid={`court-hours-${court.name}`}>
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-bold tracking-widest text-player-ink-fainter">BOOKING HOURS</span>
        {lines.map((l) => (
          <p key={l.days} className="flex justify-between gap-3 text-[13px]" data-testid="hours-line">
            <span className="font-semibold text-player-ink-muted">{l.days}</span>
            <span className={l.closed ? "text-player-ink-faint" : "font-mono text-player-ink"}>{l.hours}</span>
          </p>
        ))}
      </div>
      {horizon ? <p className="text-[12.5px] font-medium text-player-ink-faint" data-testid="horizon-text">{horizon}</p> : null}
      {blackouts.length > 0 ? (
        <div className="flex flex-col gap-1" data-testid="blackout-list">
          <span className="text-[11px] font-bold tracking-widest text-player-ink-fainter">CLOSED / UNAVAILABLE</span>
          {blackouts.map((b) => (
            <p key={b.id} className="text-[13px] text-player-ink-muted">
              <span className="font-semibold">{b.label}</span> · {b.when}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
