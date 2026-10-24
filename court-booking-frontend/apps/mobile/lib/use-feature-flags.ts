import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { flagOn } from "@/lib/owner-floodlight";

/** Global feature flags (GET /feature-flags, every flag's on/off). Same query key as components/advance-settings.tsx.
 * `on(key)` is true while unknown (loading / error / an older backend without the key): the server still enforces it, the
 * app only hides entry points that are explicitly off. */
export function useFeatureFlags() {
  const q = useQuery({ queryKey: ["public-flags"], queryFn: () => api.featureFlags.publicFlags(), retry: false, staleTime: 5 * 60_000 });
  const flags = (q.data as { flags?: Record<string, boolean> } | undefined)?.flags;
  return { on: (key: string) => flagOn(flags, key), loaded: !!flags };
}
