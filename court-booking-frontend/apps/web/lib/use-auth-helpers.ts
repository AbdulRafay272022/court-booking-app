"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { UserRole } from "@court-booking/types";
import { useAuthStore } from "./auth-store";

/** Where a freshly signed-in user lands, unless a `next` path says otherwise. */
export function homeForRole(role: UserRole): string {
  if (role === "owner") return "/dashboard/owner/today"; // the owner layout sends a venue-less owner on to setup
  if (role === "admin") return "/dashboard/admin/venues";
  return "/";
}

/** `next` must be a same-site path, never an arbitrary URL (open-redirect guard). */
export function safeNext(next: string | null): string | null {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : null;
}

/** Login/signup/verify have nothing to show a signed-in user: send them home. */
export function useRedirectIfSignedIn() {
  const router = useRouter();
  const status = useAuthStore((s) => s.status);
  const role = useAuthStore((s) => s.user?.role);
  useEffect(() => {
    if (status === "signedIn" && role) router.replace(homeForRole(role));
  }, [status, role, router]);
  return status === "signedIn";
}

/** Live countdown to an absolute time. `null` target = unknown (nothing to count). */
export function useSecondsUntil(targetMs: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (targetMs === null) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [targetMs]);
  return targetMs === null ? null : Math.max(0, Math.ceil((targetMs - now) / 1000));
}

/** The short "you can ask for a new code again in 0:30" cooldown -- separate from the code's
 * own expiry countdown. `restart()` begins a new cooldown. */
export function useCooldown(seconds: number) {
  const [endsAt, setEndsAt] = useState(() => Date.now() + seconds * 1000);
  const left = useSecondsUntil(endsAt) ?? 0;
  const restart = useRef(() => setEndsAt(Date.now() + seconds * 1000));
  return { left, restart: restart.current };
}
