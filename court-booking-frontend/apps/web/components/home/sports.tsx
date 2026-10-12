import Link from "next/link";
import type { ReactNode } from "react";
import { Eyebrow, SectionTitle } from "@/components/site/primitives";
import { getT } from "@/lib/i18n-server";
import type { MessageKey } from "@/lib/i18n";

const searchHref = (sport: string) => `/search?sport=${encodeURIComponent(sport)}`;

const ICON_FUTSAL = (
  <svg width="56" height="56" viewBox="0 0 56 56" fill="none" aria-hidden="true">
    <circle cx="28" cy="28" r="22" stroke="var(--color-khelo-orange)" strokeWidth="3" />
    <path d="M28 14l9 7-3.500 11h-11L19 21z" fill="var(--color-khelo-orange)" />
  </svg>
);
const ICON_PADEL = (
  <svg width="56" height="56" viewBox="0 0 56 56" fill="none" aria-hidden="true">
    <rect x="10" y="6" width="26" height="30" rx="13" stroke="var(--color-khelo-ink)" strokeWidth="3" />
    <path d="M23 36v14" stroke="var(--color-khelo-ink)" strokeWidth="3" strokeLinecap="round" />
    <circle cx="44" cy="40" r="6" fill="var(--color-khelo-ink)" />
  </svg>
);
const ICON_CRICKET = (
  <svg width="56" height="56" viewBox="0 0 56 56" fill="none" aria-hidden="true">
    <rect x="22" y="6" width="12" height="44" rx="6" stroke="white" strokeWidth="3" />
    <circle cx="44" cy="44" r="5" fill="white" />
  </svg>
);

// The design's own copy for its own three sports. Any other sport (only if one of these is ever not supported) gets a neutral line.
const KNOWN_DESC: Record<string, MessageKey> = {
  Futsal: "home.sports.futsal",
  Padel: "home.sports.padel",
  Cricket: "home.sports.cricket",
};
const FALLBACK_DESC: MessageKey = "home.sports.fallback";

// The three look-and-feel slots of the design, in order.
const CARD_STYLES: { box: string; copy: string; icon: ReactNode }[] = [
  { box: "bg-khelo-ink text-white", copy: "text-white/[.72]", icon: ICON_FUTSAL },
  { box: "bg-khelo-orange text-khelo-ink", copy: "opacity-85", icon: ICON_PADEL },
  { box: "bg-khelo-teal text-white", copy: "text-white/[.88]", icon: ICON_CRICKET },
];
const CHIP_TONES = ["bg-khelo-surface text-khelo-ink", "bg-khelo-warm text-khelo-ink", "bg-khelo-mint text-khelo-ink"];

/** `sports` is the real supported list (SPORT_OPTIONS). Featured: Futsal, Padel, Cricket when all exist, else the first three. */
export async function Sports({ sports }: { sports: readonly string[] }) {
  const t = await getT();
  const preferred = ["Futsal", "Padel", "Cricket"].filter((s) => sports.includes(s));
  const featured = preferred.length === 3 ? preferred : sports.slice(0, 3);
  const more = sports.filter((s) => !featured.includes(s));
  return (
    <section id="sports" aria-labelledby="sports-title" className="mx-auto w-full max-w-[1248px] px-6 pb-6 pt-[88px]">
      <Eyebrow>{t("home.sports.eyebrow")}</Eyebrow>
      <SectionTitle id="sports-title" className="mt-3 max-w-[700px]">{t("home.sports.title")}</SectionTitle>
      <div className="mt-10 grid grid-cols-[repeat(auto-fit,minmax(min(280px,100%),1fr))] gap-5">
        {featured.map((sport, i) => {
          const st = CARD_STYLES[i % 3];
          return (
            <Link key={sport} href={searchHref(sport)} className={`khelo-card box-border flex min-h-[260px] flex-col justify-between rounded-[28px] p-8 ${st.box}`}>
              {st.icon}
              <div>
                <div className="font-khelo-display text-[34px] font-extrabold">{sport}</div>
                <div className={`mt-2 leading-[1.5] ${st.copy}`}>{t(KNOWN_DESC[sport] ?? FALLBACK_DESC)}</div>
              </div>
            </Link>
          );
        })}
      </div>
      {more.length > 0 ? (
        <>
          <h3 className="mt-11 text-[20px] font-extrabold">{t("home.sports.more")}</h3>
          <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(min(170px,100%),1fr))] gap-3.5">
            {more.map((sport, i) => (
              <Link key={sport} href={searchHref(sport)} className={`khelo-card flex min-h-11 items-center justify-between gap-2.5 rounded-[20px] p-[22px] text-[18px] font-extrabold ${CHIP_TONES[i % 3]}`}>
                <span>{sport}</span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </Link>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
