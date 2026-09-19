"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "./auth-store";
import type { UserRole } from "@court-booking/types";

/** Redirects away if the session isn't ready for this page yet. `hydrating` is not
 * an error state -- Providers hasn't finished reading localStorage/calling /auth/me
 * yet, so we render nothing and wait rather than bouncing a legitimately signed-in
 * user to /login on every page load. */
export function useRequireAuth(allowedRoles?: UserRole[]) {
  const router = useRouter();
  const status = useAuthStore((s) => s.status);
  const role = useAuthStore((s) => s.user?.role);

  useEffect(() => {
    if (status === "hydrating") return;
    if (status === "signedOut") {
      router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    if (allowedRoles && role && !allowedRoles.includes(role)) {
      router.replace("/");
    }
  }, [status, role, allowedRoles, router]);

  return { ready: status === "signedIn" && (!allowedRoles || (role && allowedRoles.includes(role))) };
}
