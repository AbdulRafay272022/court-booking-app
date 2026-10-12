import { KheloPage } from "@/components/site/page-shell";
import { getT } from "@/lib/i18n-server";
import { VenueCardSkeleton } from "@/components/discovery/venue-card";

/** Shown while a fresh load waits on the venue list: the title band, a bar-shaped placeholder and 6 cards. */
export default async function SearchLoading() {
  const t = await getT();
  return (
    <KheloPage app>
      <div aria-busy="true" role="status" aria-label={t("search.loading.label")}>
        <div className="bg-khelo-ink text-white">
          <div className="mx-auto w-full max-w-[1288px] px-6 pb-[30px] pt-7">
            <div className="text-[12px] font-extrabold uppercase tracking-[1.5px] text-khelo-orange">{t("search.findCourt")}</div>
            <div className="mt-3 h-10 w-64 max-w-full animate-pulse rounded-lg bg-white/10" />
          </div>
        </div>
        <div className="border-b border-khelo-divider bg-khelo-surface">
          <div className="mx-auto flex w-full max-w-[1288px] gap-2.5 overflow-hidden px-6 py-3.5">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="h-11 w-28 shrink-0 animate-pulse rounded-full bg-khelo-divider" />
            ))}
          </div>
        </div>
        <div className="mx-auto w-full max-w-[1288px] px-6 pb-[72px] pt-7">
          <div className="h-6 w-28 animate-pulse rounded bg-khelo-divider" />
          <div className="mt-[22px] grid grid-cols-[repeat(auto-fill,minmax(min(280px,100%),1fr))] gap-[22px]">
            {Array.from({ length: 6 }, (_, i) => (
              <VenueCardSkeleton key={i} />
            ))}
          </div>
        </div>
      </div>
    </KheloPage>
  );
}
