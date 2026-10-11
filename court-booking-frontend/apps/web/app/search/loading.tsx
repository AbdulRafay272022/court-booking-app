import { SiteHeader } from "@/components/nav-auth";
import { VenueCardSkeleton } from "@/components/discovery/venue-card";

export default function SearchLoading() {
  return (
    <>
      <SiteHeader />
      <main className="px-6 md:px-14 py-10 flex flex-col gap-7" aria-busy="true">
        <div className="h-8 w-64 rounded bg-player-surface-2 animate-pulse" />
        <div className="h-44 rounded-2xl bg-player-surface-2 animate-pulse" />
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }, (_, i) => (
            <VenueCardSkeleton key={i} />
          ))}
        </div>
      </main>
    </>
  );
}
