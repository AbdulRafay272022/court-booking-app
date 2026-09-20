"use client";

import { useId, type InputHTMLAttributes, type ReactNode } from "react";

/** Small owner-system (teal / IBM Plex Sans) UI kit for the venue-setup wizard. Same
 * shapes as the mobile wizard's _components.tsx so the two read as one product. */

export function SectionCard({ children }: { children: ReactNode }) {
  return <section className="bg-owner-surface border border-owner-border rounded-2xl p-5 sm:p-6 flex flex-col gap-4">{children}</section>;
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <h2 className="text-[11px] font-bold uppercase tracking-[0.11em] text-owner-ink-faint">{children}</h2>;
}

export function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="text-[13px] font-semibold text-owner-ink-muted">
      {children}
    </label>
  );
}

export function Field({
  label,
  error,
  mono,
  ...input
}: { label: string; error?: string | null; mono?: boolean } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2 flex-1 min-w-0">
      {label ? <FieldLabel htmlFor={id}>{label}</FieldLabel> : null}
      <input
        {...input}
        id={id}
        aria-invalid={!!error}
        className={`h-12 px-3.5 rounded-[9px] bg-owner-bg border text-[15px] font-medium text-owner-ink outline-none focus:border-owner-accent ${
          error ? "border-owner-danger" : "border-owner-border"
        } ${mono ? "font-[family-name:var(--font-mono-x)]" : ""}`}
      />
      {error ? (
        <p role="alert" className="text-[12.5px] font-medium text-owner-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Chip({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      onClick={onClick}
      className={`min-h-10 px-4 rounded-full text-[13.5px] font-semibold border transition-colors ${
        selected ? "bg-owner-accent text-white border-owner-accent" : "bg-owner-surface text-owner-ink-muted border-owner-border"
      }`}
    >
      {label}
    </button>
  );
}

/** Smart submit, owner tone: grey and inert until `ready`, teal once it is. */
export function PrimaryButton({
  label,
  onClick,
  ready = true,
  busy = false,
}: {
  label: string;
  onClick: () => void;
  ready?: boolean;
  busy?: boolean;
}) {
  const active = ready && !busy;
  return (
    <button
      type="button"
      disabled={!active}
      aria-disabled={!active}
      onClick={() => {
        if (active) onClick();
      }}
      className={`h-12 w-full rounded-[10px] text-[15px] font-bold transition-colors ${
        active
          ? "bg-owner-accent text-white hover:bg-owner-accent-hover"
          : ready && busy
            ? "bg-owner-accent text-white opacity-70 cursor-progress"
            : "bg-owner-border text-owner-ink-faint cursor-not-allowed"
      }`}
    >
      {busy ? "Please wait…" : label}
    </button>
  );
}

export function SecondaryButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-12 px-5 w-full rounded-[10px] text-[14.5px] font-semibold border border-owner-border bg-owner-surface text-owner-ink"
    >
      {label}
    </button>
  );
}

export function Stepper({ current }: { current: 1 | 2 | 3 }) {
  const steps = ["Your venue", "Courts & pricing", "We review it"];
  return (
    <ol className="flex flex-wrap items-center gap-x-3 gap-y-2" aria-label="Setup progress">
      {steps.map((label, i) => {
        const n = i + 1;
        const done = n < current;
        const active = n === current;
        return (
          <li key={label} className="flex items-center gap-2" aria-current={active ? "step" : undefined}>
            <span
              className={`w-[22px] h-[22px] rounded-full flex items-center justify-center text-[11px] font-semibold ${
                done || active ? "bg-owner-accent text-white" : "bg-owner-bg text-owner-ink-faint border border-owner-border"
              }`}
            >
              {done ? "✓" : n}
            </span>
            <span className={`text-[12.5px] ${active ? "font-semibold text-owner-ink" : "font-medium text-owner-ink-faint"}`}>{label}</span>
            {i < steps.length - 1 ? <span className="w-4 h-px bg-owner-border" /> : null}
          </li>
        );
      })}
    </ol>
  );
}
