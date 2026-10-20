"use client";

import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { permissionAllows, type StaffPermission } from "@/lib/my-permissions";

export { ACTION_PERMISSION, type StaffPermission } from "@/lib/my-permissions";

/**
 * Stage 2 (B.b): what this account may do per venue (GET /owners/me/permissions, cached for the session), so owner screens hide
 * buttons a staff member cannot use instead of answering with a 403 after the tap. Owners and admins can do everything.
 * `can(key, venueId?)` defaults to the venue selected in the dashboard. The 403 fallbacks on each screen stay as they are.
 */
export function useMyPermissions() {
  const user = useAuthStore((s) => s.user);
  const status = useAuthStore((s) => s.status);
  const signedIn = status === "signedIn" && !!user;
  const role = user?.role;
  const { activeVenueId } = useOwnerVenues();
  const query = useQuery({
    queryKey: ["my-permissions", user?.id],
    queryFn: () => api.owners.myPermissions(),
    enabled: signedIn && role === "staff",
    staleTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const qStatus = query.isError ? "error" : query.data ? "success" : "pending";
  const data = query.data;
  const can = useCallback(
    (key: StaffPermission, venueId?: string) => permissionAllows(role, data, qStatus, venueId ?? activeVenueId, key),
    [role, data, qStatus, activeVenueId],
  );
  return { can, loading: role === "staff" && qStatus === "pending" };
}
