"use client";

import { useId, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { useT } from "@/components/i18n/lang-provider";

export type AuthTheme = "player" | "owner";

/** Error text on the light page: the danger token, darkened for 4.5:1 contrast on small text. */
export const ERROR_TEXT = "text-[color-mix(in_srgb,var(--color-khelo-danger)_72%,black)]";

const INPUT =
  "khelo-input w-full box-border rounded-[14px] border-[1.5px] bg-white px-[18px] py-[17px] text-[16px] text-khelo-ink placeholder:text-khelo-muted-3 disabled:opacity-50";

export function FieldError({ id, message }: { id: string; message?: string | null }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className={`text-[13px] font-semibold ${ERROR_TEXT}`}>
      {message}
    </p>
  );
}

const labelClass = "text-[14px] font-bold";

type Common = { label: ReactNode; error?: string | null; showError?: boolean };

/** Label + input + (touched-only) error, wired with htmlFor / aria-invalid / aria-describedby. */
export function TextField({
  label,
  error,
  showError,
  prefix,
  ...input
}: Common & { prefix?: ReactNode } & Omit<InputHTMLAttributes<HTMLInputElement>, "prefix">) {
  const id = useId();
  const invalid = !!(showError && error);
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <div className="flex gap-2.5">
        {prefix}
        <input
          {...input}
          id={id}
          aria-invalid={invalid}
          aria-describedby={invalid ? `${id}-err` : undefined}
          className={`${INPUT} ${invalid ? "border-khelo-danger" : "border-khelo-border"}`}
        />
      </div>
      <FieldError id={`${id}-err`} message={invalid ? error : null} />
    </div>
  );
}

/** The fixed "+92" box that sits beside the national-number input. */
export function CountryPrefix() {
  return (
    <div aria-hidden="true" className="flex-none rounded-[14px] border-[1.5px] border-khelo-border bg-white px-4 py-[17px] font-bold">
      +92
    </div>
  );
}

/** Password input with an accessible Show/Hide toggle (`aria-pressed`, label names the action). `aside` sits right of the label. */
export function PasswordField({
  label,
  error,
  showError,
  aside,
  ...input
}: Common & { aside?: ReactNode } & Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "prefix">) {
  const t = useT();
  const id = useId();
  const [visible, setVisible] = useState(false);
  const invalid = !!(showError && error);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className={labelClass}>
          {label}
        </label>
        {aside}
      </div>
      <div className="relative">
        <input
          {...input}
          id={id}
          type={visible ? "text" : "password"}
          aria-invalid={invalid}
          aria-describedby={invalid ? `${id}-err` : undefined}
          className={`${INPUT} pr-20 ${invalid ? "border-khelo-danger" : "border-khelo-border"}`}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          aria-label={t("auth.field.showPassword")}
          className="absolute right-2.5 top-1/2 min-h-11 -translate-y-1/2 cursor-pointer rounded-lg px-3 py-2.5 text-[14px] font-bold text-khelo-teal"
        >
          <span aria-hidden="true">{visible ? t("auth.field.hide") : t("auth.field.show")}</span>
        </button>
      </div>
      <FieldError id={`${id}-err`} message={invalid ? error : null} />
    </div>
  );
}

/** A form-level message (server errors, notices). Errors are `role=alert`, notices `role=status`. */
export function FormNotice({ kind, children }: { kind: "error" | "success"; children: ReactNode }) {
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={`rounded-[14px] border px-4 py-3 text-[14px] font-semibold leading-snug ${
        kind === "error" ? `border-khelo-danger/40 bg-white ${ERROR_TEXT}` : "border-khelo-success bg-khelo-success-bg text-khelo-success-text"
      }`}
    >
      {children}
    </div>
  );
}

/**
 * The "smart" submit button: grey and inert until the form is valid (`ready`), then the theme colour (orange with ink
 * text for players, teal with white text for owners). Disabled AND guarded, so Enter or a synthetic click cannot submit it.
 */
export function SmartButton({
  ready,
  busy = false,
  busyLabel,
  theme = "player",
  type = "submit",
  onClick,
  className = "",
  children,
}: {
  ready: boolean;
  busy?: boolean;
  busyLabel?: string;
  theme?: AuthTheme;
  type?: "submit" | "button";
  onClick?: () => void;
  className?: string;
  children: ReactNode;
}) {
  const t = useT();
  const active = ready && !busy;
  const live = theme === "owner" ? "bg-khelo-teal text-white" : "bg-khelo-orange text-khelo-ink";
  return (
    <button
      type={type}
      disabled={!active}
      aria-disabled={!active}
      onClick={(e) => {
        if (!active) {
          e.preventDefault();
          return;
        }
        onClick?.();
      }}
      className={`min-h-11 rounded-[14px] px-6 py-[18px] text-[17px] font-extrabold ${
        active ? `khelo-btn cursor-pointer ${live}` : ready && busy ? `${live} cursor-progress opacity-70` : "cursor-not-allowed bg-khelo-booked-bg text-khelo-muted-2"
      } ${className}`}
    >
      {busy ? (busyLabel ?? t("auth.field.pleaseWait")) : children}
    </button>
  );
}
