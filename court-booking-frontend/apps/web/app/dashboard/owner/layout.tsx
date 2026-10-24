"use client";

import { OwnerShell } from "@/components/owner/owner-shell";
import { FlRoleProvider } from "@/components/fl/role";

export default function OwnerDashboardLayout({ children }: { children: React.ReactNode }) {
  // Floodlight role theme by route: every owner dashboard page is the teal owner role (context only, no DOM).
  return (
    <FlRoleProvider role="owner">
      <OwnerShell>{children}</OwnerShell>
    </FlRoleProvider>
  );
}
