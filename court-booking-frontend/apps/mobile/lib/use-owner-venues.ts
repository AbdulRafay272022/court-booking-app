import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { useSelectedVenueStore } from "@/lib/selected-venue";

/** Shared across owner dashboard screens: fetches the owner's venues and tracks which one is being
 * managed. The selection is ONE shared value (lib/selected-venue.ts), so switching on Today also
 * switches Approvals, Ledger, Walk-in and Growth -- and it's remembered per owner. Section 8.2: only
 * show a switcher when there's more than one. */
export function useOwnerVenues() {
  const query = useQuery({ queryKey: ["owner-venues"], queryFn: () => api.owners.venues() });
  const userId = useAuthStore((s) => s.user?.id);
  const saved = useSelectedVenueStore((s) => (userId ? s.byUser[userId] : undefined));
  const select = useSelectedVenueStore((s) => s.select);

  const venues = query.data ?? [];
  // Saved choice if it still exists; otherwise a live (approved) venue -- venues[0] may still be
  // under review or rejected.
  const activeVenue = venues.find((v) => v.id === saved) ?? venues.find((v) => v.status === "approved") ?? venues[0];

  return {
    venues,
    activeVenue,
    activeVenueId: activeVenue?.id,
    setVenueId: (venueId: string) => {
      if (userId) select(userId, venueId);
    },
    showSwitcher: venues.length > 1,
    isLoading: query.isLoading,
  };
}
