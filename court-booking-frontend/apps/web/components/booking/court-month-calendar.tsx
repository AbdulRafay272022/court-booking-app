"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { addMonths, daysOfMonth, mondayFirstWeekdayOf, monthOf, pktDateString } from "@court-booking/types";
import type { CourtMonthSummary, DaySummaryState } from "@court-booking/types";

import { api } from "@/lib/api";
import { useT } from "@/components/i18n/lang-provider";
import { useFmt } from "@/lib/use-fmt";
import type { MessageKey } from "@/lib/i18n";

// Day-state colours come from the Khelo tokens: available = mint, filling up = warning, fully booked = the grey of a booked slot.
// A soft tint fills the whole cell; a dot beneath the number carries the state.
const CELL_CLASS: Partial<Record<DaySummaryState, string>> = {
  open: "bg-khelo-success-bg text-khelo-ink",
  few: "bg-khelo-warning-bg text-khelo-ink",
  full: "bg-khelo-booked-bg text-khelo-muted",
};
const DOT_CLASS: Partial<Record<DaySummaryState, string>> = { open: "bg-khelo-success-text", few: "bg-khelo-warning-text", full: "bg-khelo-muted-3" };
// Diagonal hatch for a court with no schedule set: reads as "not set up", not "broken".
const HATCH = "repeating-linear-gradient(135deg, var(--color-khelo-page), var(--color-khelo-page) 4px, var(--color-khelo-divider) 4px, var(--color-khelo-divider) 8px)";
const HATCH_LEGEND = "repeating-linear-gradient(135deg, var(--color-khelo-page), var(--color-khelo-page) 2px, var(--color-khelo-dash) 2px, var(--color-khelo-dash) 4px)";

const LEGEND: { state: DaySummaryState; label: MessageKey }[] = [
  { state: "open", label: "venue.cal.legend.open" },
  { state: "few", label: "venue.cal.legend.few" },
  { state: "full", label: "venue.cal.legend.full" },
  { state: "closed", label: "venue.cal.legend.closed" },
];

// What a screen reader hears for a day cell.
const STATE_LABEL: Record<DaySummaryState, MessageKey> = {
  open: "venue.cal.state.open",
  few: "venue.cal.state.few",
  full: "venue.cal.state.full",
  closed: "venue.cal.state.closed",
  past: "venue.cal.state.past",
  beyond: "venue.cal.state.beyond",
};

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
  const t = useT();
  const fmt = useFmt();
  const weekdayHeaders = t("venue.cal.weekdays").split(",");
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
        <span className="font-khelo-display text-[17px] font-extrabold tracking-tight text-khelo-ink">{fmt.month(month)}</span>
        <NavButton dir="next" disabled={nextDisabled} onClick={() => setMonth((m) => addMonths(m, 1))} />
      </div>

      <div className="grid grid-cols-7 gap-0.5 mb-0.5" aria-hidden="true">
        {weekdayHeaders.map((h, i) => (
          <span
            key={i}
            className="mx-auto flex h-5 w-6 items-center justify-center rounded-md bg-khelo-page text-[11px] font-bold text-khelo-muted-2"
          >
            {h}
          </span>
        ))}
      </div>

      {summaryQuery.isLoading ? (
        <p className="py-10 text-center text-khelo-muted-2 text-sm">{t("venue.cal.loading")}</p>
      ) : (
        <>
          <div className="grid grid-cols-7 gap-0.5">
            {Array.from({ length: leadingBlanks }).map((_, i) => (
              <div key={`b${i}`} />
            ))}
            {dates.map((date) => {
              const state = dayByDate.get(date)?.state ?? "closed";
              const isPast = state === "past" || state === "beyond";
              const isNoHours = noHours && !isPast;
              const tappable = !isPast && !isNoHours;
              const isToday = date === today;
              const dotClass = DOT_CLASS[state];
              const num = Number(date.slice(8));
              return (
                <button
                  key={date}
                  type="button"
                  disabled={!tappable}
                  onClick={() => onSelectDate(date)}
                  aria-label={t("venue.cal.dayLabel", { date, state: isNoHours ? t("venue.cal.state.noHours") : t(STATE_LABEL[state]) })}
                  className={`khelo-btn flex min-h-11 flex-col items-center justify-center gap-[3px] rounded-xl border-2 text-[13px] font-bold ${
                    isToday ? "border-khelo-orange" : "border-transparent"
                  } ${isNoHours || isPast ? "text-khelo-muted-2" : CELL_CLASS[state] ?? "text-khelo-ink"} ${isPast ? "opacity-50" : ""} ${
                    tappable ? "cursor-pointer" : "cursor-default hover:transform-none! hover:shadow-none!"
                  }`}
                  style={isNoHours ? { backgroundImage: HATCH } : undefined}
                >
                  <span>{num}</span>
                  {isNoHours ? (
                    // no-hours cells carry the hatch only — no dot or dash under the number
                    <span className="w-1.5 h-1.5" aria-hidden />
                  ) : isPast ? (
                    <span className="w-1.5 h-1.5" aria-hidden />
                  ) : dotClass ? (
                    <span className={`w-1.5 h-1.5 rounded-full ${dotClass}`} aria-hidden />
                  ) : state === "closed" ? (
                    <span className="w-1.5 h-1.5 rounded-full border-[1.5px] border-khelo-dash" aria-hidden />
                  ) : (
                    <span className="w-1.5 h-1.5" aria-hidden />
                  )}
                </button>
              );
            })}
          </div>

          {noHours ? (
            <>
              <div className="mt-4 flex flex-wrap gap-3.5 border-t border-dashed border-khelo-border pt-3.5">
                <LegendItem label={t("venue.cal.noHours")}>
                  <span className="h-2 w-2 rounded-full border border-khelo-dash" style={{ backgroundImage: HATCH_LEGEND }} />
                </LegendItem>
              </div>
              <div
                className="mt-4 rounded-2xl border border-khelo-warm bg-khelo-warm-2 px-4 py-3.5 text-[13.5px] text-khelo-orange-label"
                role="status"
              >
                {t("venue.cal.noHoursNote")}
              </div>
            </>
          ) : (
            <div className="mt-4 flex flex-wrap gap-3.5 border-t border-dashed border-khelo-border pt-3.5">
              {LEGEND.map(({ state, label }) => (
                <LegendItem key={state} label={t(label)}>
                  {state === "closed" ? (
                    <span className="h-2 w-2 rounded-full border-[1.5px] border-khelo-dash" />
                  ) : (
                    <span className={`h-2 w-2 rounded-full ${DOT_CLASS[state]}`} />
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
    <span className="flex items-center gap-1.5 text-[12px] font-semibold text-khelo-muted-2">
      {children}
      {label}
    </span>
  );
}

function NavButton({ dir, disabled, onClick }: { dir: "prev" | "next"; disabled: boolean; onClick: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={dir === "prev" ? t("venue.cal.prev") : t("venue.cal.next")}
      className={`khelo-btn flex h-11 w-11 items-center justify-center rounded-full border border-khelo-border bg-khelo-surface text-[18px] text-khelo-ink ${
        disabled ? "cursor-default opacity-40 hover:transform-none! hover:shadow-none!" : "cursor-pointer"
      }`}
    >
      {dir === "prev" ? "‹" : "›"}
    </button>
  );
}
