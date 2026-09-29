import type { ReactNode } from "react";

/** Plain-text label for a court: "Court 1 · Padel" (just the name when the sport is unknown). Use this in
 * strings (aria-labels, confirm dialogs, select options); use <CourtLabel> in JSX. */
export function courtLabel(name: string, sport?: string | null): string {
  return sport ? `${name} · ${sport}` : name;
}

/** A court's name with its sport next to it, so two courts with similar names but different sports (a padel
 * "Court 1" and a futsal "Court 1") are never ambiguous. Renders inline; the sport is a quiet badge. */
export function CourtLabel({
  name,
  sport,
  className = "",
  badgeClassName = "",
  children,
}: {
  name: string;
  sport?: string | null;
  className?: string;
  badgeClassName?: string;
  children?: ReactNode;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 flex-wrap ${className}`}>
      <span>{name}</span>
      {sport ? (
        <span
          data-testid="court-sport"
          className={`text-[0.78em] font-semibold px-1.5 py-0.5 rounded bg-black/[0.06] opacity-80 ${badgeClassName}`}
        >
          {sport}
        </span>
      ) : null}
      {children}
    </span>
  );
}
