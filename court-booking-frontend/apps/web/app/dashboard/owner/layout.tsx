"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useRequireAuth } from "@/lib/use-require-auth";
import { useAuthStore } from "@/lib/auth-store";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { useFeatureFlags } from "@/lib/use-feature-flags";
import { SUPPORT_WHATSAPP_NUMBER, supportWhatsAppUrl } from "@/lib/support";
import { Logo } from "@/components/auth/logo";
import { VenuePicker, VenueStatusBanner } from "@/components/owner/venue-nav";

export default function OwnerDashboardLayout({ children }: { children: React.ReactNode }) {
  // Staff accounts (Section 32 Part 12) use the same dashboard with a reduced view.
  const { ready } = useRequireAuth(["owner", "staff"]);
  const pathname = usePathname();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const { isOn } = useFeatureFlags();
  const isStaff = user?.role === "staff";

  // Nav entries hide when their feature flag is globally off; "Staff" is
  // owner/admin-only (staff can't manage other staff). Per-action permissions
  // are still enforced by the backend if a staff member deep-links.
  const NAV = [
    { href: "/dashboard/owner/today", label: "Today" },
    { href: "/dashboard/owner/approvals", label: "Approvals" },
    { href: "/dashboard/owner/walkin", label: "Add booking" },
    { href: "/dashboard/owner/ledger", label: "Ledger" },
    ...(isOn("refunds") ? [{ href: "/dashboard/owner/refunds", label: "Refunds to pay" }] : []),
    ...(isOn("growth_suggestions") ? [{ href: "/dashboard/owner/growth", label: "Growth" }] : []),
    ...(isOn("reviews") ? [{ href: "/dashboard/owner/reviews", label: "Reviews" }] : []),
    { href: "/dashboard/owner/settings", label: "Venue settings" },
    ...(!isStaff ? [{ href: "/dashboard/owner/staff", label: "Staff" }] : []),
    { href: "/account", label: "Account" },
  ];
  const { venues: pickerVenues, activeVenue, activeVenueId, setVenueId } = useOwnerVenues();
  // Section 32 Part 11: on a phone the sidebar becomes a slide-in drawer.
  const [menuOpen, setMenuOpen] = useState(false);

  const venuesQuery = useQuery({ queryKey: ["owner-venues"], queryFn: () => api.owners.venues(), enabled: ready });
  const venues = venuesQuery.data;
  useEffect(() => {
    if (isStaff || !venues || pathname !== "/dashboard/owner/today") return;
    if (venues.length === 0) {
      router.replace("/venue-setup/register");
      return;
    }
    if (venues.some((v) => v.status === "approved")) return;
    const target =
      venues.find((v) => v.status === "pending" || v.status === "changes_requested") ??
      venues.find((v) => v.status === "rejected") ??
      venues[0];
    router.replace(`/venue-setup/status?venueId=${target.id}`);
  }, [venues, pathname, router, isStaff]);

  function signOut() {
    useAuthStore.getState().signOut();
    router.push("/");
  }

  if (!ready) return <div className="min-h-screen bg-owner-bg" />;
  if (!isStaff && pathname === "/dashboard/owner/today" && !venuesQuery.isError && (!venues || !venues.some((v) => v.status === "approved"))) {
    return <div className="min-h-screen bg-owner-bg" />;
  }

  const currentLabel = NAV.find((n) => n.href === pathname)?.label ?? "Dashboard";

  const sidebarBody = (
    <>
      <div className="px-6 py-6 flex flex-col gap-2">
        <Link href="/" aria-label="Maidan home" onClick={() => setMenuOpen(false)}>
          <Logo tone="owner" size={34} />
        </Link>
        <p className="text-xs text-owner-ink-faint">{user?.name ?? "Owner"}</p>
      </div>
      <nav className="flex flex-col gap-1 px-3 pb-4">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setMenuOpen(false)}
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
          className="w-full px-3.5 py-2.5 rounded-lg text-[13.5px] font-semibold text-owner-ink-muted border border-owner-border text-center"
        >
          Need help? WhatsApp us at {SUPPORT_WHATSAPP_NUMBER}
        </a>
        <button
          onClick={signOut}
          className="w-full px-3.5 py-2.5 rounded-lg text-[14px] font-semibold text-owner-ink-muted border border-owner-border"
        >
          Log out
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen md:flex bg-owner-bg text-owner-ink">
      {/* Mobile top bar (phones/short viewports) -- the desktop sidebar is hidden below md. */}
      <header className="md:hidden sticky top-0 z-30 flex items-center justify-between px-4 h-14 bg-owner-surface border-b border-owner-border">
        <Link href="/" aria-label="Maidan home"><Logo tone="owner" size={26} /></Link>
        <span className="font-bold text-[15px] text-owner-ink">{currentLabel}</span>
        <button
          aria-label="Open menu"
          onClick={() => setMenuOpen(true)}
          className="w-10 h-10 -mr-2 flex items-center justify-center text-owner-ink"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
      </header>

      {/* Mobile drawer */}
      {menuOpen ? (
        <div className="md:hidden fixed inset-0 z-40" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMenuOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[82%] max-w-xs bg-owner-surface border-r border-owner-border flex flex-col overflow-y-auto">
            <div className="flex justify-end p-2">
              <button aria-label="Close menu" onClick={() => setMenuOpen(false)} className="w-9 h-9 flex items-center justify-center text-owner-ink-muted text-xl">✕</button>
            </div>
            {sidebarBody}
          </div>
        </div>
      ) : null}

      {/* Desktop sidebar: its own scroll so a short viewport never clips the footer (Part 11). */}
      <aside className="hidden md:flex w-60 shrink-0 bg-owner-surface border-r border-owner-border flex-col md:sticky md:top-0 md:h-screen md:overflow-y-auto">
        {sidebarBody}
      </aside>

      <div className="flex-1 min-w-0">
        {activeVenue ? <VenueStatusBanner venue={activeVenue} /> : null}
        {children}
      </div>
    </div>
  );
}
