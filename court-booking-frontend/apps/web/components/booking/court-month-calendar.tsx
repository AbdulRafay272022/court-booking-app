"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { addMonths, daysOfMonth, formatMonth, mondayFirstWeekdayOf, monthOf, pktDateString } from "@court-booking/types";
import type { CourtMonthSummary, DaySummaryState } from "@court-booking/types";

import { api } from "@/lib/api";

const WEEKDAY_HEADERS = ["M", "T", "W", "T", "F", "S", "S"];

// Day-state colours. open/few/full are filled dots; closed is a filled grey dot (an intentional "no play this
// day" marker, not the old hollow ring that read as a loading glitch). past/beyond draw no dot at all.
const DOT_COLOR: Partial<Record<DaySummaryState, string>> = {
  open: "#1F7A52",
  few: "#B5730B",
  full: "#B3261E",
  closed: "#CDC6BF",
};

// The legend that makes the dots self-explanatory (post-batch #5).
const LEGEND: { state: DaySummaryState; label: string }[] = [
  { state: "open", label: "Open" },
  { state: "few", label: "Few left" },
  { state: "full", label: "Full" },
  { state: "closed", label: "Closed" },
];

/**
 * A single court's month calendar (Section 32 Part 4b; visual pass post-batch #5): every day of the shown month
 * gets a dot for its availability state, with a legend and a clear empty state when the court has no opening
 * hours yet. Each instance owns its own month/navigation state. Reused inline on the venue page (the default
 * view) and inside the day popup's "back to month" view. The calendar-first interaction is unchanged.
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

  // A court with no active schedule returns every future day as "closed"; there is nothing to book, so we say
  // so plainly rather than filling the grid with markers that look broken.
  const hasBookable = (summary?.days ?? []).some((d) => d.state === "open" || d.state === "few" || d.state === "full");
  const noHours = !!summary && !hasBookable;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <NavButton dir="prev" disabled={prevDisabled} onClick={() => setMonth((m) => addMonths(m, -1))} />
        <span className="font-bold text-[14px] text-player-ink tracking-tight">{formatMonth(month)}</span>
        <NavButton dir="next" disabled={nextDisabled} onClick={() => setMonth((m) => addMonths(m, 1))} />
      </div>

      <div className="grid grid-cols-7">
        {WEEKDAY_HEADERS.map((h, i) => (
          <span key={i} className="text-center font-bold text-[10px] tracking-wide text-player-ink-fainter uppercase pb-1">
            {h}
          </span>
        ))}
      </div>

      {summaryQuery.isLoading ? (
        <p className="py-10 text-center text-player-ink-faint text-sm">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-7 gap-y-0.5">
            {Array.from({ length: leadingBlanks }).map((_, i) => (
              <div key={`b${i}`} />
            ))}
            {dates.map((date) => {
              const state = dayByDate.get(date)?.state ?? "closed";
              const tappable = state !== "past" && state !== "beyond";
              const isToday = date === today;
              const dotColor = DOT_COLOR[state];
              return (
                <button
                  key={date}
                  type="button"
                  disabled={!tappable}
                  onClick={() => onSelectDate(date)}
                  aria-label={`${date}${state ? `, ${state}` : ""}`}
                  className={`group aspect-square flex flex-col items-center justify-center gap-1 rounded-xl transition-colors ${
                    tappable ? "cursor-pointer hover:bg-[#F7F2EE]" : "cursor-default"
                  }`}
                >
                  <span
                    className="w-8 h-8 rounded-full flex items-center justify-center font-mono text-[12.5px] font-semibold transition-colors"
                    style={{
                      background: isToday ? "#141A1D" : "transparent",
                      color: isToday ? "#FFFFFF" : tappable ? "#141A1D" : "#C2BAB2",
                    }}
                  >
                    {Number(date.slice(8))}
                  </span>
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: dotColor ?? "transparent" }}
                    aria-hidden
                  />
                </button>
              );
            })}
          </div>

          {noHours ? (
            <div
              className="mt-1 rounded-xl px-3.5 py-3 flex items-start gap-2.5"
              style={{ background: "#FBF5F1", border: "1px solid #F0E6DE" }}
              role="status"
            >
              <span aria-hidden className="text-[15px] leading-none mt-0.5">🕓</span>
              <p className="text-[12.5px] leading-snug text-player-ink-faint">
                This court hasn’t set its opening hours yet, so there are no times to book here.
              </p>
            </div>
          ) : (
            <div className="mt-0.5 flex flex-wrap gap-x-3.5 gap-y-1.5">
              {LEGEND.map(({ state, label }) => (
                <span key={state} className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: DOT_COLOR[state] }} />
                  <span className="text-[10.5px] font-semibold text-player-ink-fainter">{label}</span>
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function NavButton({ dir, disabled, onClick }: { dir: "prev" | "next"; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={dir === "prev" ? "Previous month" : "Next month"}
      className="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-[16px] text-player-ink transition-colors hover:bg-[#EDE6E0]"
      style={{ background: "#F4EFEC", opacity: disabled ? 0.3 : 1, cursor: disabled ? "default" : "pointer" }}
    >
      {dir === "prev" ? "‹" : "›"}
    </button>
  );
}
