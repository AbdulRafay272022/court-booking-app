"use client";

import { useId, useState } from "react";
import { addDays, addMonths, daysOfMonth, mondayFirstWeekdayOf, monthOf } from "@court-booking/types";
import { useT } from "@/components/i18n/lang-provider";
import { useFmt } from "@/lib/use-fmt";
import { Popover } from "./overlay";

export function Chevron() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/**
 * The Overview's single-date select: a button that opens a panel with the Today / Tomorrow presets and a month calendar
 * (any past or future day). Built by hand because the repo bans native date inputs (they print machine-locale dates).
 */
export function DateSelect({ date, today, onChange }: { date: string; today: string; onChange: (date: string) => void }) {
  const t = useT();
  const fmt = useFmt();
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(monthOf(date));
  const labelId = useId();
  const valueId = useId();
  const tomorrow = addDays(today, 1);

  const days = daysOfMonth(month);
  const lead = mondayFirstWeekdayOf(days[0]);

  function pick(next: string) {
    onChange(next);
    setOpen(false);
  }

  return (
    <div className="relative min-w-0">
      <span id={labelId} className="block text-xs font-semibold text-khelo-muted mb-1.5">
        {t("ovw.filters.date")}
      </span>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-labelledby={`${labelId} ${valueId}`}
        data-testid="ovw-date-trigger"
        onClick={() => {
          setMonth(monthOf(date));
          setOpen((o) => !o);
        }}
        className="h-11 w-full min-w-[15rem] flex items-center justify-between gap-3 px-4 rounded-xl border-[1.5px] border-khelo-border bg-khelo-surface text-khelo-ink font-semibold text-[15px] whitespace-nowrap"
      >
        <span id={valueId}>
          {fmt.dateString(date)}
          {date === today ? ` ${t("ovw.filters.todaySuffix")}` : ""}
        </span>
        <Chevron />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} title={t("ovw.filters.pickDate")} width="w-[22rem]" testId="ovw-date-panel">
        <div className="flex gap-2 mb-3">
          {[
            { value: today, label: t("ovw.filters.today") },
            { value: tomorrow, label: t("ovw.filters.tomorrow") },
          ].map((p) => (
            <button
              key={p.value}
              type="button"
              aria-pressed={date === p.value}
              onClick={() => pick(p.value)}
              className={`h-11 px-4 rounded-full text-sm font-bold border-[1.5px] whitespace-nowrap ${
                date === p.value ? "bg-khelo-ink text-white border-khelo-ink" : "bg-khelo-surface text-khelo-ink border-khelo-border"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between mb-2">
          <button
            type="button"
            aria-label={t("ovw.filters.prevMonth")}
            onClick={() => setMonth(addMonths(month, -1))}
            className="w-11 h-11 rounded-full flex items-center justify-center text-khelo-ink hover:bg-khelo-page"
          >
            <span aria-hidden="true" className="rotate-90 inline-flex">
              <Chevron />
            </span>
          </button>
          <p className="font-bold text-sm text-khelo-ink" aria-live="polite">
            {fmt.month(month)}
          </p>
          <button
            type="button"
            aria-label={t("ovw.filters.nextMonth")}
            onClick={() => setMonth(addMonths(month, 1))}
            className="w-11 h-11 rounded-full flex items-center justify-center text-khelo-ink hover:bg-khelo-page"
          >
            <span aria-hidden="true" className="-rotate-90 inline-flex">
              <Chevron />
            </span>
          </button>
        </div>
        <div className="grid grid-cols-7 text-center text-[11px] font-bold text-khelo-muted mb-1" aria-hidden="true">
          {Array.from({ length: 7 }, (_, i) => (
            <span key={i}>{fmt.weekday(i, "short")}</span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-y-1">
          {Array.from({ length: lead }, (_, i) => (
            <span key={`lead-${i}`} />
          ))}
          {days.map((d) => {
            const selected = d === date;
            return (
              <button
                key={d}
                type="button"
                aria-label={fmt.dateString(d)}
                aria-pressed={selected}
                aria-current={d === today ? "date" : undefined}
                onClick={() => pick(d)}
                className={`h-11 w-full rounded-xl text-sm font-semibold ${
                  selected
                    ? "bg-khelo-ink text-white"
                    : d === today
                      ? "border-[1.5px] border-khelo-teal text-khelo-ink"
                      : "text-khelo-ink hover:bg-khelo-page"
                }`}
              >
                {Number(d.slice(8))}
              </button>
            );
          })}
        </div>
      </Popover>
    </div>
  );
}
