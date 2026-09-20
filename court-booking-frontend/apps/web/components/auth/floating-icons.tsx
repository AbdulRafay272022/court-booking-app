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

function generate(): Placed[] {
  const count = 4 + Math.floor(Math.random() * 3); // 4-6
  // 3x3 grid of cells, one icon per chosen cell (with jitter), so they spread out
  // instead of clumping wherever Math.random happens to land.
  const cells = shuffle(Array.from({ length: 9 }, (_, i) => i)).slice(0, count);
  const icons = shuffle(ICONS).slice(0, count);
  return cells.map((cell, i) => ({
    key: `${icons[i].name}-${cell}`,
    icon: icons[i],
    left: (cell % 3) * 33.3 + rand(2, 24),
    top: Math.floor(cell / 3) * 33.3 + rand(2, 24),
    size: Math.round(rand(44, 84)),
    opacity: rand(0.07, 0.14),
    dx: rand(-22, 22),
    dy: rand(-26, 26),
    r0: rand(-14, 14),
    r1: rand(-14, 14),
    dur: rand(7, 15),
    delay: -rand(0, 12), // negative: already mid-loop on first paint, and out of sync
  }));
}

export function FloatingIcons({ color }: { color: string }) {
  const [items, setItems] = useState<Placed[]>([]);
  useEffect(() => {
    setItems(generate());
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
