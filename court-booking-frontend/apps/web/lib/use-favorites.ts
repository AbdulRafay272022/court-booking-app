"use client";

import { useQuery } from "@tanstack/react-query";
import type { VenueSummary } from "@court-booking/types";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";

export const FAVORITES_KEY = ["favorites"] as const;

/**
 * The signed-in player's saved venues. One shared query: every heart on a page and the dashboard strip read the same
 * cached list, so they always agree. Only players can save venues; for anyone else (signed out, owner, admin) the query
 * stays off and `enabled` is false so the UI can hide or redirect instead.
 */
export function useFavorites() {
  const status = useAuthStore((s) => s.status);
  const role = useAuthStore((s) => s.user?.role);
  const enabled = status === "signedIn" && role === "player";
  const query = useQuery<VenueSummary[]>({ queryKey: FAVORITES_KEY, queryFn: () => api.favorites.list(), enabled });
  const venues = query.data ?? [];
  return {
    /** Signed-in player: hearts are live. */
    enabled,
    /** Still waiting on the first load (hearts show unsaved until it lands). */
    loading: enabled && query.isLoading,
    venues,
    ids: new Set(venues.map((v) => v.id)),
    isError: query.isError,
    refetch: query.refetch,
  };
}
