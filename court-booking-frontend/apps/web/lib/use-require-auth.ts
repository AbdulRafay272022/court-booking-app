"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "./auth-store";
import type { UserRole } from "@court-booking/types";

/** Redirects away if the session isn't ready for this page yet. `hydrating` is not
 * an error state -- Providers hasn't finished reading localStorage/calling /auth/me
 * yet, so we render nothing and wait rather than bouncing a legitimately signed-in
 * user to /login on every page load. */
let suppressUntil = 0;

/** Call right before a DELIBERATE local sign-out that navigates somewhere specific (phone change,
 * password reset from inside the app): otherwise this hook's own "you're signed out -> /login?next="
 * redirect races the caller's redirect and wins, dropping the explanatory notice. */
export function suppressAuthRedirect(ms = 3000): void {
  suppressUntil = Date.now() + ms;
}

export function useRequireAuth(allowedRoles?: UserRole[]) {
  const router = useRouter();
  const status = useAuthStore((s) => s.status);
  const role = useAuthStore((s) => s.user?.role);

  useEffect(() => {
    if (status === "hydrating") return;
    if (status === "signedOut") {
      if (Date.now() < suppressUntil) return;
      router.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    if (allowedRoles && role && !allowedRoles.includes(role)) {
      router.replace("/");
    }
  }, [status, role, allowedRoles, router]);

  return { ready: status === "signedIn" && (!allowedRoles || (role && allowedRoles.includes(role))) };
}
