import type { PublicStats } from "@court-booking/types";
import { Container } from "@/components/site/primitives";
import { getT } from "@/lib/i18n-server";

/** The real platform counts, exact. The caller decides whether there is anything worth showing. */
export async function StatsStrip({ stats }: { stats: PublicStats }) {
  const t = await getT();
  const items = [
    { n: stats.venues, l: t("home.stats.venues") },
    { n: stats.courts, l: t("home.stats.courts") },
    { n: stats.bookings, l: t("home.stats.bookings") },
    { n: stats.players, l: t("home.stats.players") },
  ];
  return (
    <section aria-label={t("home.stats.label")} className="relative -mt-[52px]">
      <Container>
        <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-6 rounded-[28px] bg-khelo-surface px-7 py-[34px] shadow-[0_24px_60px_rgba(12,31,29,.14)]">
          {items.map((it) => (
            <div key={it.l} className="flex flex-col-reverse text-center">
              <dt className="mt-2 text-[14px] font-bold tracking-[.5px] text-khelo-teal">{it.l}</dt>
              <dd className="m-0 font-khelo-display text-[52px] font-extrabold leading-none tracking-[-1.5px] text-khelo-ink">{it.n}</dd>
            </div>
          ))}
        </dl>
      </Container>
    </section>
  );
}
