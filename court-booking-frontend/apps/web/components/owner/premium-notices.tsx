"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

const STYLE = {
  info: { bg: "#E7F2F5", fg: "#0E6274", border: "#BFDDE5" },
  urgent: { bg: "#FBF0DD", fg: "#8A5208", border: "#EBCB93" },
  off: { bg: "#F9E3E1", fg: "#A32018", border: "#EDB5B0" },
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
