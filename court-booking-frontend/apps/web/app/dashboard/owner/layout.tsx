"use client";

import Link from "next/link";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useRequireAuth } from "@/lib/use-require-auth";
import { useAuthStore } from "@/lib/auth-store";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { SUPPORT_WHATSAPP_NUMBER, supportWhatsAppUrl } from "@/lib/support";
import { Logo } from "@/components/auth/logo";
import { VenuePicker, VenueStatusBanner } from "@/components/owner/venue-nav";

const NAV = [
  { href: "/dashboard/owner/today", label: "Today" },
  { href: "/dashboard/owner/approvals", label: "Approvals" },
  { href: "/dashboard/owner/walkin", label: "Add booking" },
  { href: "/dashboard/owner/ledger", label: "Ledger" },
  { href: "/dashboard/owner/growth", label: "Growth" },
  { href: "/account", label: "Account" },
];

export default function OwnerDashboardLayout({ children }: { children: React.ReactNode }) {
  const { ready } = useRequireAuth(["owner"]);
  const pathname = usePathname();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const { venues: pickerVenues, activeVenue, activeVenueId, setVenueId } = useOwnerVenues();

  // Owner gate (mirrors mobile's (owner)/index.tsx): the first landing spot, Today, sends an
  // owner with no live venue to onboarding instead of an empty dashboard. Other owner pages
  // (e.g. Add booking, which pending venues are encouraged to use) stay reachable.
  const venuesQuery = useQuery({ queryKey: ["owner-venues"], queryFn: () => api.owners.venues(), enabled: ready });
  const venues = venuesQuery.data;
  useEffect(() => {
    if (!venues || pathname !== "/dashboard/owner/today") return;
    if (venues.length === 0) {
      router.replace("/venue-setup/register");
      return;
    }
    if (venues.some((v) => v.status === "approved")) return;
    // Nothing live: show the most actionable venue (one under review or needing changes before
    // a rejected one), so a second, rejected attempt doesn't hide the one still in review.
    const target =
      venues.find((v) => v.status === "pending" || v.status === "changes_requested") ??
      venues.find((v) => v.status === "rejected") ??
      venues[0];
    router.replace(`/venue-setup/status?venueId=${target.id}`);
  }, [venues, pathname, router]);

  if (!ready) return <div className="min-h-screen bg-owner-bg" />;
  if (pathname === "/dashboard/owner/today" && !venuesQuery.isError && (!venues || !venues.some((v) => v.status === "approved"))) {
    // Deciding where to send them (or about to redirect): don't flash an empty dashboard.
    return <div className="min-h-screen bg-owner-bg" />;
  }

  return (
    <div className="min-h-screen flex bg-owner-bg text-owner-ink">
      <aside className="w-60 shrink-0 bg-owner-surface border-r border-owner-border flex flex-col">
        <div className="px-6 py-6 flex flex-col gap-2">
          <Link href="/" aria-label="Maidan home">
            <Logo tone="owner" size={34} />
          </Link>
          <p className="text-xs text-owner-ink-faint">{user?.name ?? "Owner"}</p>
        </div>
        <nav className="flex flex-col gap-1 px-3 pb-4">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="px-3.5 py-2.5 rounded-lg text-[14px] font-semibold"
              style={{
                background: pathname === item.href ? "#EBF2F4" : "transparent",
                color: pathname === item.href ? "#0E6274" : "#5B7079",
              }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <VenuePicker venues={pickerVenues} activeVenueId={activeVenueId} onSelect={setVenueId} />
        <div className="mt-auto p-3 flex flex-col gap-2">
          <a
            href={supportWhatsAppUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full px-3.5 py-2.5 rounded-lg text-[14px] font-semibold text-owner-ink-muted border border-owner-border text-center"
          >
            Need help? WhatsApp us at {SUPPORT_WHATSAPP_NUMBER}
          </a>
          <button
            onClick={() => {
              useAuthStore.getState().signOut();
              router.push("/");
            }}
            className="w-full px-3.5 py-2.5 rounded-lg text-[14px] font-semibold text-owner-ink-muted border border-owner-border"
          >
            Log out
          </button>
        </div>
      </aside>
      <div className="flex-1 min-w-0">
        {activeVenue ? <VenueStatusBanner venue={activeVenue} /> : null}
        {children}
      </div>
    </div>
  );
}
