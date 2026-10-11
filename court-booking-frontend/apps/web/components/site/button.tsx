import Link from "next/link";
import type { ComponentProps, MouseEventHandler, ReactNode } from "react";

export type ButtonVariant = "primary" | "outline" | "outlineDark" | "dark";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  /** Orange fill, INK text (text on orange is never white). */
  primary: "bg-khelo-orange text-khelo-ink font-extrabold",
  /** Outline for DARK backgrounds. */
  outline: "border-[1.5px] border-white/35 text-white font-bold",
  /** Outline for LIGHT backgrounds. */
  outlineDark: "border-[1.5px] border-khelo-ink text-khelo-ink font-bold",
  dark: "bg-khelo-ink text-white font-extrabold",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "px-[22px] py-3 text-[14px]", // header pills
  md: "px-6 py-3.5 text-[15px]",
  lg: "px-[30px] py-[18px] text-[17px]", // hero buttons
};

export function buttonClasses({
  variant = "primary",
  size = "md",
  pill = false,
  className = "",
}: { variant?: ButtonVariant; size?: ButtonSize; pill?: boolean; className?: string } = {}): string {
  return `khelo-btn inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap select-none ${VARIANTS[variant]} ${SIZES[size]} ${
    pill ? "rounded-full" : "rounded-[14px]"
  } ${className}`.trim();
}

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Pill (header, chips) vs the 14px-radius rectangle used for hero and form buttons. */
  pill?: boolean;
  className?: string;
  children: ReactNode;
}

type LinkButtonProps = CommonProps & { href: string; external?: boolean } & Omit<ComponentProps<typeof Link>, "href" | "className" | "children">;
type PlainButtonProps = CommonProps & { href?: undefined; onClick?: MouseEventHandler<HTMLButtonElement> } & Omit<ComponentProps<"button">, "className" | "children" | "onClick">;

/** The one button/link-button. With `href` it is an anchor (a plain `<a>` for `external`, mailto: and tel: targets). */
export function Button(props: LinkButtonProps | PlainButtonProps) {
  const { variant, size, pill, className, children } = props;
  const classes = buttonClasses({ variant, size, pill, className });
  if (props.href !== undefined) {
    const { href, external, variant: _v, size: _s, pill: _p, className: _c, children: _ch, ...rest } = props as LinkButtonProps;
    void _v; void _s; void _p; void _c; void _ch;
    const isExternal = external || /^(https?:|mailto:|tel:)/.test(href);
    return isExternal ? (
      <a href={href} className={classes} {...(rest as ComponentProps<"a">)} {...(/^https?:/.test(href) ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
        {children}
      </a>
    ) : (
      <Link href={href} className={classes} {...rest}>
        {children}
      </Link>
    );
  }
  const { variant: _v, size: _s, pill: _p, className: _c, children: _ch, href: _h, ...rest } = props as PlainButtonProps;
  void _v; void _s; void _p; void _c; void _ch; void _h;
  return (
    <button type="button" className={classes} {...rest}>
      {children}
    </button>
  );
}
