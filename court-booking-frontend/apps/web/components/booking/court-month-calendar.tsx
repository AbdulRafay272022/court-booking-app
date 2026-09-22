"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { addMonths, daysOfMonth, formatMonth, mondayFirstWeekdayOf, monthOf, pktDateString } from "@court-booking/types";
import type { CourtMonthSummary, DaySummaryState } from "@court-booking/types";

import { api } from "@/lib/api";

const WEEKDAY_HEADERS = ["M", "T", "W", "T", "F", "S", "S"];

// green = open, amber = almost full, red = fully booked; closed gets a hollow ring instead of a filled dot.
const DOT_COLOR: Partial<Record<DaySummaryState, string>> = {
  open: "#1F7A52",
  few: "#B5730B",
  full: "#B3261E",
};

/**
 * A single court's month calendar (Section 32 Part 4b): every day of the shown month gets a dot for its
 * availability state. Each instance owns its own month/navigation state -- courts do not share a page-level
 * week strip or month anymore. Reused both inline on the venue page (the default view) and inside the day
 * popup's "back to month" view.
 */
export function CourtMonthCalendar({
  courtId,
  onSelectDate,
  onSummary,
}: {
  courtId: string;
  onSelectDate: (date: string) => void;
  onSummary?: (summary: CourtMonthSummary) => void;
}) {
  const todayMonth = useMemo(() => monthOf(pktDateString()), []);
  const [month, setMonth] = useState(todayMonth);

  const summaryQuery = useQuery({
    queryKey: ["court-month-summary", courtId, month],
    queryFn: async () => {
      const summary = await api.availability.monthSummary(courtId, month);
      onSummary?.(summary);
      return summary;
    },
  });
  const summary = summaryQuery.data;
  const dayByDate = new Map((summary?.days ?? []).map((d) => [d.date, d]));
  const dates = daysOfMonth(month);
  const leadingBlanks = mondayFirstWeekdayOf(dates[0]);
  const today = pktDateString();

  const prevDisabled = month <= todayMonth;
  const nextDisabled = summary ? addMonths(month, 1) > monthOf(summary.last_bookable_date) : true;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <button
          type="button"
          disabled={prevDisabled}
          onClick={() => setMonth((m) => addMonths(m, -1))}
          aria-label="Previous month"
          className="w-9 h-9 rounded-lg flex items-center justify-center font-bold text-[16px]"
          style={{ background: "#F4EFEC", opacity: prevDisabled ? 0.3 : 1, cursor: prevDisabled ? "default" : "pointer" }}
        >
          ‹
        </button>
        <span className="font-bold text-[13.5px] text-player-ink">{formatMonth(month)}</span>
        <button
          type="button"
          disabled={nextDisabled}
          onClick={() => setMonth((m) => addMonths(m, 1))}
          aria-label="Next month"
          className="w-9 h-9 rounded-lg flex items-center justify-center font-bold text-[16px]"
          style={{ background: "#F4EFEC", opacity: nextDisabled ? 0.3 : 1, cursor: nextDisabled ? "default" : "pointer" }}
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-7">
        {WEEKDAY_HEADERS.map((h, i) => (
          <span key={i} className="text-center font-semibold text-[10.5px] text-player-ink-fainter">
            {h}
          </span>
        ))}
      </div>

      {summaryQuery.isLoading ? (
        <p className="py-8 text-center text-player-ink-faint text-sm">Loading…</p>
      ) : (
        <div className="grid grid-cols-7">
          {Array.from({ length: leadingBlanks }).map((_, i) => (
            <div key={`b${i}`} />
          ))}
          {dates.map((date) => {
            const day = dayByDate.get(date);
            const state = day?.state ?? "closed";
            const tappable = state !== "past" && state !== "beyond";
            const isToday = date === today;
            const dotColor = DOT_COLOR[state];
            return (
              <button
                key={date}
                type="button"
                disabled={!tappable}
                onClick={() => onSelectDate(date)}
                aria-label={date}
                className="aspect-square flex flex-col items-center justify-center gap-1"
                style={{ cursor: tappable ? "pointer" : "default" }}
              >
                <span
                  className="w-7 h-7 rounded-full flex items-center justify-center font-mono text-[12.5px] font-semibold"
                  style={{
                    background: isToday ? "#141A1D" : "transparent",
                    color: isToday ? "#FFFFFF" : tappable ? "#141A1D" : "#C2BAB2",
                  }}
                >
                  {Number(date.slice(8))}
                </span>
                {dotColor ? (
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: dotColor }} />
                ) : state === "closed" ? (
                  <span className="w-1.5 h-1.5 rounded-full" style={{ border: "1px solid #C9C2BC" }} />
                ) : (
                  <span className="w-1.5 h-1.5" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
