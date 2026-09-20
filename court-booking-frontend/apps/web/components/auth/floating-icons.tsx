"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

/** Faint sports icons drifting behind the player-facing auth screens. Decoration only:
 * `aria-hidden`, behind the form (z-0 vs the content's z-10), low opacity, and never
 * interactive. Which icons appear and where is randomized on every mount (after
 * hydration, so server and client HTML never disagree); each one then floats on its own
 * independent loop with its own duration/delay so they never move in sync. Only used on
 * signup/login/verify -- deliberately not spread elsewhere. */

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const ICONS: { name: string; body: ReactNode }[] = [
  {
    name: "ball",
    body: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3v18M3 12h18" />
        <path d="M5.6 5.6c3.2 3.2 3.2 9 0 12.8M18.4 5.6c-3.2 3.2-3.2 9 0 12.8" />
      </>
    ),
  },
  {
    name: "trophy",
    body: (
      <>
        <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0z" />
        <path d="M17 5h3v2a3 3 0 01-3 3M7 5H4v2a3 3 0 003 3" />
      </>
    ),
  },
  {
    name: "target",
    body: (
      <>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="5" />
        <circle cx="12" cy="12" r="1" />
      </>
    ),
  },
  {
    name: "runner",
    body: (
      <>
        <circle cx="15" cy="5" r="2" />
        <path d="M13 8l-3 4 3 2.5V20M10 12l-3.5 1M13 14.5l4 1.5M16 9l2.5 2.5" />
      </>
    ),
  },
  { name: "star", body: <path d="M12 2.5l3.1 6.3 6.9 1-5 4.9 1.2 6.9-6.2-3.3-6.2 3.3 1.2-6.9-5-4.9 6.9-1z" /> },
  { name: "shuttle", body: <path d="M9 3l3 8 3-8M8 11h8l-2 6h-4zM10 21h4" /> },
  {
    name: "whistle",
    body: (
      <>
        <path d="M4 10.5a5 5 0 0 1 5-5h5.5l5-2.5-1.5 3.5-2 1h-1a5 5 0 1 1-5 5" />
        <circle cx="9" cy="10.5" r="1.2" />
      </>
    ),
  },
  {
    name: "stopwatch",
    body: (
      <>
        <circle cx="12" cy="13.5" r="8" />
        <path d="M12 13.5V9M9.5 2.5h5M12 2.5v2.3" />
      </>
    ),
  },
  {
    name: "medal",
    body: (
      <>
        <path d="M8.3 3l2.4 6.2M15.7 3l-2.4 6.2" />
        <circle cx="12" cy="15.2" r="5.8" />
        <path d="M12 12.3v2.9l2 1.2" />
      </>
    ),
  },
  {
    name: "racket",
    body: (
      <>
        <circle cx="9.5" cy="9" r="6" />
        <path d="M9.5 3.4v11.2M3.9 9h11.2" />
        <path d="M13.7 13.2L21 20.5" />
      </>
    ),
  },
  { name: "flag", body: <path d="M6 21V3.5M6 4h12.5l-3 4 3 4H6" /> },
  {
    name: "cone",
    body: (
      <>
        <path d="M12 3l4.2 15.5H7.8L12 3z" />
        <path d="M9.3 11.8h5.4M7.6 17.7h8.8" />
      </>
    ),
  },
];

/** Owner-facing background: deliberately different shapes from the player set above (not a
 * recolor of the same sport icons) -- business/venue-management-adjacent instead. */
export const OWNER_ICONS: { name: string; body: ReactNode }[] = [
  {
    name: "building",
    body: (
      <>
        <rect x="5" y="3" width="14" height="18" rx="1" />
        <path d="M9 7h1.4M13.6 7H15M9 11h1.4M13.6 11H15M9 15h1.4M13.6 15H15" />
      </>
    ),
  },
  {
    name: "calendar",
    body: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </>
    ),
  },
  { name: "chart", body: <path d="M4 20V10M10 20V4M16 20v-7M3 20h18" /> },
  {
    name: "pin",
    body: (
      <>
        <path d="M12 21s7-7.6 7-12.2A7 7 0 1 0 5 8.8C5 13.4 12 21 12 21z" />
        <circle cx="12" cy="8.6" r="2.3" />
      </>
    ),
  },
  {
    name: "clipboard",
    body: (
      <>
        <rect x="6" y="4" width="12" height="17" rx="2" />
        <rect x="9" y="2" width="6" height="3" rx="1" />
        <path d="M9 11.5h6M9 15.5h6" />
      </>
    ),
  },
  {
    name: "clock",
    body: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3.3 2" />
      </>
    ),
  },
];

interface Placed {
  key: string;
  icon: (typeof ICONS)[number];
  left: number;
  top: number;
  size: number;
  opacity: number;
  dx: number;
  dy: number;
  r0: number;
  r1: number;
  dur: number;
  delay: number;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generate(iconSet: { name: string; body: ReactNode }[]): Placed[] {
  // 8-10 -- "well beyond the original 4-6" (Section 30 Part 1): more than the 3x3 grid has
  // cells, so cells repeat (jitter + independent placement within each cell keeps duplicates
  // from visibly overlapping) and, for the smaller owner set, icons repeat too.
  const count = 8 + Math.floor(Math.random() * 3); // 8-10
  const cells = Array.from({ length: count }, () => Math.floor(Math.random() * 9));
  const icons = shuffle([...iconSet, ...iconSet]).slice(0, count);
  return cells.map((cell, i) => ({
    key: `${icons[i].name}-${cell}-${i}`,
    icon: icons[i],
    left: (cell % 3) * 33.3 + rand(2, 24),
    top: Math.floor(cell / 3) * 33.3 + rand(2, 24),
    size: Math.round(rand(40, 82)),
    opacity: rand(0.1, 0.19),
    dx: rand(-22, 22),
    dy: rand(-26, 26),
    r0: rand(-14, 14),
    r1: rand(-14, 14),
    dur: rand(7, 15),
    delay: -rand(0, 12), // negative: already mid-loop on first paint, and out of sync
  }));
}

/** `icons` defaults to the player sport set; pass `OWNER_ICONS` for the owner tone (a
 * distinct icon set, not a recolor of the same shapes -- Section 30 Part 2). */
export function FloatingIcons({ color, icons = ICONS }: { color: string; icons?: { name: string; body: ReactNode }[] }) {
  const [items, setItems] = useState<Placed[]>([]);
  useEffect(() => {
    setItems(generate(icons));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      {items.map((it) => (
        <svg
          key={it.key}
          viewBox="0 0 24 24"
          width={it.size}
          height={it.size}
          {...STROKE}
          className="maidan-float absolute"
          style={
            {
              left: `${it.left}%`,
              top: `${it.top}%`,
              color,
              opacity: it.opacity,
              "--dx": `${it.dx}px`,
              "--dy": `${it.dy}px`,
              "--r0": `${it.r0}deg`,
              "--r1": `${it.r1}deg`,
              "--dur": `${it.dur}s`,
              "--delay": `${it.delay}s`,
            } as CSSProperties
          }
        >
          {it.icon.body}
        </svg>
      ))}
    </div>
  );
}
