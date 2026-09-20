"use client";

import { useId, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { TONES, type Tone } from "./tone";

/** One input system for every auth form, so labels, focus and error states are identical
 * on every screen: a small uppercase label, a 56px rounded field, a 1.5px ink border on
 * focus, and -- when a field fails validation -- a red border plus the message under it. */

function Label({ htmlFor, children, tone }: { htmlFor: string; children: ReactNode; tone: Tone }) {
  return (
    <label
      htmlFor={htmlFor}
      className="text-[11px] font-bold uppercase tracking-[0.11em]"
      style={{ color: TONES[tone].faint }}
    >
      {children}
    </label>
  );
}

function FieldError({ id, message, tone }: { id: string; message?: string | null; tone: Tone }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-[13px] font-medium" style={{ color: TONES[tone].danger }}>
      {message}
    </p>
  );
}

function boxStyle(tone: Tone, focused: boolean, invalid: boolean) {
  const t = TONES[tone];
  return {
    background: t.surface,
    border: `${focused || invalid ? 1.5 : 1}px solid ${invalid ? t.danger : focused ? t.ink : t.border}`,
    boxShadow: invalid ? `0 0 0 3px ${t.dangerSoft}` : "none",
  } as const;
}

type BaseProps = {
  label: string;
  /** The current validation message for this field, or nothing when it's valid. */
  error?: string | null;
  /** Show `error`? Callers pass "touched": nobody wants "Enter a valid email" while still typing the first character. */
  showError?: boolean;
  tone?: Tone;
};

export function TextField({
  label,
  error,
  showError,
  tone = "player",
  prefix,
  mono,
  className,
  ...input
}: BaseProps & { prefix?: ReactNode; mono?: boolean } & Omit<InputHTMLAttributes<HTMLInputElement>, "prefix">) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const invalid = !!(showError && error);
  return (
    <div className="flex flex-col gap-2.5">
      <Label htmlFor={id} tone={tone}>
        {label}
      </Label>
      <div className="flex items-center gap-2.5 h-14 px-4 rounded-[14px] transition-colors" style={boxStyle(tone, focused, invalid)}>
        {prefix}
        <input
          {...input}
          id={id}
          aria-invalid={invalid}
          aria-describedby={invalid ? `${id}-err` : undefined}
          onFocus={(e) => {
            setFocused(true);
            input.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            input.onBlur?.(e);
          }}
          className={`flex-1 min-w-0 bg-transparent outline-none text-[16px] font-semibold ${mono ? "font-[family-name:var(--font-mono-x)] tracking-[0.02em]" : ""} disabled:opacity-50 ${className ?? ""}`}
          style={{ color: TONES[tone].ink }}
        />
      </div>
      <FieldError id={`${id}-err`} message={invalid ? error : null} tone={tone} />
    </div>
  );
}

export function PasswordField({
  label,
  error,
  showError,
  tone = "player",
  ...input
}: BaseProps & Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "prefix">) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(false);
  const invalid = !!(showError && error);
  const t = TONES[tone];
  return (
    <div className="flex flex-col gap-2.5">
      <Label htmlFor={id} tone={tone}>
        {label}
      </Label>
      <div className="flex items-center gap-2 h-14 pl-4 pr-2 rounded-[14px] transition-colors" style={boxStyle(tone, focused, invalid)}>
        <input
          {...input}
          id={id}
          type={visible ? "text" : "password"}
          aria-invalid={invalid}
          aria-describedby={invalid ? `${id}-err` : undefined}
          onFocus={(e) => {
            setFocused(true);
            input.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            input.onBlur?.(e);
          }}
          className="flex-1 min-w-0 bg-transparent outline-none text-[16px] font-semibold"
          style={{ color: t.ink }}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          className="h-10 px-3 rounded-lg text-[12.5px] font-bold"
          style={{ color: t.muted }}
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
      <FieldError id={`${id}-err`} message={invalid ? error : null} tone={tone} />
    </div>
  );
}

export function SelectField({
  label,
  error,
  showError,
  tone = "player",
  value,
  onChange,
  onBlur,
  placeholder,
  options,
}: BaseProps & {
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder: string;
  options: { value: string; label: string }[];
}) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const invalid = !!(showError && error);
  const t = TONES[tone];
  return (
    <div className="flex flex-col gap-2.5">
      <Label htmlFor={id} tone={tone}>
        {label}
      </Label>
      <div className="relative h-14 rounded-[14px] transition-colors" style={boxStyle(tone, focused, invalid)}>
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            onBlur?.();
          }}
          aria-invalid={invalid}
          aria-describedby={invalid ? `${id}-err` : undefined}
          className="absolute inset-0 w-full h-full appearance-none bg-transparent outline-none pl-4 pr-10 text-[16px] font-semibold"
          style={{ color: value ? t.ink : t.faint }}
        >
          <option value="" disabled>
            {placeholder}
          </option>
          {options.map((o) => (
            <option key={o.value} value={o.value} style={{ color: t.ink }}>
              {o.label}
            </option>
          ))}
        </select>
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2"
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke={t.faint}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </div>
      <FieldError id={`${id}-err`} message={invalid ? error : null} tone={tone} />
    </div>
  );
}

/** Pill-style single choice (gender, signing-up-as). Radio semantics, so it's keyboard- and
 * screen-reader-friendly, not just clickable divs. */
export function ChoicePills({
  label,
  value,
  onChange,
  options,
  error,
  showError,
  tone = "player",
}: BaseProps & {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  const t = TONES[tone];
  const groupId = useId();
  const invalid = !!(showError && error);
  return (
    <div className="flex flex-col gap-2.5">
      <span id={groupId} className="text-[11px] font-bold uppercase tracking-[0.11em]" style={{ color: t.faint }}>
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={groupId} className="flex flex-wrap gap-2">
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(o.value)}
              className="min-h-11 px-4 rounded-full text-[14px] font-bold transition-colors"
              style={
                selected
                  ? { background: t.ink, color: "#fff", border: `1px solid ${t.ink}` }
                  : { background: t.surface, color: t.muted, border: `1px solid ${invalid ? t.danger : t.border}` }
              }
            >
              {o.label}
            </button>
          );
        })}
      </div>
      <FieldError id={`${groupId}-err`} message={invalid ? error : null} tone={tone} />
    </div>
  );
}

/** A form-level message (server errors, notices): the same red/green treatment as a field error. */
export function FormMessage({ kind, children, tone = "player" }: { kind: "error" | "success" | "info"; children: ReactNode; tone?: Tone }) {
  const t = TONES[tone];
  const palette =
    kind === "error"
      ? { bg: t.dangerSoft, border: t.dangerSoftBorder, color: t.danger }
      : kind === "success"
        ? { bg: t.successSoft, border: t.successSoftBorder, color: t.success }
        : { bg: t.accentSoft, border: t.accentSoftBorder, color: t.muted };
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className="rounded-[14px] px-4 py-3 text-[13.5px] font-semibold leading-snug"
      style={{ background: palette.bg, border: `1px solid ${palette.border}`, color: palette.color }}
    >
      {children}
    </div>
  );
}
