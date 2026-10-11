import Link from "next/link";
import type { ReactNode } from "react";

/** Page width: 1200px content with 24px gutters (the header and the app screens use the 1240 `wide` variant). */
export function Container({ children, wide = false, className = "" }: { children: ReactNode; wide?: boolean; className?: string }) {
  return <div className={`mx-auto w-full px-6 ${wide ? "max-w-[1240px]" : "max-w-[1200px]"} ${className}`}>{children}</div>;
}

const SECTION_TONES = {
  page: "bg-khelo-page text-khelo-ink",
  surface: "bg-khelo-surface text-khelo-ink",
  ink: "bg-khelo-ink text-white",
  teal: "bg-khelo-teal text-white",
  mint: "bg-khelo-mint text-khelo-ink",
  warm: "bg-khelo-warm-2 text-khelo-ink",
} as const;

/** A full-width band: 88px (96px from md up) of vertical padding, then the 1200px container. */
export function Section({
  children,
  tone = "page",
  id,
  className = "",
  labelledBy,
}: {
  children: ReactNode;
  tone?: keyof typeof SECTION_TONES;
  id?: string;
  className?: string;
  labelledBy?: string;
}) {
  return (
    <section id={id} aria-labelledby={labelledBy} className={`${SECTION_TONES[tone]} py-[88px] md:py-24 ${className}`}>
      <Container>{children}</Container>
    </section>
  );
}

/** The small uppercase label above a heading. Teal on light backgrounds, orange on dark ones. */
export function Eyebrow({ children, tone = "teal" }: { children: ReactNode; tone?: "teal" | "orange" | "light" }) {
  const color = tone === "orange" ? "text-khelo-orange" : tone === "light" ? "text-white/80" : "text-khelo-teal";
  return <div className={`text-[13px] font-extrabold uppercase tracking-[1.5px] ${color}`}>{children}</div>;
}

/** Section heading (48px display). `id` lets a section point `aria-labelledby` at it. */
export function SectionTitle({ children, id, className = "" }: { children: ReactNode; id?: string; className?: string }) {
  return (
    <h2 id={id} className={`font-khelo-display text-[34px] font-extrabold leading-[1.05] tracking-[-1.5px] md:text-5xl ${className}`}>
      {children}
    </h2>
  );
}

const CHIP_BASE =
  "khelo-btn inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-full border-[1.5px] px-[18px] py-2.5 text-[14px] font-bold";

/** A pill. Renders a link with `href`, otherwise a toggle button (`selected` flips it to the ink-filled state). */
export function Chip({
  children,
  href,
  selected = false,
  onClick,
  className = "",
  ariaLabel,
}: {
  children: ReactNode;
  href?: string;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
  ariaLabel?: string;
}) {
  const tone = selected ? "border-khelo-ink bg-khelo-ink text-white" : "border-khelo-border bg-khelo-surface text-khelo-ink";
  if (href) {
    return (
      <Link href={href} className={`${CHIP_BASE} ${tone} ${className}`} aria-label={ariaLabel}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} aria-pressed={selected} aria-label={ariaLabel} className={`${CHIP_BASE} ${tone} ${className}`}>
      {children}
    </button>
  );
}

const BADGE_TONES = {
  success: "bg-khelo-success-bg text-khelo-success-text",
  warning: "bg-khelo-warning-bg text-khelo-warning-text",
  mint: "bg-khelo-mint text-khelo-teal",
  warm: "bg-khelo-warm text-khelo-orange-label",
  booked: "bg-khelo-booked-bg text-khelo-booked-text",
  ink: "bg-khelo-ink text-white",
} as const;

/** A small status pill (slot states, tags, "Sample data"). */
export function Badge({ children, tone = "mint", className = "" }: { children: ReactNode; tone?: keyof typeof BADGE_TONES; className?: string }) {
  return <span className={`inline-flex items-center rounded-full px-3 py-1 text-[12px] font-extrabold ${BADGE_TONES[tone]} ${className}`}>{children}</span>;
}

/** One FAQ entry: a native <details>, no JS. The plus rotates to an x when open. */
export function FaqItem({ question, children, defaultOpen = false }: { question: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="rounded-[20px] bg-khelo-surface px-[26px] py-[22px]">
      <summary className="flex items-center justify-between gap-4 text-[18px] font-extrabold">
        {question}
        <span aria-hidden="true" className="khelo-plus text-[28px] leading-none text-khelo-orange-text">
          +
        </span>
      </summary>
      <div className="mt-3.5 leading-[1.7] text-khelo-muted">{children}</div>
    </details>
  );
}
