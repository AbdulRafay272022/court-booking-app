"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx, useFlRole } from "./role";
import type { FlIcon } from "./icons";

export type ButtonVariant = "primary" | "secondary" | "soft" | "danger" | "dangerSolid";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  label: string;
  /** primary = the role's ONE main action (player orange + ink, owner teal + white). */
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
}

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-fl-role-primary text-fl-role-on-primary shadow-fl-role-primary",
  secondary: "bg-fl-night text-fl-white",
  soft: "bg-fl-white text-fl-night border-[1.5px] border-fl-line-strong",
  danger: "bg-fl-white text-fl-danger border-[1.5px] border-fl-danger-border",
  dangerSolid: "bg-fl-danger text-fl-white",
};
const SIZE: Record<ButtonSize, string> = {
  sm: "min-h-11 px-4 rounded-fl-md text-[14px]",
  md: "min-h-[52px] px-6 rounded-fl-button text-[15px]",
  lg: "min-h-14 px-6 rounded-fl-button text-[17px]",
};

/** Same API as mobile <Button>. Disabled = grey with readable label; loading keeps the label for screen readers. */
export function Button({ label, variant = "primary", size = "lg", loading, icon, block, disabled, className, type = "button", ...rest }: ButtonProps) {
  const role = useFlRole();
  const inert = !!disabled || !!loading;
  return (
    <button
      {...rest}
      type={type}
      data-fl-role={role}
      disabled={inert}
      aria-busy={loading || undefined}
      className={cx(
        "inline-flex items-center justify-center gap-2 py-2 font-fl-body font-extrabold tabular-nums leading-tight transition-[transform,opacity] duration-150 ease-fl",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fl-night",
        inert ? "bg-fl-booked-bg text-fl-muted shadow-none" : cx(VARIANT[variant], "hover:opacity-90 active:scale-[0.98] motion-reduce:active:scale-100"),
        SIZE[size],
        block ? "w-full" : "",
        className,
      )}
    >
      {loading ? <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" /> : icon ? <span aria-hidden className="inline-flex">{icon}</span> : null}
      <span>{label}</span>
    </button>
  );
}

export type IconButtonVariant = "plain" | "surface" | "mist" | "onDark" | "onPhoto" | "primary" | "night";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> {
  icon: FlIcon;
  /** REQUIRED by the type: icon-only controls must be named. */
  "aria-label": string;
  variant?: IconButtonVariant;
  badge?: number | null;
  iconSize?: number;
}

const ICON_VARIANT: Record<IconButtonVariant, string> = {
  plain: "bg-transparent text-fl-night",
  surface: "bg-fl-white text-fl-night",
  mist: "bg-fl-mist text-fl-night",
  onDark: "bg-fl-a-glass-dark text-fl-white border border-fl-a-glass-dark-border",
  onPhoto: "bg-fl-a-heart-on-photo text-fl-white border border-fl-a-on-photo-border backdrop-blur-md",
  primary: "bg-fl-role-primary text-fl-role-on-primary",
  night: "bg-fl-night text-fl-white",
};

/** 44px round icon button (same API as mobile; `aria-label` required). */
export function IconButton({ icon: Icon, variant = "surface", badge, iconSize = 20, className, type = "button", ...rest }: IconButtonProps) {
  const role = useFlRole();
  return (
    <button
      {...rest}
      type={type}
      data-fl-role={role}
      className={cx(
        "relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full disabled:opacity-50",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fl-night hover:opacity-90",
        ICON_VARIANT[variant],
        className,
      )}
    >
      <Icon size={iconSize} strokeWidth={2.2} />
      {badge ? (
        <span aria-hidden className="absolute -right-0.5 top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-fl-role-badge px-1 text-[11px] font-extrabold text-fl-role-on-badge">
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </button>
  );
}
