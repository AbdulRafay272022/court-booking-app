"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

const STYLE = {
  info: { bg: "var(--color-fl-teal-tint)", fg: "var(--color-fl-teal-deep)", border: "var(--color-fl-teal-half)" },
  urgent: { bg: "var(--color-fl-waiting-tint)", fg: "var(--color-fl-waiting)", border: "var(--color-fl-waiting-border)" },
  off: { bg: "var(--color-fl-danger-tint)", fg: "var(--color-fl-danger)", border: "var(--color-fl-danger-border)" },
} as const;

/** Banners about premium payments at the top of the owner dashboard: a period ending within a week, an overdue payment
 * (it still works for a few more days), or a feature that has switched off. Nothing shows while billing is not enforced. */
export function PremiumNotices() {
  const query = useQuery({ queryKey: ["owner-premium-notices"], queryFn: () => api.premium.notices(), staleTime: 5 * 60_000, retry: false });
  const notices = query.data ?? [];
  if (notices.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 px-4 sm:px-8 pt-4 sm:pt-6" data-testid="premium-notices">
      {notices.map((n) => {
        const c = STYLE[n.level];
        return (
          <Link
            key={n.feature_key}
            href="/dashboard/owner/premium"
            className="block rounded-lg px-4 py-3 text-[13.5px] font-semibold"
            style={{ background: c.bg, color: c.fg, border: `1px solid ${c.border}` }}
          >
            {n.message}
          </Link>
        );
      })}
    </div>
  );
}
