"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { unsubscribePushOnLogout } from "@/lib/web-push";
import { suppressAuthRedirect, useRequireAuth } from "@/lib/use-require-auth";
import { useAuthStore } from "@/lib/auth-store";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { useFeatureFlags } from "@/lib/use-feature-flags";
import { pollInterval } from "@/lib/polling";
import { capCount } from "@/lib/owner-seen";
import { SUPPORT_WHATSAPP_NUMBER, supportWhatsAppUrl } from "@/lib/support";
import { Logo } from "@/components/auth/logo";
import { VenuePicker, VenueStatusBanner } from "@/components/owner/venue-nav";
import { PremiumNotices } from "@/components/owner/premium-notices";
import { CnicBanner } from "@/components/identity/cnic-banner";
import { NotificationBell } from "@/components/site/notification-bell";
import { useT } from "@/components/i18n/lang-provider";
import { useMyPermissions } from "@/lib/use-my-permissions";
import { routeAllowed } from "@/lib/my-permissions";

interface NavItem {
  href: string;
  label: string;
  /** Pending count for the badge (Approvals, Refunds). */
  count?: number;
}

/** A nav entry is active on its own page and on anything below it. */
export function isNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The owner / staff dashboard shell (sidebar on desktop, drawer on phones, bell, nav badges). It lives in a component so that
 * `app/dashboard/owner/layout.tsx` AND the Bookings history page (`/dashboard/bookings`, outside `/dashboard/owner`) share ONE shell:
 * the history page wraps itself in `<OwnerShell>` and its "Bookings" entry is highlighted.
 */
export function OwnerShell({ children }: { children: React.ReactNode }) {
  // Staff accounts (Section 32 Part 12) use the same dashboard with a reduced view.
  const t = useT();
  const { ready } = useRequireAuth(["owner", "staff"]);
  const pathname = usePathname();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const { isOn } = useFeatureFlags();
  const isStaff = user?.role === "staff";
  const { venues: pickerVenues, activeVenue, activeVenueId, setVenueId } = useOwnerVenues();
  const refundsOn = isOn("refunds");

  // Pending counts for the Approvals and Refunds badges. Polled every 15 s; TanStack pauses interval refetching while the tab is hidden.
  const badgesQuery = useQuery({
    queryKey: ["owner-badges", activeVenueId],
    queryFn: () => api.owners.badges(activeVenueId),
    enabled: ready && !!activeVenueId,
    refetchInterval: (query) => pollInterval(query, 15_000),
    refetchOnWindowFocus: true,
  });
  const approvalsCount = badgesQuery.data?.approvals ?? 0;
  const refundsCount = badgesQuery.data?.refunds ?? 0;

  // Nav entries hide when their feature flag is globally off; "Staff" is
  // owner/admin-only (staff can't manage other staff). Per-action permissions
  // are still enforced by the backend if a staff member deep-links.
  // audit 2026-10-28 item 11: a staff member sees (and can open) only the pages their permissions allow, like the app.
  const perms = useMyPermissions();
  const allNav: NavItem[] = [
    { href: "/dashboard/owner/today", label: t("notif.nav.overview") },
    { href: "/dashboard/owner/approvals", label: t("odash.nav.approvals"), count: approvalsCount },
    { href: "/dashboard/owner/walkin", label: t("notif.nav.walkin") },
    { href: "/dashboard/bookings", label: t("notif.nav.bookings") },
    { href: "/dashboard/owner/ledger", label: t("odash.nav.ledger") },
    ...(refundsOn ? [{ href: "/dashboard/owner/refunds", label: t("odash.nav.refunds"), count: refundsCount }] : []),
    ...(isOn("growth_suggestions") ? [{ href: "/dashboard/owner/growth", label: t("odash.nav.growth") }] : []),
    ...(isOn("reviews") ? [{ href: "/dashboard/owner/reviews", label: t("odash.nav.reviews") }] : []),
    { href: "/dashboard/owner/settings", label: t("odash.nav.settings") },
    ...(!isStaff ? [{ href: "/dashboard/owner/staff", label: t("odash.nav.staff") }] : []),
    ...(!isStaff ? [{ href: "/dashboard/owner/premium", label: t("odash.nav.premium") }] : []),
    { href: "/account", label: t("odash.nav.account") },
  ];
  const NAV: NavItem[] = allNav.filter((item) => routeAllowed(item.href, isStaff, (k) => perms.can(k)));
  const blocked = isStaff && !perms.loading && !routeAllowed(pathname, isStaff, (k) => perms.can(k));
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

  async function signOut() {
    // drop this browser's Web Push subscription first (DELETE needs the session); best effort, capped at 2 s
    await unsubscribePushOnLogout(api.users);
    suppressAuthRedirect(); // deliberate sign-out: land on "/", not on /login?next=
    useAuthStore.getState().signOut();
    router.push("/");
  }

  if (!ready) return <div className="min-h-screen bg-owner-bg" />;
  if (!isStaff && pathname === "/dashboard/owner/today" && !venuesQuery.isError && (!venues || !venues.some((v) => v.status === "approved"))) {
    return <div className="min-h-screen bg-owner-bg" />;
  }

  const currentLabel = NAV.find((n) => isNavActive(pathname, n.href))?.label ?? t("odash.nav.dashboard");

  const sidebarBody = (
    <>
      <div className="px-6 py-6 flex flex-col gap-2">
        <Link href="/" aria-label={t("odash.nav.homeAria")} onClick={() => setMenuOpen(false)}>
          <Logo tone="owner" size={34} />
        </Link>
        <p className="text-xs text-owner-ink-faint">{user?.name ?? t("odash.nav.owner")}</p>
      </div>
      <nav className="flex flex-col gap-1 px-3 pb-4" aria-label={t("odash.nav.dashboard")}>
        {NAV.map((item) => {
          const active = isNavActive(pathname, item.href);
          const badge = item.count ? capCount(item.count) : "";
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMenuOpen(false)}
              aria-current={active ? "page" : undefined}
              aria-label={badge ? t("notif.nav.pendingAria", { label: item.label, n: badge }) : undefined}
              data-testid={`nav-${item.href.split("/").pop()}`}
              data-fl-role="owner"
              className={`flex min-h-11 items-center justify-between gap-2 px-3.5 py-2.5 rounded-lg text-[14px] font-semibold focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-owner-accent ${
                active ? "bg-fl-role-tab-active text-fl-role-on-tab-active" : "text-fl-muted hover:bg-fl-ground"
              }`}
            >
              <span>{item.label}</span>
              {badge ? (
                <span
                  data-testid={`nav-badge-${item.href.split("/").pop()}`}
                  aria-hidden="true"
                  className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-fl-role-badge px-1.5 text-[12px] font-extrabold leading-none text-fl-role-on-badge"
                >
                  {badge}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
      <VenuePicker venues={pickerVenues} activeVenueId={activeVenueId} onSelect={setVenueId} />
      <div className="mt-auto p-3 flex flex-col gap-2">
        <a
          href={supportWhatsAppUrl()}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full px-3.5 py-2.5 rounded-lg text-[13.5px] font-semibold text-owner-ink-muted border border-owner-border text-center"
        >
          {t("odash.nav.help", { number: SUPPORT_WHATSAPP_NUMBER })}
        </a>
        <button
          onClick={signOut}
          className="w-full px-3.5 py-2.5 rounded-lg text-[14px] font-semibold text-owner-ink-muted border border-owner-border"
        >
          {t("odash.nav.logout")}
        </button>
      </div>
    </>
  );

  // Phone tab-bar style hint: when the drawer is closed the menu button still tells the owner something is waiting.
  const pendingTotal = approvalsCount + (refundsOn ? refundsCount : 0);

  return (
    <div className="min-h-screen md:flex bg-owner-bg text-owner-ink">
      {/* Mobile top bar (phones/short viewports) -- the desktop sidebar is hidden below md. */}
      <header className="md:hidden sticky top-0 z-30 flex items-center justify-between gap-2 px-4 h-14 bg-owner-surface border-b border-owner-border">
        <Link href="/" aria-label={t("odash.nav.homeAria")}><Logo tone="owner" size={26} /></Link>
        <span className="min-w-0 truncate font-bold text-[15px] text-owner-ink">{currentLabel}</span>
        <div className="flex shrink-0 items-center gap-1.5">
          <NotificationBell tone="light" />
          <button
            aria-label={pendingTotal > 0 ? `${t("odash.nav.openMenu")}, ${t("notif.nav.pendingCount", { n: capCount(pendingTotal) })}` : t("odash.nav.openMenu")}
            onClick={() => setMenuOpen(true)}
            className="relative w-11 h-11 flex items-center justify-center text-owner-ink"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
            </svg>
            {pendingTotal > 0 ? <span aria-hidden="true" data-testid="menu-pending-dot" className="absolute right-1.5 top-1.5 h-3 w-3 rounded-full border-2 border-owner-surface bg-fl-orange" /> : null}
          </button>
        </div>
      </header>

      {/* Mobile drawer */}
      {menuOpen ? (
        <div className="md:hidden fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={t("odash.nav.dashboard")}>
          <div className="absolute inset-0 bg-black/40" onClick={() => setMenuOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[82%] max-w-xs bg-owner-surface border-r border-owner-border flex flex-col overflow-y-auto">
            <div className="flex justify-end p-2">
              <button aria-label={t("odash.nav.closeMenu")} onClick={() => setMenuOpen(false)} className="w-11 h-11 flex items-center justify-center text-owner-ink-muted text-xl">{"✕"}</button>
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
        {/* Desktop top strip: the notifications bell (phones have it in the top bar above). */}
        <div className="hidden md:flex sticky top-0 z-30 h-14 items-center justify-end bg-owner-bg px-8">
          <NotificationBell tone="light" />
        </div>
        {!isStaff ? <PremiumNotices /> : null}
        <CnicBanner />
        {activeVenue ? <VenueStatusBanner venue={activeVenue} /> : null}
        {blocked ? (
          <div className="mx-auto max-w-xl px-6 py-16 text-center" data-testid="staff-no-access" role="alert">
            <h1 className="text-xl font-bold text-owner-ink">{t("odash.noAccess.title")}</h1>
            <p className="mt-2 text-owner-ink-muted">{t("odash.noAccess.body")}</p>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
