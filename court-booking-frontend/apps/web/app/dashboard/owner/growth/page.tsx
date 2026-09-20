"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ApiError } from "@court-booking/api-client";
import { ErrorState } from "@/components/error-state";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useOwnerVenues } from "@/lib/use-owner-venues";

const WEEKDAYS = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];

function formatHourRange(hour: number): string {
  const pad = (h: number) => String(h % 24).padStart(2, "0");
  return `${pad(hour)}:00–${pad(hour + 1)}:00`;
}

export default function OwnerGrowthPage() {
  const { venues, activeVenue, activeVenueId, setVenueId, showSwitcher, isLoading: venuesLoading } = useOwnerVenues();

  const query = useQuery({
    queryKey: ["owner-growth", activeVenueId],
    queryFn: () => api.owners.growth(activeVenueId),
    enabled: !!activeVenueId,
    retry: false,
  });

  const ineligible = query.error instanceof ApiError && query.error.status === 403;
  const suggestions = query.data?.underbooked_slots ?? [];

  return (
    <div className="p-8 max-w-3xl flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Fill your empty slots</h1>
        <p className="text-owner-ink-faint text-sm">Based on your venue's booking history</p>
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

      {venuesLoading || query.isLoading ? (
        <p className="text-owner-ink-faint">Loading…</p>
      ) : ineligible ? (
        <div className="bg-owner-surface border border-owner-border rounded-xl p-10 flex flex-col items-center gap-3 text-center">
          <div className="w-11 h-11 rounded-full flex items-center justify-center" style={{ background: "#FBF0DD" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9C5C0A" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4-6.2-4.6-6.2 4.6 2.4-7.4L2 9.4h7.6z" />
            </svg>
          </div>
          <p className="font-bold">Growth insights are a Pro feature</p>
          <p className="text-owner-ink-faint text-sm max-w-sm">
            Upgrade {activeVenue?.name ?? "this venue"} to Pro or Business to see which slots are underbooked and get
            pricing suggestions to fill them.
          </p>
        </div>
      ) : query.isError ? (
        <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} tone="owner" />
      ) : suggestions.length === 0 ? (
        <div className="bg-owner-surface border border-owner-border rounded-xl p-10 text-center text-owner-ink-faint">
          Check back in a few weeks — we need a bit more booking history at this venue before we can suggest anything
          useful.
        </div>
      ) : (
        <div className="flex flex-col gap-3.5">
          {suggestions.map((s) => {
            const courtName = activeVenue?.courts.find((c) => c.id === s.court_id)?.name ?? "Court";
            return (
              <div key={`${s.court_id}-${s.day_of_week}-${s.hour}`} className="bg-owner-surface border border-owner-border rounded-xl p-5 flex flex-col gap-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: "#FBF0DD" }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9C5C0A" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 17l6-6 4 4 8-8" />
                      <path d="M17 7h4v4" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-bold text-[15px]">
                      {WEEKDAYS[s.day_of_week] ?? "This slot"} {formatHourRange(s.hour)}
                    </p>
                    <p className="text-owner-ink-muted text-sm mt-0.5">
                      {courtName} · {s.suggestion}
                    </p>
                  </div>
                </div>

                <div className="flex gap-8">
                  <ComparisonBar label="THIS SLOT" fraction={s.booking_rate} color="#9C5C0A" />
                  <ComparisonBar label="VENUE AVG" fraction={s.venue_average} color="#5B7079" />
                </div>

                <p className="text-owner-ink-fainter text-xs">
                  Based on {s.weeks_of_data} week{s.weeks_of_data === 1 ? "" : "s"} of data
                </p>
              </div>
            );
          })}

          <p className="text-owner-ink-faint text-xs flex items-center gap-2 px-1">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9C5C0A" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4-6.2-4.6-6.2 4.6 2.4-7.4L2 9.4h7.6z" />
            </svg>
            These insights come with your Pro plan
          </p>
        </div>
      )}
    </div>
  );
}

function ComparisonBar({ label, fraction, color }: { label: string; fraction: number; color: string }) {
  return (
    <div className="flex flex-col gap-1.5 w-32">
      <span className="text-[10px] font-bold tracking-wider text-owner-ink-faint">{label}</span>
      <div className="h-1.5 rounded-full" style={{ background: "#EDF1F2" }}>
        <div className="h-full rounded-full" style={{ width: `${Math.max(4, Math.round(fraction * 100))}%`, background: color }} />
      </div>
      <span className="font-mono text-sm font-semibold">{Math.round(fraction * 100)}%</span>
    </div>
  );
}
