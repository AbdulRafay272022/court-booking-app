import { useQuery } from "@tanstack/react-query";
import { isFeatureOn, type FeatureFlagKey } from "@court-booking/types";
import { api } from "@/lib/api";

/** Reads the public feature-flag map (GET /feature-flags) so the UI can hide
 * entry points for globally-disabled features. Fail-open: while loading, or if a
 * key is absent, a feature is treated as ON (the backend still enforces it). */
export function useFeatureFlags() {
  const query = useQuery({
    queryKey: ["feature-flags"],
    queryFn: () => api.featureFlags.publicFlags(),
    staleTime: 60_000,
  });
  const flags = query.data?.flags;
  return {
    flags,
    isLoading: query.isLoading,
    isOn: (key: FeatureFlagKey) => isFeatureOn(flags, key),
  };
}
