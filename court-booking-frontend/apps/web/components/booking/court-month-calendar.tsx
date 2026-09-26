"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { addMonths, daysOfMonth, formatMonth, mondayFirstWeekdayOf, monthOf, pktDateString } from "@court-booking/types";
import type { CourtMonthSummary, DaySummaryState } from "@court-booking/types";

import { api } from "@/lib/api";

const WEEKDAY_HEADERS = ["M", "T", "W", "T", "F", "S", "S"];

// Palette from the approved mockup (calendar-redesign-mockup.html). Day-state colours are calendar-only tokens.
const OPEN = "#1E9E5A";
const LIMITED = "#D6900A";
const FULL = "#C43A3A";
const CLOSED_RING = "#B9B2AA";
const NOHOURS_INK = "#9A9791";
const ACCENT = "#EF5A2C";
// A soft tint fills the whole cell; a dot beneath the number carries the same colour.
const CELL_BG: Partial<Record<DaySummaryState, string>> = { open: "#E3F7EB", few: "#FBEED9", full: "#FBE6E6" };
const DOT_COLOR: Partial<Record<DaySummaryState, string>> = { open: OPEN, few: LIMITED, full: FULL };
// Diagonal hatch for a court with no schedule set — reads as "not set up", not "broken".
const HATCH = "repeating-linear-gradient(135deg, #F3EEE9, #F3EEE9 4px, #EDE7E1 4px, #EDE7E1 8px)";
const HATCH_LEGEND = "repeating-linear-gradient(135deg, #F3EEE9, #F3EEE9 2px, #cfc7bd 2px, #cfc7bd 4px)";

const LEGEND: { state: DaySummaryState; label: string }[] = [
  { state: "open", label: "Open" },
  { state: "few", label: "Filling up" },
  { state: "full", label: "Fully booked" },
  { state: "closed", label: "Closed that day" },
];

/**
 * A single court's month calendar (Section 32 Part 4b; visual redesign post-batch #5, matching the owner's
 * approved mockup): each day is a soft-tinted cell with a state dot, "closed" is a hollow ring, and a court with
 * no schedule shows a diagonal-hatch state plus a plain-language callout instead of a grid that looks broken.
 * The calendar-first interaction is unchanged. Each instance owns its own month/navigation state.
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

  // A court with no active schedule returns every future day as "closed"; render the whole month as the
  // hatched "no hours set" state (not per-day hollow rings, which read as broken) plus a callout.
  const hasBookable = (summary?.days ?? []).some((d) => d.state === "open" || d.state === "few" || d.state === "full");
  const noHours = !!summary && !hasBookable;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between">
        <NavButton dir="prev" disabled={prevDisabled} onClick={() => setMonth((m) => addMonths(m, -1))} />
        <span className="text-[16px] font-extrabold tracking-tight text-player-ink">{formatMonth(month)}</span>
        <NavButton dir="next" disabled={nextDisabled} onClick={() => setMonth((m) => addMonths(m, 1))} />
      </div>

      <div className="grid grid-cols-7">
        {WEEKDAY_HEADERS.map((h, i) => (
          <span key={i} className="text-center font-bold text-[10px] tracking-wide text-player-ink-fainter pt-0.5 pb-2">
            {h}
          </span>
        ))}
      </div>

      {summaryQuery.isLoading ? (
        <p className="py-10 text-center text-player-ink-faint text-sm">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: leadingBlanks }).map((_, i) => (
              <div key={`b${i}`} />
            ))}
            {dates.map((date) => {
              const state = dayByDate.get(date)?.state ?? "closed";
              const isPast = state === "past" || state === "beyond";
              const isNoHours = noHours && !isPast;
              const tappable = !isPast && !isNoHours;
              const isToday = date === today;
              const dotColor = DOT_COLOR[state];
              const num = Number(date.slice(8));
              return (
                <button
                  key={date}
                  type="button"
                  disabled={!tappable}
                  onClick={() => onSelectDate(date)}
                  aria-label={`${date}, ${isNoHours ? "no hours set" : state}`}
                  className={`aspect-square rounded-[10px] flex flex-col items-center justify-center gap-[3px] text-[12.5px] font-semibold transition-transform ${
                    tappable ? "cursor-pointer hover:-translate-y-px" : "cursor-default"
                  }`}
                  style={{
                    background: isNoHours ? HATCH : CELL_BG[state] ?? "transparent",
                    color: isPast ? NOHOURS_INK : isNoHours ? NOHOURS_INK : "#141A1D",
                    opacity: isPast ? 0.45 : 1,
                    border: `2px solid ${isToday ? ACCENT : "transparent"}`,
                  }}
                >
                  <span>{num}</span>
                  {isNoHours ? (
                    // no-hours cells carry the hatch only — no dot or dash under the number
                    <span className="w-1.5 h-1.5" aria-hidden />
                  ) : isPast ? (
                    <span className="w-1.5 h-1.5" aria-hidden />
                  ) : dotColor ? (
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: dotColor }} aria-hidden />
                  ) : state === "closed" ? (
                    <span className="w-1.5 h-1.5 rounded-full" style={{ border: `1.5px solid ${CLOSED_RING}` }} aria-hidden />
                  ) : (
                    <span className="w-1.5 h-1.5" aria-hidden />
                  )}
                </button>
              );
            })}
          </div>

          {noHours ? (
            <>
              <div className="flex flex-wrap gap-3.5 mt-4 pt-3.5" style={{ borderTop: "1px dashed #E5DED8" }}>
                <LegendItem label="No hours set for this court">
                  <span className="w-2 h-2 rounded-full" style={{ background: HATCH_LEGEND, border: `1px solid ${NOHOURS_INK}` }} />
                </LegendItem>
              </div>
              <div
                className="rounded-xl px-4 py-3.5 mt-4 text-[13.5px]"
                style={{ background: "#FDECE5", border: "1px solid #f3cdb9", color: "#8a3417" }}
                role="status"
              >
                This court hasn't set its opening hours yet — check back soon or message the venue.
              </div>
            </>
          ) : (
            <div className="flex flex-wrap gap-3.5 mt-4 pt-3.5" style={{ borderTop: "1px dashed #E5DED8" }}>
              {LEGEND.map(({ state, label }) => (
                <LegendItem key={state} label={label}>
                  {state === "closed" ? (
                    <span className="w-2 h-2 rounded-full" style={{ border: `1.5px solid ${CLOSED_RING}` }} />
                  ) : (
                    <span className="w-2 h-2 rounded-full" style={{ background: DOT_COLOR[state] }} />
                  )}
                </LegendItem>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function LegendItem({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[12px] font-semibold text-player-ink-faint">
      {children}
      {label}
    </span>
  );
}

function NavButton({ dir, disabled, onClick }: { dir: "prev" | "next"; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={dir === "prev" ? "Previous month" : "Next month"}
      className="w-7 h-7 rounded-lg flex items-center justify-center text-[13px] text-player-ink-faint transition-colors hover:bg-[#F3EEE9]"
      style={{ background: "#FFFFFF", border: "1px solid #E5DED8", opacity: disabled ? 0.35 : 1, cursor: disabled ? "default" : "pointer" }}
    >
      {dir === "prev" ? "‹" : "›"}
    </button>
  );
}
