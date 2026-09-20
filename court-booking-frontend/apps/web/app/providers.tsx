"use client";

import { useEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { REFRESH_CHECK_INTERVAL_MS, restoreSession, shouldRefreshSoon } from "@court-booking/api-client";
import { queryClient } from "@/lib/query-client";
import { useAuthStore } from "@/lib/auth-store";
import { api } from "@/lib/api";
import { OfflineBanner } from "@/components/offline-banner";
import { SessionUnreachable } from "@/components/session-unreachable";

/** Confirms the stored session on page load. A flaky network is retried and, failing
 * that, does NOT sign the user out (only a real 401 does) -- see restoreSession. */
async function restore(): Promise<void> {
  useAuthStore.getState().hydrate();
  if (!useAuthStore.getState().token) return;
  const result = await restoreSession(() => api.auth.me());
  if (result.kind === "ok") useAuthStore.getState().setUser(result.data.user, result.data.session);
  else if (result.kind === "unreachable") useAuthStore.getState().markUnreachable();
  // "unauthorized": the api client already signed out (its 401 -> refresh -> onUnauthorized path).
}

export function Providers({ children }: { children: React.ReactNode }) {
  const status = useAuthStore((s) => s.status);

  useEffect(() => {
    void restore();
  }, []);

  // Proactive refresh (Section 26): sessions last 8h, so renew BEFORE expiry -- when the tab
  // regains focus and on a timer -- instead of waiting for a 401 (by then it's too late).
  useEffect(() => {
    let running = false;
    async function maybeRefresh() {
      const { status, expiresAt } = useAuthStore.getState();
      if (running || status !== "signedIn" || !shouldRefreshSoon(expiresAt)) return;
      running = true;
      try {
        await api.client.refreshSession();
      } finally {
        running = false;
      }
    }
    const onVisible = () => {
      if (document.visibilityState === "visible") void maybeRefresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", maybeRefresh);
    const timer = window.setInterval(maybeRefresh, REFRESH_CHECK_INTERVAL_MS);
    void maybeRefresh();
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", maybeRefresh);
      window.clearInterval(timer);
    };
  }, [status]);

  return (
    <QueryClientProvider client={queryClient}>
      <OfflineBanner />
      {status === "unreachable" ? <SessionUnreachable onRetry={() => void restore()} /> : children}
    </QueryClientProvider>
  );
}
