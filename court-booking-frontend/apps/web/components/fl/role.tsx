"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { role as roleThemes, type Role, type RoleTheme } from "@court-booking/ui-tokens";
import { useLang } from "@/components/i18n/lang-provider";

/**
 * Floodlight role theme for the web app. Chosen by ROUTE, never per page: app/dashboard/owner/layout.tsx and
 * app/venue-setup/layout.tsx mount <FlRoleProvider role="owner">; everything else is the default player role.
 * Context only (no DOM): each fl component writes data-fl-role on its own root, and theme.css maps that to CSS vars.
 */
const RoleContext = createContext<Role>("player");

export function FlRoleProvider({ role, children }: { role: Role; children: ReactNode }) {
  return <RoleContext.Provider value={role}>{children}</RoleContext.Provider>;
}

export function useFlRole(): Role {
  return useContext(RoleContext);
}

export function useFlRoleTheme(): RoleTheme {
  return roleThemes[useContext(RoleContext)];
}

/** Roman Urdu / English copy picker using the site's language cookie (LangProvider in the root layout). */
export function useFlCopy(): (ru: string, en: string) => string {
  const lang = useLang();
  return (ru, en) => (lang === "en" ? en : ru);
}

export function useFlLang(): "ru" | "en" {
  return useLang() === "en" ? "en" : "ru";
}

/** prefers-reduced-motion (live). */
export function useReducedMotion(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setOn(mq.matches);
    const fn = (e: MediaQueryListEvent) => setOn(e.matches);
    mq.addEventListener("change", fn);
    return () => mq.removeEventListener("change", fn);
  }, []);
  return on;
}

/** Tiny className joiner. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
