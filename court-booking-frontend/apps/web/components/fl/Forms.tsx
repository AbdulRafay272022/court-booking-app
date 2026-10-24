"use client";

import { useId, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { slotChipA11y, slotChipCue, slotChipPressable, type SlotChipState } from "@court-booking/ui-tokens";
import { cx, useFlCopy, useFlLang, useFlRole } from "./role";
import { Hourglass, Lock, Minus, Plus, UserCheck } from "./icons";

/* ---------------- SlotChip ---------------- */

const SLOT: Record<Exclude<SlotChipState, "selected" | "inRange">, string> = {
  open: "bg-fl-ground text-fl-night border border-fl-line hover:border-fl-night",
  held: "bg-fl-waiting-tint text-fl-waiting border border-dashed border-fl-waiting-border",
  booked: "bg-fl-booked-bg text-fl-muted line-through",
  noRoom: "bg-transparent text-fl-muted2 border border-dashed border-fl-line-strong",
  blocked: "bg-fl-mist text-fl-muted border border-dashed border-fl-line-strong line-through",
  mine: "bg-fl-open-tint text-fl-open border-2 border-fl-open",
};

/** One time slot (same API + states as mobile). Never colour-only: ✓ + outline, dashed, strikethrough, lock/hourglass icons. */
export function SlotChip({ state, label, onClick, reason, className }: { state: SlotChipState; label: string; onClick?: () => void; reason?: string | null; className?: string }) {
  const role = useFlRole();
  const lang = useFlLang();
  const cue = slotChipCue(state);
  const pressable = slotChipPressable(state) && !!onClick;
  const look =
    state === "selected"
      ? "bg-fl-role-slot-selected text-fl-role-on-slot-selected border-2 border-fl-role-slot-selected-border shadow-fl-role-primary"
      : state === "inRange"
        ? "bg-fl-role-slot-range text-fl-role-on-slot-range border-2 border-fl-role-slot-range-border"
        : SLOT[state];
  const Icon = cue.icon === "lock" ? Lock : cue.icon === "hourglass" ? Hourglass : cue.icon === "user" ? UserCheck : null;
  return (
    <button
      type="button"
      data-fl-role={role}
      data-state={state}
      aria-label={slotChipA11y(state, label, lang, reason)}
      aria-pressed={state === "selected" || state === "inRange"}
      disabled={!pressable}
      onClick={onClick}
      className={cx(
        "inline-flex min-h-12 min-w-11 items-center justify-center gap-1 rounded-fl-md px-2 font-fl-body text-[14px] font-extrabold tabular-nums disabled:cursor-default",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fl-night",
        look,
        className,
      )}
    >
      {Icon ? <Icon size={13} strokeWidth={2.4} /> : null}
      <span>
        {cue.prefix}
        {label}
      </span>
    </button>
  );
}

/* ---------------- Input ---------------- */

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "prefix"> {
  label: string;
  help?: string;
  error?: string | null;
  prefix?: string;
  trailing?: ReactNode;
  secureToggle?: boolean;
}

/** Label always visible, 56px field, role focus ring, error text announced. */
export function Input({ label, help, error, prefix, trailing, secureToggle, id, type, className, ...rest }: InputProps) {
  const role = useFlRole();
  const copy = useFlCopy();
  const auto = useId();
  const fieldId = id ?? auto;
  const [shown, setShown] = useState(false);
  const describedBy = error ? `${fieldId}-err` : help ? `${fieldId}-help` : undefined;
  return (
    <div data-fl-role={role} className={cx("flex flex-col gap-2", className)}>
      <label htmlFor={fieldId} className="font-fl-body text-[13px] font-extrabold text-fl-night">
        {label}
      </label>
      <div
        className={cx(
          "flex min-h-14 items-center overflow-hidden rounded-fl-input bg-fl-white",
          error ? "border-2 border-fl-danger" : "border-[1.5px] border-fl-line-strong focus-within:border-2 focus-within:border-fl-role-focus",
        )}
      >
        {prefix ? <span className="flex h-14 items-center border-r-[1.5px] border-fl-line px-3.5 text-[16px] font-extrabold">{prefix}</span> : null}
        <input
          {...rest}
          id={fieldId}
          type={secureToggle ? (shown ? "text" : "password") : type}
          aria-invalid={!!error || undefined}
          aria-describedby={describedBy}
          className="h-14 min-w-0 flex-1 bg-transparent px-3.5 font-fl-body text-[16px] text-fl-night outline-none placeholder:text-fl-muted2"
        />
        {secureToggle ? (
          <button type="button" onClick={() => setShown((s) => !s)} aria-label={shown ? copy("Password chhupao", "Hide password") : copy("Password dikhao", "Show password")} className="min-h-11 px-3.5 text-[14px] font-extrabold text-fl-night">
            {shown ? copy("Chhupao", "Hide") : copy("Dikhao", "Show")}
          </button>
        ) : (
          trailing
        )}
      </div>
      {error ? (
        <span id={`${fieldId}-err`} role="alert" className="text-[12px] font-bold text-fl-danger">
          {error}
        </span>
      ) : help ? (
        <span id={`${fieldId}-help`} className="text-[12px] text-fl-muted">
          {help}
        </span>
      ) : null}
    </div>
  );
}

/* ---------------- Stepper ---------------- */

export function Stepper({ label, value, onChange, min, max, step = 1, unit, help }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step?: number; unit?: string; help?: string }) {
  const copy = useFlCopy();
  const text = `${value}${unit ? ` ${unit}` : ""}`;
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-extrabold text-fl-night">{label}</span>
      <div role="group" aria-label={label} className="inline-flex w-fit items-center gap-3 rounded-fl-input bg-fl-ground p-1.5">
        <button type="button" aria-label={copy(`${label} kam karein`, `Decrease ${label}`)} disabled={value <= min} onClick={() => onChange(Math.max(min, value - step))} className="flex h-11 w-11 items-center justify-center rounded-full bg-fl-white disabled:opacity-50">
          <Minus size={20} />
        </button>
        <output aria-live="polite" className="min-w-[72px] text-center font-fl-display text-[20px] font-extrabold tabular-nums">
          {text}
        </output>
        <button type="button" aria-label={copy(`${label} barhayein`, `Increase ${label}`)} disabled={value >= max} onClick={() => onChange(Math.min(max, value + step))} className="flex h-11 w-11 items-center justify-center rounded-full bg-fl-white disabled:opacity-50">
          <Plus size={20} />
        </button>
      </div>
      {help ? <span className="text-[12px] text-fl-muted">{help}</span> : null}
    </div>
  );
}

/* ---------------- SegmentedToggle / Checkbox / Switch ---------------- */

export function SegmentedToggle<V extends string>({ options, value, onChange, "aria-label": label, tone = "light" }: { options: { value: V; label: string; count?: number }[]; value: V; onChange: (v: V) => void; "aria-label": string; tone?: "light" | "role" }) {
  const role = useFlRole();
  return (
    <div data-fl-role={role} role="tablist" aria-label={label} className="flex gap-1 rounded-fl-md bg-fl-mist p-1">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            className={cx(
              "min-h-11 flex-1 rounded-fl-sm px-3 text-[14px] tabular-nums",
              on ? (tone === "role" ? "bg-fl-role-primary font-extrabold text-fl-role-on-primary" : "bg-fl-white font-extrabold text-fl-night shadow-fl-segment") : "font-bold text-fl-muted",
            )}
          >
            {o.label}
            {o.count !== undefined ? ` · ${o.count}` : ""}
          </button>
        );
      })}
    </div>
  );
}

export function Checkbox({ checked, onChange, label, children }: { checked: boolean; onChange: (v: boolean) => void; label?: string; children?: ReactNode }) {
  const role = useFlRole();
  return (
    <label data-fl-role={role} className="flex min-h-11 cursor-pointer items-center gap-3 text-[14px] text-fl-night">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span aria-hidden className={cx("flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-fl-xs peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-fl-night", checked ? "bg-fl-role-control-on text-fl-role-on-control-on" : "border-2 border-fl-muted2 bg-fl-white")}>
        {checked ? "✓" : ""}
      </span>
      <span>{children ?? label}</span>
    </label>
  );
}

export function Switch({ value, onChange, label, hint }: { value: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  const role = useFlRole();
  return (
    <button type="button" role="switch" aria-checked={value} data-fl-role={role} onClick={() => onChange(!value)} className="flex min-h-11 w-full items-center gap-3 text-left">
      <span className="flex flex-1 flex-col">
        <span className="text-[14px] font-extrabold text-fl-night">{label}</span>
        {hint ? <span className="text-[12px] text-fl-muted">{hint}</span> : null}
      </span>
      <span aria-hidden className={cx("relative h-8 w-[52px] shrink-0 rounded-full", value ? "bg-fl-role-switch-on" : "bg-fl-line-strong")}>
        <span className={cx("absolute top-[3px] h-[26px] w-[26px] rounded-full bg-fl-white shadow-fl-knob", value ? "left-[23px]" : "left-[3px]")} />
      </span>
    </button>
  );
}
