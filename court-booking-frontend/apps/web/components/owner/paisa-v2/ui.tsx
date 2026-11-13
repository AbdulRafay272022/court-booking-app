"use client";

import type { ReactNode } from "react";
import { cx } from "@/components/fl/role";

/** Small building blocks of the v2 Paisa page (owner tokens, Floodlight look). No copy lives here: callers pass labels. */

export function Section({ title, right, children, testId }: { title?: string; right?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <section data-testid={testId} className="flex min-w-0 flex-col gap-3 rounded-2xl border border-owner-border bg-owner-surface p-4">
      {title || right ? (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          {title ? <h2 className="text-[15px] font-bold text-owner-ink">{title}</h2> : <span />}
          {right}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** A labelled native select (dropdowns, never chips: founder 10 Nov). */
export function Select<V extends string>({
  label,
  value,
  options,
  onChange,
  testId,
  className,
}: {
  label: string;
  value: V;
  options: { value: V; label: string }[];
  onChange: (v: V) => void;
  testId?: string;
  className?: string;
}) {
  return (
    <label className={cx("flex min-w-0 flex-col gap-1", className)}>
      <span className="text-[11.5px] font-bold tracking-wide text-owner-ink-faint">{label}</span>
      <select
        data-testid={testId}
        value={value}
        onChange={(e) => onChange(e.target.value as V)}
        className="h-10 min-w-0 cursor-pointer rounded-lg border border-owner-border bg-owner-surface px-3 text-[14px] font-semibold text-owner-ink outline-none focus-visible:ring-2 focus-visible:ring-owner-accent"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  error,
  inputMode,
  testId,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string | null;
  inputMode?: "numeric" | "text" | "search";
  testId?: string;
  autoFocus?: boolean;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[12.5px] font-semibold text-owner-ink-muted">{label}</span>
      <input
        data-testid={testId}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        autoComplete="off"
        aria-invalid={!!error}
        className={cx(
          "h-11 min-w-0 rounded-lg border bg-owner-surface px-3 text-[14px] tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-owner-accent",
          error ? "border-owner-danger" : "border-owner-border",
        )}
      />
      {error ? (
        <span role="alert" className="text-[12.5px] font-semibold text-owner-danger">
          {error}
        </span>
      ) : null}
    </label>
  );
}

/** Two or more exclusive choices (radio semantics), e.g. Cash / Transfer, Player ko wapas / Player ke jama mein. */
export function Choice<V extends string>({
  label,
  value,
  options,
  onChange,
  testId,
}: {
  label?: string;
  value: V | null;
  options: { value: V; label: string; disabled?: boolean }[];
  onChange: (v: V) => void;
  testId?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} data-testid={testId} className="flex min-w-0 flex-col gap-1.5">
      {label ? <span className="text-[12.5px] font-semibold text-owner-ink-muted">{label}</span> : null}
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={o.disabled}
              onClick={() => onChange(o.value)}
              className={cx(
                "min-h-11 cursor-pointer rounded-xl border px-4 text-[14px] font-semibold disabled:cursor-not-allowed disabled:opacity-40",
                on ? "border-owner-accent bg-owner-accent-soft text-owner-ink" : "border-owner-border bg-owner-surface text-owner-ink",
              )}
            >
              <span aria-hidden className="mr-1.5">{on ? "●" : "○"}</span>
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function PrimaryButton({ label, onClick, disabled, busy, tone = "accent", testId, type = "button" }: { label: string; onClick?: () => void; disabled?: boolean; busy?: boolean; tone?: "accent" | "danger" | "ghost"; testId?: string; type?: "button" | "submit" }) {
  const cls =
    tone === "danger"
      ? "bg-owner-danger text-white"
      : tone === "ghost"
        ? "border border-owner-border bg-owner-surface text-owner-ink"
        : "bg-owner-accent text-white hover:bg-owner-accent-hover";
  return (
    <button
      type={type}
      data-testid={testId}
      onClick={onClick}
      disabled={disabled || busy}
      className={cx("min-h-11 cursor-pointer whitespace-nowrap rounded-xl px-4 text-[14px] font-bold disabled:cursor-not-allowed disabled:opacity-50", cls)}
    >
      {label}
    </button>
  );
}

export function ErrorText({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" className="text-[13px] font-semibold text-owner-danger">
      {text}
    </p>
  );
}

/** One line of a money breakdown: label left, amount right (tabular). */
export function MoneyLine({ label, value, strong, tone, sub, onClick, testId }: { label: string; value: string; strong?: boolean; tone?: "danger" | "warn" | "open"; sub?: string; onClick?: () => void; testId?: string }) {
  const color = tone === "danger" ? "text-owner-danger" : tone === "warn" ? "text-owner-warn-dark" : tone === "open" ? "text-owner-success" : "text-owner-ink";
  const inner = (
    <>
      <span className={cx("flex min-w-0 flex-col text-left", strong ? "font-bold text-owner-ink" : "text-owner-ink-muted")}>
        {label}
        {sub ? <span className="text-[12px] font-normal text-owner-ink-faint">{sub}</span> : null}
      </span>
      <span className={cx("shrink-0 tabular-nums", strong ? "text-[17px] font-extrabold" : "text-[15px] font-bold", color)}>{value}</span>
    </>
  );
  return onClick ? (
    <button type="button" data-testid={testId} onClick={onClick} className="flex w-full cursor-pointer items-baseline justify-between gap-3 rounded-lg px-2 py-2 text-[14px] hover:bg-owner-bg">
      {inner}
    </button>
  ) : (
    <div data-testid={testId} className="flex items-baseline justify-between gap-3 px-2 py-2 text-[14px]">
      {inner}
    </div>
  );
}

export function GroupLabel({ label, count, right }: { label: string; count?: number; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-1">
      <h3 className="flex items-center gap-2 text-[12.5px] font-extrabold tracking-wide text-owner-ink-muted uppercase">
        {label}
        {count ? <span className="rounded-full bg-owner-danger px-2 py-0.5 text-[11px] font-bold text-white normal-case">{count}</span> : null}
      </h3>
      {right}
    </div>
  );
}
