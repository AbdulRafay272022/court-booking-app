"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";

export function useOwnerVenues() {
  const query = useQuery({ queryKey: ["owner-venues"], queryFn: () => api.owners.venues() });
  const [venueId, setVenueId] = useState<string | undefined>(undefined);
  const venues = query.data ?? [];
  const activeVenueId = venueId ?? venues[0]?.id;
  const activeVenue = venues.find((v) => v.id === activeVenueId);
  return { venues, activeVenue, activeVenueId, setVenueId, showSwitcher: venues.length > 1, isLoading: query.isLoading };
}
