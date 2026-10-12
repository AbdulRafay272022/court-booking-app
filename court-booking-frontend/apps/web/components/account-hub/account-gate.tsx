"use client";

import type { ReactNode } from "react";
import { useRequireAuth } from "@/lib/use-require-auth";
import { useAuthStore } from "@/lib/auth-store";
import { useT } from "@/components/i18n/lang-provider";
import { Container } from "@/components/site/primitives";

/** Renders the account pages only for a signed-in user (the auth hook redirects everyone else to /login). */
export function AccountGate({ children }: { children: ReactNode }) {
  const t = useT();
  const { ready } = useRequireAuth();
  const user = useAuthStore((s) => s.user);
  if (!ready || !user) {
    return (
      <Container className="py-10">
        <div role="status" aria-label={t("account.loading")} className="h-40 animate-pulse rounded-3xl bg-khelo-divider" />
      </Container>
    );
  }
  return <>{children}</>;
}
