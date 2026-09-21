"use client";

import { parseTime24, pktDayTabs, toTime24, type Meridiem, type Time12 } from "@court-booking/types";
import { FieldLabel } from "./ui";

/**
 * 12-hour time input for owners (hour / minute / AM-PM), stored and sent as "HH:MM" 24-hour.
 *
 * Replaces `<input type="time">`, which shows whatever the browser's locale prefers -- 24-hour on many
 * machines -- and a free-text box on mobile. Section 32: no owner or player should ever have to read
 * "23:00".
 */
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 59];
const DEFAULT_TIME: Time12 = { hour: 6, minute: 0, meridiem: "AM" };

const selectClass =
  "h-12 px-2 rounded-[9px] bg-owner-bg border border-owner-border text-[15px] font-medium text-owner-ink outline-none focus:border-owner-accent";

export function TimeField12({
  label,
  value,
  onChange,
  optional = false,
  ariaLabel,
}: {
  label: string;
  /** "HH:MM" (24-hour) or "" when optional and unset */
  value: string;
  onChange: (next: string) => void;
  optional?: boolean;
  ariaLabel?: string;
}) {
  const parsed = parseTime24(value);
  const name = ariaLabel ?? label;
  // keep an existing off-grid minute (e.g. 06:07 from an older entry) selectable instead of silently showing :00
  const minutes = parsed && !MINUTES.includes(parsed.minute) ? [...MINUTES, parsed.minute].sort((a, b) => a - b) : MINUTES;
  const set = (patch: Partial<Time12>) => onChange(toTime24({ ...(parsed ?? DEFAULT_TIME), ...patch }));

  return (
    <div className="flex flex-col gap-2 flex-1 min-w-0">
      {label ? <FieldLabel>{label}</FieldLabel> : null}
      <div role="group" aria-label={name} className="flex gap-1.5">
        <select
          aria-label={`${name} hour`}
          className={`${selectClass} flex-1 min-w-0`}
          value={parsed ? parsed.hour : ""}
          onChange={(e) => (e.target.value === "" ? onChange("") : set({ hour: Number(e.target.value) }))}
        >
          {optional || !parsed ? <option value="">{optional ? "Any" : "--"}</option> : null}
          {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
        <select
          aria-label={`${name} minutes`}
          className={`${selectClass} flex-1 min-w-0`}
          value={parsed ? parsed.minute : 0}
          onChange={(e) => set({ minute: Number(e.target.value) })}
          disabled={optional && !parsed}
        >
          {minutes.map((m) => (
            <option key={m} value={m}>
              {String(m).padStart(2, "0")}
            </option>
          ))}
        </select>
        <select
          aria-label={`${name} AM or PM`}
          className={`${selectClass} flex-1 min-w-0`}
          value={parsed ? parsed.meridiem : "AM"}
          onChange={(e) => set({ meridiem: e.target.value as Meridiem })}
          disabled={optional && !parsed}
        >
          <option value="AM">AM</option>
          <option value="PM">PM</option>
        </select>
      </div>
    </div>
  );
}

/** Pick a Pakistan calendar day from today onward, as human chips ("Today", "Tomorrow", "Thu 24 Sep").
 * `value` is "YYYY-MM-DD" (or "" when nothing is chosen yet). */
export function DayPicker({
  label,
  value,
  onChange,
  days = 21,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  days?: number;
}) {
  const options = pktDayTabs(days);
  return (
    <div className="flex flex-col gap-2 min-w-0">
      {label ? <FieldLabel>{label}</FieldLabel> : null}
      <div role="group" aria-label={label} className="flex gap-1.5 overflow-x-auto pb-1">
        {options.map((d, i) => {
          const selected = d.date === value;
          return (
            <button
              key={d.date}
              type="button"
              onClick={() => onChange(d.date)}
              aria-pressed={selected}
              className="shrink-0 h-11 px-3.5 rounded-lg text-[13px] font-semibold border whitespace-nowrap"
              style={{
                background: selected ? "#0E6274" : "#FFFFFF",
                color: selected ? "#fff" : "#101C21",
                borderColor: selected ? "#0E6274" : "#DCE3E6",
              }}
            >
              {i === 0 ? "Today" : i === 1 ? "Tomorrow" : `${d.weekday} ${d.day} ${d.month}`}
            </button>
          );
        })}
      </div>
    </div>
  );
}
