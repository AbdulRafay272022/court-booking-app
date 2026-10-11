"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Logo } from "@/components/auth/logo";
import { useAuthStore } from "@/lib/auth-store";
import { homeForRole } from "@/lib/use-auth-helpers";

export const NAV_LINKS = [
  { href: "/features", label: "Features" },
  { href: "/for-owners", label: "For Owners" },
  { href: "/about", label: "About" },
  { href: "/blog", label: "Blog" },
  { href: "/contact", label: "Contact" },
] as const;

const PILL = "khelo-btn inline-flex min-h-11 items-center rounded-full px-5 py-3 text-[14px] font-bold";
const OUTLINE_PILL = `${PILL} border-[1.5px] border-white/35 text-white`;

function useIsCurrent() {
  const pathname = usePathname();
  return (href: string) => pathname === href || pathname.startsWith(`${href}/`);
}

function logout(router: ReturnType<typeof useRouter>) {
  // Best effort server-side revoke; the local sign-out happens regardless.
  void import("@/lib/api").then(({ api }) => api.auth.logout().catch(() => undefined)).finally(() => {
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
 * (dashboard + account + log out) instead of Log in / Sign up. Below 760px the section links and the two secondary
 * buttons move into a menu panel opened by a 44px hamburger.
 */
export function SiteHeader({ wide = false }: { wide?: boolean }) {
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
  const dashboardLabel = user?.role === "player" ? "My bookings" : "Dashboard";
  const initial = (user?.name?.trim()?.[0] ?? user?.phone?.replace(/\D/g, "").slice(-1) ?? "?").toUpperCase();
  const linkTone = (href: string) => (isCurrent(href) ? "text-khelo-orange" : "");

  return (
    <header className="khelo relative border-b border-white/10 bg-khelo-ink font-[family-name:var(--font-khelo-body-x)] text-white">
      <div className={`mx-auto flex w-full flex-wrap items-center justify-between gap-4 px-6 ${wide ? "max-w-[1240px] py-4" : "max-w-[1200px] py-5"}`}>
        <Link href="/" aria-label="Khelo home">
          <Logo size={34} onDark />
        </Link>

        <nav aria-label="Main" className="flex flex-wrap gap-7 text-[15px] font-semibold max-[760px]:hidden">
          {NAV_LINKS.map((l) => (
            <Link key={l.href} href={l.href} aria-current={isCurrent(l.href) ? "page" : undefined} className={`khelo-navlink ${linkTone(l.href)}`}>
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="flex flex-wrap items-center gap-2.5">
          {status === "hydrating" ? (
            <span className="inline-block h-11 w-24" aria-hidden="true" />
          ) : signedIn ? (
            <>
              <Link href={dashboardHref} className={`khelo-navlink inline-flex min-h-11 items-center px-3.5 text-[14px] font-bold max-[760px]:hidden ${linkTone(dashboardHref)}`}>
                {dashboardLabel}
              </Link>
              <Link
                href="/account"
                aria-label="Your account"
                title="Your account"
                className="khelo-btn flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-[15px] font-extrabold text-white max-[760px]:hidden"
              >
                {initial}
              </Link>
              <button type="button" onClick={() => logout(router)} className={`${OUTLINE_PILL} cursor-pointer max-[760px]:hidden`}>
                Log out
              </button>
            </>
          ) : (
            <>
              <Link href="/login" aria-current={isCurrent("/login") ? "page" : undefined} className={`khelo-navlink inline-flex min-h-11 items-center px-3.5 text-[14px] font-bold max-[460px]:hidden ${linkTone("/login")}`}>
                Log in
              </Link>
              <Link href="/signup" className={`${OUTLINE_PILL} max-[760px]:hidden`}>
                Sign up
              </Link>
            </>
          )}
          {!(signedIn && user?.role === "owner") ? (
            <Link href="/for-owners" className={`${OUTLINE_PILL} max-[760px]:hidden`}>
              List your venue
            </Link>
          ) : null}
          <Link href="/search" className={`${PILL} bg-khelo-orange font-extrabold text-khelo-ink`}>
            Start playing
          </Link>
          <button
            ref={toggleRef}
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpenFor(open ? null : pathname)}
            className="hidden h-11 w-11 cursor-pointer items-center justify-center rounded-full border-[1.5px] border-white/35 text-white max-[760px]:inline-flex"
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
        <nav aria-label="Menu" className="mx-auto flex max-w-[1200px] flex-col">
          {NAV_LINKS.map((l) => (
            <Link key={l.href} href={l.href} aria-current={isCurrent(l.href) ? "page" : undefined} className={`flex min-h-12 items-center border-b border-white/10 text-[17px] font-semibold ${linkTone(l.href)}`}>
              {l.label}
            </Link>
          ))}
          <div className="mt-4 flex flex-col gap-3">
            {signedIn ? (
              <>
                <Link href={dashboardHref} className={`${OUTLINE_PILL} justify-center`}>
                  {dashboardLabel}
                </Link>
                <Link href="/account" className={`${OUTLINE_PILL} justify-center`}>
                  Your account
                </Link>
                <button type="button" onClick={() => logout(router)} className={`${OUTLINE_PILL} cursor-pointer justify-center`}>
                  Log out
                </button>
              </>
            ) : (
              <>
                <Link href="/login" className={`${OUTLINE_PILL} justify-center`}>
                  Log in
                </Link>
                <Link href="/signup" className={`${OUTLINE_PILL} justify-center`}>
                  Sign up
                </Link>
              </>
            )}
            {!(signedIn && user?.role === "owner") ? (
              <Link href="/for-owners" className={`${OUTLINE_PILL} justify-center`}>
                List your venue
              </Link>
            ) : null}
            <Link href="/search" className={`${PILL} justify-center bg-khelo-orange font-extrabold text-khelo-ink`}>
              Start playing
            </Link>
          </div>
        </nav>
      </div>
    </header>
  );
}
