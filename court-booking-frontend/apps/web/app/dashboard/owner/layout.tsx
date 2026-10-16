"use client";

import { OwnerShell } from "@/components/owner/owner-shell";

export default function OwnerDashboardLayout({ children }: { children: React.ReactNode }) {
  return <OwnerShell>{children}</OwnerShell>;
}
