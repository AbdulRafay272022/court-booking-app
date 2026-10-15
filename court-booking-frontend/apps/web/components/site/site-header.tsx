"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Logo } from "@/components/auth/logo";
import { useAuthStore } from "@/lib/auth-store";
import { suppressAuthRedirect } from "@/lib/use-require-auth";
import { homeForRole } from "@/lib/use-auth-helpers";
import { useT } from "@/components/i18n/lang-provider";
import { LanguageSwitch } from "@/components/i18n/language-switch";
import { ProfileMenu, menuEntriesFor } from "./profile-menu";
import type { MessageKey } from "@/lib/i18n";

export const NAV_LINKS: readonly { href: string; labelKey: MessageKey }[] = [
  { href: "/features", labelKey: "header.nav.features" },
  { href: "/for-owners", labelKey: "header.nav.forOwners" },
  { href: "/about", labelKey: "header.nav.about" },
  { href: "/blog", labelKey: "header.nav.blog" },
  { href: "/contact", labelKey: "header.nav.contact" },
];

const PILL = "khelo-btn inline-flex min-h-11 items-center rounded-full px-5 py-3 text-[14px] font-bold";
const OUTLINE_PILL = `${PILL} border-[1.5px] border-white/35 text-white`;

function useIsCurrent() {
  const pathname = usePathname();
  return (href: string) => pathname === href || pathname.startsWith(`${href}/`);
}

function logout(router: ReturnType<typeof useRouter>) {
  // Best effort server-side revoke; the local sign-out happens regardless.
  void import("@/lib/api").then(({ api }) => api.auth.logout().catch(() => undefined)).finally(() => {
    suppressAuthRedirect(); // a deliberate sign-out: the page's own "signed out -> /login?next=" guard must not win the race to "/"
    useAuthStore.getState().signOut();
    router.push("/");
  });
}

function HamburgerIcon({ open }: { open: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
      {open ? <path d="M5 5l12 12M17 5L5 17" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /> : <path d="M3 6h16M3 11h16M3 16h16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />}
    </svg>
  );
}

/**
 * The Khelo site header (dark), identical on every public page and the app screens: logo, the five section links, then
 * the account actions. `wide` is the 1240px / 16px-padding variant the design uses on Login, Signup and Search; the
 * marketing pages use 1200px / 20px. The current page's link is orange. Signed-in visitors see their own entry
 * (dashboard + account + log out) instead of Log in / Sign up. Below 1120px the section links and the two secondary buttons move into a
 * menu panel opened by a 44px hamburger. (The design's only breakpoint is 760px, but the full header needs about 1100px, so between
 * 761 and 1100 it wrapped onto two rows; collapsing earlier keeps one clean row at every width.)
 */
export function SiteHeader({ wide = false }: { wide?: boolean }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const isCurrent = useIsCurrent();
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const signedIn = status === "signedIn" && !!user;
  // The menu is "open for" the path it was opened on, so following any link (the path changes) closes it with no effect needed.
  const [openFor, setOpenFor] = useState<string | null>(null);
  const open = openFor === pathname;
  const panelId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback((returnFocus = false) => {
    setOpenFor(null);
    if (returnFocus) toggleRef.current?.focus();
  }, []);

  // Esc closes; Tab stays inside the panel while it is open; focus lands on the first link
  useEffect(() => {
    if (!open) return;
    const focusables = () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>("a[href], button:not([disabled])") ?? []);
    focusables()[0]?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close(true);
        return;
      }
      if (e.key !== "Tab") return;
      const items = [toggleRef.current, ...focusables()].filter(Boolean) as HTMLElement[];
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  const dashboardHref = user ? (user.role === "player" ? "/bookings" : homeForRole(user.role)) : "/login";
  const dashboardLabel = user?.role === "player" ? t("header.myBookings") : t("header.dashboard");
  const initial = (user?.name?.trim()?.[0] ?? user?.phone?.replace(/\D/g, "").slice(-1) ?? "?").toUpperCase();
  const displayName = user?.name?.trim() || user?.phone || "";
  const linkTone = (href: string) => (isCurrent(href) ? "text-khelo-orange" : "");

  return (
    <header className="khelo relative border-b border-white/10 bg-khelo-ink font-[family-name:var(--font-khelo-body-x)] text-white">
      <div className={`mx-auto flex w-full flex-wrap items-center justify-between gap-4 px-6 max-[1120px]:flex-nowrap ${wide ? "max-w-[1288px] py-4" : "max-w-[1248px] py-5"}`}>
        <Link href="/" aria-label={t("header.homeLabel")}>
          <Logo size={34} onDark />
        </Link>

        <nav aria-label={t("header.nav.main")} className="flex flex-wrap gap-5 text-[15px] min-[1240px]:gap-7 font-semibold max-[1120px]:hidden">
          {NAV_LINKS.map((l) => (
            <Link key={l.href} href={l.href} aria-current={isCurrent(l.href) ? "page" : undefined} className={`khelo-navlink ${linkTone(l.href)}`}>
              {t(l.labelKey)}
            </Link>
          ))}
        </nav>

        <div className="flex flex-wrap items-center gap-2.5">
          <LanguageSwitch tone="dark" className="max-[1120px]:hidden" />
          {status === "hydrating" ? (
            <span className="inline-block h-11 w-24" aria-hidden="true" />
          ) : signedIn ? (
            <>
              <Link href={dashboardHref} className={`khelo-navlink inline-flex min-h-11 items-center px-3.5 text-[14px] font-bold max-[1120px]:hidden ${linkTone(dashboardHref)}`}>
                {dashboardLabel}
              </Link>
              <ProfileMenu
                role={user!.role}
                displayName={displayName}
                initial={initial}
                onLogout={() => logout(router)}
                className="max-[1120px]:hidden"
              />
            </>
          ) : (
            <>
              <Link href="/login" aria-current={isCurrent("/login") ? "page" : undefined} className={`khelo-navlink inline-flex min-h-11 items-center px-3.5 text-[14px] font-bold max-[460px]:hidden ${linkTone("/login")}`}>
                {t("header.login")}
              </Link>
              <Link
                href="/signup"
                aria-current={isCurrent("/signup") ? "page" : undefined}
                className={`${PILL} border-[1.5px] max-[1120px]:hidden ${isCurrent("/signup") ? "border-khelo-orange text-khelo-orange" : "border-white/35 text-white"}`}
              >
                {t("header.signup")}
              </Link>
            </>
          )}
          <Link href="/search" className={`${PILL} bg-khelo-orange font-extrabold text-khelo-ink max-[420px]:px-3.5 max-[420px]:text-[13px] max-[350px]:hidden`}>
            {t("header.startPlaying")}
          </Link>
          <button
            ref={toggleRef}
            type="button"
            aria-label={open ? t("header.menu.close") : t("header.menu.open")}
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpenFor(open ? null : pathname)}
            className="hidden h-11 w-11 cursor-pointer items-center justify-center rounded-full border-[1.5px] border-white/35 text-white max-[1120px]:inline-flex"
          >
            <HamburgerIcon open={open} />
          </button>
        </div>
      </div>

      <div
        ref={panelRef}
        id={panelId}
        hidden={!open}
        className="absolute inset-x-0 top-full z-50 border-t border-white/10 bg-khelo-ink px-6 pb-6 pt-2 shadow-[0_24px_40px_rgba(0,0,0,0.35)]"
      >
        <nav aria-label={t("header.nav.menu")} className="mx-auto flex max-w-[1200px] flex-col">
          {NAV_LINKS.map((l) => (
            <Link key={l.href} href={l.href} aria-current={isCurrent(l.href) ? "page" : undefined} className={`flex min-h-12 items-center border-b border-white/10 text-[17px] font-semibold ${linkTone(l.href)}`}>
              {t(l.labelKey)}
            </Link>
          ))}
          <div className="mt-4 flex flex-col gap-3">
            <LanguageSwitch tone="dark" className="self-start" />
            {signedIn ? (
              <>
                <p className="px-1 pt-1 text-[13px] font-semibold text-white/60">{t("header.pm.signedInAs", { name: displayName })}</p>
                {menuEntriesFor(user!.role).map((e) => (
                  <Link key={e.labelKey} href={e.href} className={`${OUTLINE_PILL} justify-center`}>
                    {t(e.labelKey)}
                  </Link>
                ))}
                <button type="button" data-testid="menu-logout" onClick={() => logout(router)} className={`${OUTLINE_PILL} cursor-pointer justify-center`}>
                  {t("header.logout")}
                </button>
              </>
            ) : (
              <>
                <Link href="/login" className={`${OUTLINE_PILL} justify-center`}>
                  {t("header.login")}
                </Link>
                <Link href="/signup" className={`${OUTLINE_PILL} justify-center`}>
                  {t("header.signup")}
                </Link>
              </>
            )}
            <Link href="/search" className={`${PILL} justify-center bg-khelo-orange font-extrabold text-khelo-ink`}>
              {t("header.startPlaying")}
            </Link>
          </div>
        </nav>
      </div>
    </header>
  );
}
