"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useT } from "@/components/i18n/lang-provider";

export interface MultiOption {
  value: string;
  label: string;
}

/**
 * A labelled multi-select: a button that opens a panel of real checkboxes (disclosure pattern, no ARIA listbox tricks).
 * Escape or a click outside closes it and focus goes back to the button. Empty selection means "everything".
 */
export function MultiSelect({
  label,
  options,
  selected,
  onChange,
  allLabel,
  summary,
}: {
  label: string;
  options: MultiOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Button text when nothing is selected. */
  allLabel: string;
  /** Button text for a non-empty selection. */
  summary: (selected: MultiOption[]) => string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const labelId = useId();
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const chosen = options.filter((o) => selected.includes(o.value));
  const text = chosen.length === 0 ? allLabel : summary(chosen);

  return (
    <div
      ref={rootRef}
      className="relative flex min-w-0 flex-col gap-1.5"
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
          buttonRef.current?.focus();
        }
      }}
    >
      <span id={labelId} className="text-[13px] font-bold text-owner-ink">
        {label}
      </span>
      <button
        ref={buttonRef}
        type="button"
        aria-labelledby={`${labelId} ${panelId}-text`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-11 w-full min-w-[11rem] items-center justify-between gap-2 rounded-xl border border-owner-border bg-owner-surface px-3.5 text-left text-[14.5px] font-semibold text-owner-ink"
      >
        <span id={`${panelId}-text`} className="truncate">
          {text}
        </span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
      {open ? (
        <div
          id={panelId}
          role="group"
          aria-labelledby={labelId}
          className="absolute left-0 top-full z-30 mt-1 max-h-72 w-full min-w-[15rem] overflow-y-auto rounded-xl border border-owner-border bg-owner-surface p-2 shadow-xl"
        >
          <button
            type="button"
            onClick={() => onChange([])}
            disabled={selected.length === 0}
            className="mb-1 min-h-11 w-full rounded-lg px-3 text-left text-[14px] font-bold text-owner-accent disabled:text-owner-ink-muted"
          >
            {t("hist.f.clearSelection")}
          </button>
          {options.map((o) => {
            const checked = selected.includes(o.value);
            return (
              <label key={o.value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 text-[14.5px] text-owner-ink hover:bg-owner-bg">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onChange(checked ? selected.filter((v) => v !== o.value) : [...selected, o.value])}
                  className="h-5 w-5 accent-owner-accent"
                />
                <span>{o.label}</span>
              </label>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
