"use client";

import { useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { courtLabel } from "@/components/court-label";
import { useT } from "@/components/i18n/lang-provider";
import { Chevron } from "./date-select";
import { Popover } from "./overlay";

export interface CourtOption {
  id: string;
  name: string;
  sport?: string | null;
}

function Box({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`w-5 h-5 shrink-0 rounded-md border-[1.5px] flex items-center justify-center ${
        checked ? "bg-fl-teal border-fl-teal text-white" : "bg-fl-white border-fl-line-strong"
      }`}
    >
      {checked ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12l5 5 9-10" />
        </svg>
      ) : null}
    </span>
  );
}

/**
 * Multi-select of courts. `selected` is the list of chosen ids, EMPTY meaning every court (the default and the URL's
 * "no courts param"). The panel is a listbox with checkboxes: Up/Down/Home/End move, Space or Enter toggles.
 */
export function CourtSelect({ courts, selected, onChange }: { courts: CourtOption[]; selected: string[]; onChange: (ids: string[]) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const labelId = useId();
  const valueId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const allSelected = selected.length === 0 || selected.length >= courts.length;
  const isOn = (id: string) => allSelected || selected.includes(id);

  const label = allSelected
    ? t("ovw.filters.allCourts", { n: courts.length })
    : selected.length === 1
      ? (() => {
          const c = courts.find((x) => x.id === selected[0]);
          return c ? courtLabel(c.name, c.sport) : t("ovw.filters.someCourts", { n: 1 });
        })()
      : t("ovw.filters.someCourts", { n: selected.length });

  function toggleCourt(id: string) {
    if (allSelected) {
      onChange([id]); // narrowing down from "all": start with just this court
      return;
    }
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    onChange(next.length === 0 || next.length >= courts.length ? [] : next);
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const opts = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
    const idx = opts.findIndex((o) => o === document.activeElement);
    let to = -1;
    if (e.key === "ArrowDown") to = Math.min(opts.length - 1, idx + 1);
    else if (e.key === "ArrowUp") to = Math.max(0, idx - 1);
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = opts.length - 1;
    else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (idx >= 0) opts[idx].click();
      return;
    } else return;
    e.preventDefault();
    opts[to]?.focus();
  }

  return (
    <div className="relative min-w-0">
      <span id={labelId} className="block text-xs font-semibold text-fl-muted mb-1.5">
        {t("ovw.filters.courts")}
      </span>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${labelId} ${valueId}`}
        data-testid="ovw-courts-trigger"
        onClick={() => setOpen((o) => !o)}
        className="h-11 w-full min-w-[15rem] flex items-center justify-between gap-3 px-4 rounded-xl border-[1.5px] border-fl-line-strong bg-fl-white text-fl-night font-semibold text-[15px] whitespace-nowrap"
      >
        <span id={valueId} className="truncate">
          {label}
        </span>
        <Chevron />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} title={t("ovw.filters.courtsAria")} width="w-80" testId="ovw-courts-panel">
        <div ref={listRef} role="listbox" aria-multiselectable="true" aria-label={t("ovw.filters.courtsAria")} onKeyDown={onKeyDown} className="flex flex-col gap-1">
          <div
            role="option"
            aria-selected={allSelected}
            tabIndex={0}
            data-autofocus
            onClick={() => onChange([])}
            className="min-h-11 flex items-center gap-3 px-3 rounded-xl cursor-pointer font-bold text-sm text-fl-night hover:bg-fl-ground focus-visible:bg-fl-ground"
          >
            <Box checked={allSelected} />
            {t("ovw.filters.allToggle")}
          </div>
          {courts.map((c) => (
            <div
              key={c.id}
              role="option"
              aria-selected={isOn(c.id)}
              tabIndex={-1}
              onClick={() => toggleCourt(c.id)}
              className="min-h-11 flex items-center gap-3 px-3 rounded-xl cursor-pointer font-semibold text-sm text-fl-night hover:bg-fl-ground focus-visible:bg-fl-ground"
            >
              <Box checked={isOn(c.id)} />
              {courtLabel(c.name, c.sport)}
            </div>
          ))}
        </div>
      </Popover>
    </div>
  );
}
