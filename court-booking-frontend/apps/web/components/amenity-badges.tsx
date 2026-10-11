import { amenityLabel } from "@court-booking/types";

type IconProps = { className?: string };

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function Svg({ className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" className={className} aria-hidden="true" {...stroke}>
      {children}
    </svg>
  );
}

const ICONS: Record<string, (p: IconProps) => React.ReactElement> = {
  floodlights: (p) => (
    <Svg {...p}>
      <path d="M12 3v2M5.6 5.6 7 7M18.4 5.6 17 7M3 12h2M19 12h2" />
      <path d="M8 21h8M12 21v-5" />
      <path d="M8 16h8a4 4 0 1 0-8 0Z" />
    </Svg>
  ),
  parking: (p) => (
    <Svg {...p}>
      <rect x="4" y="3" width="16" height="18" rx="3" />
      <path d="M9.5 17V7.5h3.2a2.8 2.8 0 0 1 0 5.6H9.5" />
    </Svg>
  ),
  washrooms: (p) => (
    <Svg {...p}>
      <circle cx="7" cy="5" r="1.6" />
      <circle cx="17" cy="5" r="1.6" />
      <path d="M7 9v11M4.5 9.5h5M17 9l-2.5 8h5L17 9ZM17 17v3" />
    </Svg>
  ),
  changing_room: (p) => (
    <Svg {...p}>
      <path d="M9 4 4 7l2 3 2-1v11h8V9l2 1 2-3-5-3a3 3 0 0 1-6 0Z" />
    </Svg>
  ),
};

function FallbackIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m5 12 4.5 4.5L19 7" />
    </Svg>
  );
}

/** Amenity chips with an icon each. `max` collapses the rest into "+N" (for cards); omit it to show all. */
export function AmenityBadges({
  amenities,
  max,
  size = "sm",
}: {
  amenities: string[] | null | undefined;
  max?: number;
  size?: "sm" | "md";
}) {
  const list = amenities ?? [];
  if (list.length === 0) return null;
  const shown = max != null ? list.slice(0, max) : list;
  const hidden = list.length - shown.length;
  const chip =
    size === "md"
      ? "px-3 py-1.5 text-[13.5px] gap-2 rounded-lg"
      : "px-2 py-1 text-[12px] gap-1.5 rounded-md";

  return (
    <ul className="flex gap-1.5 flex-wrap" aria-label="Amenities" data-testid="amenity-badges">
      {shown.map((key) => {
        const Icon = ICONS[key] ?? FallbackIcon;
        return (
          <li
            key={key}
            className={`inline-flex items-center font-semibold bg-player-accent-soft text-player-accent-hover border border-player-accent-soft-border ${chip}`}
          >
            <Icon className="shrink-0" />
            {amenityLabel(key)}
          </li>
        );
      })}
      {hidden > 0 ? (
        <li
          title={list.slice(shown.length).map(amenityLabel).join(", ")}
          className={`inline-flex items-center font-semibold bg-player-surface-2 text-player-ink-muted ${chip}`}
        >
          +{hidden}
        </li>
      ) : null}
    </ul>
  );
}
