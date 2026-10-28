"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { UserRole } from "@court-booking/types";
import { useT } from "@/components/i18n/lang-provider";
import type { MessageKey } from "@/lib/i18n";

export interface MenuEntry {
  href: string;
  labelKey: MessageKey;
}

/**
 * The signed-in menu, per role (the owner never sees the player's "My bookings" or "Saved"; a player never sees the dashboard):
 *  - player: Search, My bookings, Saved, Profile, Settings
 *  - owner:  Dashboard, Bookings (the venue's bookings and payments), Venues (venue and court settings), Settings
 *  - staff / admin: Dashboard, Settings
 * Logout is always added last by the caller. Used by the desktop dropdown and by the mobile panel, so both always agree.
 */
export function menuEntriesFor(role: UserRole): MenuEntry[] {
  switch (role) {
    case "player":
      return [
        { href: "/search", labelKey: "header.pm.search" },
        { href: "/bookings", labelKey: "header.myBookings" },
        { href: "/account?tab=saved", labelKey: "header.pm.saved" },
        { href: "/account", labelKey: "header.pm.profile" },
        { href: "/account?tab=settings", labelKey: "header.pm.settings" },
      ];
    case "owner":
      return [
        { href: "/dashboard/owner/today", labelKey: "header.pm.dashboard" },
        { href: "/dashboard/owner/ledger", labelKey: "header.pm.bookings" },
        { href: "/dashboard/owner/settings", labelKey: "header.pm.venues" },
        { href: "/account?tab=settings", labelKey: "header.pm.settings" },
      ];
    case "staff":
      return [
        { href: "/dashboard/owner/today", labelKey: "header.pm.dashboard" },
        { href: "/account?tab=settings", labelKey: "header.pm.settings" },
      ];
    default:
      return [
        { href: "/dashboard/admin/venues", labelKey: "header.pm.dashboard" },
        { href: "/account?tab=settings", labelKey: "header.pm.settings" },
      ];
  }
}

/**
 * Desktop profile dropdown: an avatar button that opens a menu with the person's name, the role's links and Log out.
 * Keyboard: Enter / Space / ArrowDown opens and focuses the first item; ArrowUp / ArrowDown / Home / End move; Esc closes and returns focus
 * to the button; Tab closes; a click outside closes. Every target is 44px.
 */
export function ProfileMenu({
  role, // i18n-ignore
  displayName, // i18n-ignore
  initial, // i18n-ignore
  avatarUrl, // i18n-ignore
  onLogout, // i18n-ignore
  className = "",
}: {
  role: UserRole;
  displayName: string;
  initial: string;
  /** audit 2026-10-28 item 6: the signed-in user's photo; the initial is only the fallback. */
  avatarUrl?: string | null;
  onLogout: () => void;
  className?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const entries = menuEntriesFor(role);

  const items = useCallback(() => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []), []);
  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, items]);

  function onMenuKey(e: React.KeyboardEvent) {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      list[(i + 1) % list.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      list[(i - 1 + list.length) % list.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      list[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      list[list.length - 1]?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  const itemCls = "flex min-h-11 w-full cursor-pointer items-center px-4 text-left text-[14.5px] font-semibold text-khelo-ink hover:bg-khelo-page focus-visible:bg-khelo-page";

  return (
    <div className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        aria-label={t("header.pm.aria")}
        title={displayName}
        data-testid="profile-menu-button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="khelo-btn flex h-11 w-11 cursor-pointer items-center justify-center overflow-hidden rounded-full bg-white/10 text-[15px] font-extrabold text-white"
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="" width={44} height={44} className="h-11 w-11 rounded-full object-cover" data-testid="header-avatar-photo" />
        ) : (
          initial
        )}
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={id}
          role="menu"
          aria-label={t("header.pm.aria")}
          onKeyDown={onMenuKey}
          data-testid="profile-menu"
          className="absolute right-0 top-[calc(100%+8px)] z-50 w-64 overflow-hidden rounded-2xl border border-khelo-divider bg-khelo-surface py-1 text-khelo-ink shadow-[0_18px_40px_rgba(0,0,0,0.28)]"
        >
          <p className="truncate border-b border-khelo-divider px-4 py-3 text-[13px] font-bold text-khelo-muted" role="presentation">
            {displayName}
          </p>
          {entries.map((e) => (
            <Link key={e.labelKey} role="menuitem" href={e.href} onClick={() => setOpen(false)} className={itemCls}>
              {t(e.labelKey)}
            </Link>
          ))}
          <button
            type="button"
            role="menuitem"
            data-testid="profile-menu-logout"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
            className={`${itemCls} border-t border-khelo-divider`}
          >
            {t("header.logout")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
