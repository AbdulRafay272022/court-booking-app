"use client";

import { useEffect, useId, useRef, useState } from "react";
import { addMonths, daysOfMonth, mondayFirstWeekdayOf, monthOf } from "@court-booking/types";

import { useFmt } from "@/lib/use-fmt";
import { useT } from "@/components/i18n/lang-provider";
import type { MessageKey } from "@/lib/i18n";
import { PRESET_KEYS, detectPreset, presetRange, type DateRange, type PresetKey } from "./filters";

/** Date range with presets (Aaj, Kal, Is hafte, Is mahine) and a custom range picker. No native date input anywhere. */
export function DateFilter({ range, today, onChange }: { range: DateRange; today: string; onChange: (next: DateRange) => void }) {
  const t = useT();
  const fmt = useFmt();
  const active = detectPreset(range, today);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const customRef = useRef<HTMLButtonElement>(null);
  const labelId = useId();

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const rangeText = range.from === range.to ? fmt.dateString(range.from) : `${fmt.dateString(range.from)} - ${fmt.dateString(range.to)}`;

  return (
    <div
      ref={rootRef}
      className="relative flex min-w-0 flex-col gap-1.5"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
          customRef.current?.focus();
        }
      }}
    >
      <span id={labelId} className="text-[13px] font-bold text-owner-ink">
        {t("hist.f.date")}
      </span>
      <div role="group" aria-labelledby={labelId} className="flex flex-wrap gap-2">
        {PRESET_KEYS.map((key) => {
          const isCustom = key === "custom";
          return (
            <button
              key={key}
              ref={isCustom ? customRef : undefined}
              type="button"
              aria-pressed={active === key}
              aria-expanded={isCustom ? open : undefined}
              onClick={() => {
                if (isCustom) setOpen((o) => !o);
                else {
                  setOpen(false);
                  onChange(presetRange(key as Exclude<PresetKey, "custom">, today));
                }
              }}
              className={`min-h-11 whitespace-nowrap rounded-xl border px-4 text-[14px] font-bold ${
                active === key ? "border-owner-accent bg-owner-accent text-white" : "border-owner-border bg-owner-surface text-owner-ink"
              }`}
            >
              {t(`hist.preset.${key}` as MessageKey)}
            </button>
          );
        })}
      </div>
      <p className="text-[13px] text-owner-ink-muted" data-testid="range-text">
        {rangeText}
      </p>
      {open ? (
        <RangePopover
          range={range}
          today={today}
          onCancel={() => {
            setOpen(false);
            customRef.current?.focus();
          }}
          onApply={(r) => {
            setOpen(false);
            onChange(r);
            customRef.current?.focus();
          }}
        />
      ) : null}
    </div>
  );
}

function RangePopover({ range, today, onApply, onCancel }: { range: DateRange; today: string; onApply: (r: DateRange) => void; onCancel: () => void }) {
  const t = useT();
  const fmt = useFmt();
  const [month, setMonth] = useState(monthOf(range.from));
  const [start, setStart] = useState<string | null>(range.from);
  const [end, setEnd] = useState<string | null>(range.to);
  const popRef = useRef<HTMLDivElement>(null);
  const headId = useId();

  useEffect(() => {
    popRef.current?.focus();
  }, []);

  const days = daysOfMonth(month);
  const lead = mondayFirstWeekdayOf(days[0]);

  function pick(d: string) {
    if (!start || end) {
      setStart(d);
      setEnd(null);
    } else if (d < start) {
      setEnd(start);
      setStart(d);
    } else {
      setEnd(d);
    }
  }

  const lo = start;
  const hi = end ?? start;

  return (
    <div
      ref={popRef}
      role="dialog"
      aria-label={t("hist.range.title")}
      tabIndex={-1}
      className="absolute left-0 top-full z-30 mt-2 w-[19.5rem] max-w-[calc(100vw-2rem)] rounded-2xl border border-owner-border bg-owner-surface p-3 shadow-xl outline-none"
    >
      <div className="flex items-center justify-between gap-2">
        <button type="button" aria-label={t("hist.range.prev")} onClick={() => setMonth((m) => addMonths(m, -1))} className="flex h-11 w-11 items-center justify-center rounded-xl border border-owner-border text-owner-ink">
          <svg width="14" height="14" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M8 2L4 6l4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <h3 id={headId} aria-live="polite" className="text-[15px] font-bold text-owner-ink">
          {fmt.month(month)}
        </h3>
        <button type="button" aria-label={t("hist.range.next")} onClick={() => setMonth((m) => addMonths(m, 1))} className="flex h-11 w-11 items-center justify-center rounded-xl border border-owner-border text-owner-ink">
          <svg width="14" height="14" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="mt-2 grid grid-cols-7 text-center text-[10.5px] font-bold text-owner-ink-muted" aria-hidden="true">
        {Array.from({ length: 7 }, (_, i) => (
          <span key={i} className="py-1">
            {fmt.weekday(i, "short")}
          </span>
        ))}
      </div>
      <div role="group" aria-labelledby={headId} className="grid grid-cols-7">
        {Array.from({ length: lead }, (_, i) => (
          <span key={`b${i}`} />
        ))}
        {days.map((d) => {
          const isEdge = d === lo || d === hi;
          const inRange = !!lo && !!hi && d >= lo && d <= hi;
          return (
            <button
              key={d}
              type="button"
              aria-pressed={isEdge}
              aria-label={fmt.dateString(d)}
              aria-current={d === today ? "date" : undefined}
              onClick={() => pick(d)}
              className={`h-11 text-[14px] font-semibold ${
                isEdge ? "rounded-xl bg-owner-accent text-white" : inRange ? "bg-owner-accent-soft text-owner-ink" : "rounded-xl text-owner-ink"
              } ${d === today && !isEdge ? "underline underline-offset-4" : ""}`}
            >
              {Number(d.slice(8))}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[12.5px] text-owner-ink-muted" role="status">
        {!start ? t("hist.range.pickStart") : !end ? t("hist.range.pickEnd") : ""}
      </p>
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="min-h-11 rounded-xl border border-owner-border px-4 text-[14px] font-bold text-owner-ink">
          {t("hist.range.cancel")}
        </button>
        <button
          type="button"
          disabled={!start}
          onClick={() => start && onApply({ from: start, to: end ?? start })}
          className="min-h-11 rounded-xl bg-khelo-orange px-5 text-[14px] font-bold text-khelo-ink disabled:opacity-50"
        >
          {t("hist.range.apply")}
        </button>
      </div>
    </div>
  );
}
