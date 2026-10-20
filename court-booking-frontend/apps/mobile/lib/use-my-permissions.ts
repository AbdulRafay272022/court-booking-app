import { useQuery } from "@tanstack/react-query";
import type { StaffPermissionKey } from "@court-booking/types";

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { permissionAllows } from "@/lib/overview";
import { useOwnerVenues } from "@/lib/use-owner-venues";

/** Stage 2 (B.b): what this account may do per venue (GET /owners/me/permissions), so staff never see a button they are
 * not allowed to press. Unknown (loading, older backend, error) counts as allowed; the 403 handling stays as the
 * fallback. Decided by the response's own `role`, so an owner simply gets everything. */
export function useMyPermissions() {
  const role = useAuthStore((s) => s.user?.role);
  const { activeVenueId } = useOwnerVenues();
  const query = useQuery({
    queryKey: ["my-permissions"],
    queryFn: () => api.owners.myPermissions(),
    enabled: !!role && role !== "player",
    staleTime: 60_000,
    retry: false,
  });
  return {
    can: (key: StaffPermissionKey, venueId: string | undefined = activeVenueId) => permissionAllows(query.data, venueId, key),
    isStaff: (query.data as { role?: string } | undefined)?.role === "staff",
    /** The answer is in (or failed, or not needed): screens wait for this so a staff member never sees a button flash. */
    settled: !!role && (query.fetchStatus === "idle" || !query.isPending),
  };
}
