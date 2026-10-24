"use client";

import type { HTMLAttributes, ReactNode } from "react";
import { statusPill, type StatusInput, type Tone } from "@court-booking/ui-tokens";
import { cx, useFlLang, useFlRole } from "./role";

/* ---------------- Card ---------------- */

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: "raised" | "flat" | "sunken" | "night";
  padding?: 0 | 3 | 4 | 5;
}
const CARD: Record<NonNullable<CardProps["variant"]>, string> = {
  raised: "bg-fl-white shadow-fl-card",
  flat: "bg-fl-white border border-fl-line",
  sunken: "bg-fl-ground",
  night: "bg-fl-night text-fl-white",
};
const PAD = { 0: "p-0", 3: "p-3", 4: "p-4", 5: "p-5" } as const;

export function Card({ variant = "raised", padding = 4, className, ...rest }: CardProps) {
  const role = useFlRole();
  return <div {...rest} data-fl-role={role} className={cx("rounded-fl-card", CARD[variant], PAD[padding], className)} />;
}

/* ---------------- Chip ---------------- */

export interface ChipProps {
  label: string;
  selected?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  icon?: ReactNode;
  count?: number;
  shape?: "pill" | "tile";
  meta?: string;
  className?: string;
  "aria-label"?: string;
}

/** Selectable chip / option tile. Selected = role tint + 2px role border + "✓ " (never colour-only). */
export function Chip({ label, selected, onClick, disabled, icon, count, shape = "pill", meta, className, ...aria }: ChipProps) {
  const role = useFlRole();
  return (
    <button
      type="button"
      data-fl-role={role}
      aria-pressed={selected}
      aria-label={aria["aria-label"]}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "inline-flex items-center justify-center gap-2 font-fl-body text-[13px] font-extrabold tabular-nums disabled:opacity-50",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fl-night",
        meta ? "min-h-[60px] flex-col items-start gap-0 px-3 text-left" : "min-h-11 px-4",
        shape === "pill" ? "rounded-full" : "rounded-fl-md",
        selected ? "border-2 border-fl-role-selected-border bg-fl-role-selected text-fl-role-on-selected" : "border-[1.5px] border-fl-line-strong bg-fl-white text-fl-night hover:bg-fl-ground",
        className,
      )}
    >
      {icon ? <span aria-hidden className="inline-flex">{icon}</span> : null}
      <span>
        {selected ? "✓ " : ""}
        {label}
      </span>
      {meta ? <span className="text-[12px] font-normal text-fl-muted">{meta}</span> : null}
      {count !== undefined ? (
        <span className="inline-flex h-[26px] min-w-[26px] items-center justify-center rounded-full bg-fl-teal-tint px-1.5 text-[12px] font-extrabold text-fl-teal-deep">{count}</span>
      ) : null}
    </button>
  );
}

/* ---------------- Pill / StatusPill / Badge ---------------- */

const TONE: Record<Tone, string> = {
  open: "bg-fl-open-tint text-fl-open",
  waiting: "bg-fl-waiting-tint text-fl-waiting",
  danger: "bg-fl-danger-tint text-fl-danger",
  neutral: "bg-fl-mist text-fl-body",
  info: "bg-fl-teal-tint text-fl-teal-deep",
  night: "bg-fl-night text-fl-white",
  accent: "bg-fl-orange-tint text-fl-orange-deep",
};

export function Pill({ label, tone = "neutral", size = "md", className, "data-testid": testId }: { label: string; tone?: Tone; size?: "sm" | "md"; className?: string; "data-testid"?: string }) {
  return (
    <span data-testid={testId} className={cx("inline-flex items-center rounded-full px-3 font-fl-body font-extrabold", size === "sm" ? "min-h-[26px] text-[12px]" : "min-h-[30px] text-[13px]", TONE[tone], className)}>
      {label}
    </span>
  );
}

/** Booking status pill from the REAL status fields. "Pakki ✓" only when status === "booked". */
export function StatusPill({ booking, size }: { booking: StatusInput; size?: "sm" | "md" }) {
  const lang = useFlLang();
  const p = statusPill(booking, lang);
  return <Pill label={p.label} tone={p.tone} size={size} data-testid={`status-${p.key}`} />;
}

export function Badge({ count }: { count: number }) {
  const role = useFlRole();
  if (!count) return null;
  return (
    <span data-fl-role={role} className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-fl-role-badge px-1.5 text-[11px] font-extrabold text-fl-role-on-badge">
      {count > 99 ? "99+" : count}
    </span>
  );
}

/* ---------------- Banner / MoneyRows ---------------- */

export function Banner({ tone = "info", title, body, icon, action }: { tone?: "info" | "waiting" | "danger" | "open" | "neutral"; title?: string; body: string; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div role={tone === "danger" ? "alert" : undefined} className={cx("flex items-start gap-3 rounded-fl-input px-3.5 py-3", TONE[tone])}>
      {icon ? <span aria-hidden className="mt-0.5 inline-flex">{icon}</span> : null}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {title ? <b className="text-[14px]">{title}</b> : null}
        <span className="text-[13px] leading-snug">{body}</span>
        {action ? <div className="pt-2">{action}</div> : null}
      </div>
    </div>
  );
}

export interface MoneyRow {
  label: string;
  value: string;
  strong?: boolean;
  tone?: "default" | "open" | "danger" | "waiting";
  note?: string;
}

/** Total / Mila / Baqi block. Values are pre-formatted from the API (formatPkr). Wraps, never truncates. */
export function MoneyRows({ rows }: { rows: MoneyRow[] }) {
  const valueTone = { default: "text-fl-night", open: "text-fl-open", danger: "text-fl-danger", waiting: "text-fl-waiting" } as const;
  return (
    <dl data-testid="money-rows" className="m-0 rounded-fl-input bg-fl-ground px-3.5 py-1.5 tabular-nums">
      {rows.map((r, i) => (
        <div key={r.label} className={cx("flex flex-wrap items-start justify-between gap-3 py-2.5", i > 0 && "border-t border-fl-line")}>
          <dt className={cx("flex flex-col", r.strong ? "text-[14px] font-extrabold text-fl-night" : "text-[14px] text-fl-muted")}>
            {r.label}
            {r.note ? <span className="text-[12px] font-normal text-fl-muted">{r.note}</span> : null}
          </dt>
          <dd className={cx("m-0 ml-auto text-right font-extrabold", r.strong ? "font-fl-display text-[20px]" : "text-[16px]", valueTone[r.tone ?? "default"])}>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}
