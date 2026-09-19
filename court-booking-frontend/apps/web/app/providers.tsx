"use client";

import { useEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import { useAuthStore } from "@/lib/auth-store";
import { api } from "@/lib/api";
import { OfflineBanner } from "@/components/offline-banner";

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    useAuthStore.getState().hydrate();
    const token = useAuthStore.getState().token;
    if (!token) return;
    (async () => {
      try {
        const { user, session } = await api.auth.me();
        useAuthStore.getState().setUser(user, session);
      } catch {
        useAuthStore.getState().markUnverified();
      }
    })();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <OfflineBanner />
      {children}
    </QueryClientProvider>
  );
}
