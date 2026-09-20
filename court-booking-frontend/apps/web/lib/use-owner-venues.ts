"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { useSelectedVenueStore } from "@/lib/selected-venue";

/** The owner's venues plus the ONE venue currently being managed (shared across every dashboard
 * screen and remembered per owner -- see lib/selected-venue.ts). */
export function useOwnerVenues() {
  const query = useQuery({ queryKey: ["owner-venues"], queryFn: () => api.owners.venues() });
  const userId = useAuthStore((s) => s.user?.id);
  const saved = useSelectedVenueStore((s) => (userId ? s.byUser[userId] : undefined));
  const select = useSelectedVenueStore((s) => s.select);

  const venues = query.data ?? [];
  // Saved choice if it still exists; otherwise a live (approved) venue -- venues[0] may still be
  // under review or rejected.
  const activeVenue = venues.find((v) => v.id === saved) ?? venues.find((v) => v.status === "approved") ?? venues[0];
  const activeVenueId = activeVenue?.id;

  return {
    venues,
    activeVenue,
    activeVenueId,
    setVenueId: (venueId: string) => {
      if (userId) select(userId, venueId);
    },
    showSwitcher: venues.length > 1,
    isLoading: query.isLoading,
  };
}
