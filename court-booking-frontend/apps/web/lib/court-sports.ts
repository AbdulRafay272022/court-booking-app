"use client";

import { useOwnerVenues } from "@/lib/use-owner-venues";

/** Sport lookup for owner screens whose payload carries only a court name or id (today, approvals, refunds, ledger,
 * growth...). The owner's venues already list every court with its sport, so no extra request is needed. Lookup by
 * name is best-effort: names are unique within a venue in practice, and a `venueName` narrows it when given. */
export function useOwnerCourtSports() {
  const { venues, activeVenue } = useOwnerVenues();
  const all = venues.flatMap((v) => v.courts.map((c) => ({ ...c, venueName: v.name, venueId: v.id })));
  return {
    byId: (courtId: string | undefined | null): string | undefined => all.find((c) => c.id === courtId)?.sport,
    byName: (courtName: string, venueName?: string): string | undefined => {
      const inVenue = venueName ? all.filter((c) => c.venueName === venueName) : activeVenue ? all.filter((c) => c.venueId === activeVenue.id) : all;
      const hits = inVenue.filter((c) => c.name === courtName);
      return hits.length === 1 ? hits[0].sport : undefined;
    },
  };
}
