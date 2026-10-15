"use client";

import Link from "next/link";
import { useCallback, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CITY_OPTIONS, monthOf, pktDateString } from "@court-booking/types";
import { useAuthStore } from "@/lib/auth-store";
import { useT } from "@/components/i18n/lang-provider";
import { useFmt } from "@/lib/use-fmt";
import type { MessageKey } from "@/lib/i18n";
import { Container } from "@/components/site/primitives";
import { SavedVenues } from "@/components/bookings/saved-venues";
import { BookingsPanel } from "./bookings-panel";
import { Avatar, Card } from "./parts";
import { ProfilePanel } from "./profile-panel";
import { SettingsPanel } from "./settings-panel";

/** Support contacts, read on the server (lib/site-config.ts) and passed down. Each one is undefined when not configured, and then not shown. */
export interface HelpContacts {
  whatsappHref?: string;
  whatsappNumber?: string;
  emailHref?: string;
  email?: string;
  hours?: string;
}

type TabKey = "profile" | "bookings" | "saved" | "settings";
const TAB_LABEL: Record<TabKey, MessageKey> = {
  profile: "account.tab.profile",
  bookings: "account.tab.bookings",
  saved: "account.tab.saved",
  settings: "account.tab.settings",
};

/**
 * The account hub: header card + Profile / Bookings / Saved / Settings. The active tab lives in `?tab=` so a refresh or a shared link
 * opens the same tab. Tabs follow the WAI-ARIA tabs pattern (tablist, roving tabindex, arrow keys, Home/End).
 */
export function AccountHub({ help }: { help: HelpContacts }) {
  const t = useT();
  const fmt = useFmt();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const user = useAuthStore((s) => s.user)!;
  const isPlayer = user.role === "player";
  const isOwner = user.role === "owner";

  // Saved venues are a player feature (the favorites list is off for owners and admins).
  // Bookings and Saved are the PLAYER's pages; an owner, staff member or admin manages bookings in the dashboard, so they only get Profile and Settings.
  const tabs: TabKey[] = isPlayer ? ["profile", "bookings", "saved", "settings"] : ["profile", "settings"];
  const requested = params.get("tab");
  const active: TabKey = tabs.find((k) => k === requested) ?? "profile";
  const tabRefs = useRef<Partial<Record<TabKey, HTMLButtonElement | null>>>({});

  const select = useCallback(
    (key: TabKey, focus = false) => {
      router.replace(key === "profile" ? pathname : `${pathname}?tab=${key}`, { scroll: false });
      if (focus) tabRefs.current[key]?.focus();
    },
    [router, pathname],
  );

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    let next = -1;
    if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    select(tabs[next], true);
  }

  const cityOption = CITY_OPTIONS.find((c) => c.value === user.city);
  const cityLabel = cityOption ? fmt.city(cityOption.label).replace(/\s*\(.*\)$/, "") : undefined;
  const memberSince = user.created_at ? fmt.month(monthOf(pktDateString(user.created_at))) : null;
  const roleLabel = isOwner ? t("account.role.owner") : user.role === "admin" ? t("account.role.admin") : user.role === "staff" ? t("account.role.staff") : t("account.role.player");

  return (
    <Container className="py-8 lg:py-10">
      <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)] lg:items-start lg:gap-8">
        <div className="flex flex-col gap-4 lg:sticky lg:top-6">
          {isOwner ? (
            <Link
              href="/dashboard/owner/today"
              data-testid="account-owner-shortcut"
              className="khelo-card flex items-center justify-between gap-4 rounded-3xl bg-khelo-teal p-5 text-white"
            >
              <span className="flex flex-col gap-0.5">
                <span className="text-[17px] font-extrabold">{t("account.owner.title")}</span>
                <span className="text-[14px] text-white/85">{t("account.owner.body")}</span>
              </span>
              <span aria-hidden="true" className="text-[22px] font-extrabold">
                {"→"}
              </span>
            </Link>
          ) : null}

          <Card className="flex items-center gap-4" data-testid="account-header">
            <Avatar url={user.avatar_url} name={user.name ?? user.phone} size={64} alt={t("account.avatar.alt")} />
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-[12px] font-extrabold uppercase tracking-[1.2px] text-khelo-orange-label">{t("account.eyebrow")}</p>
              <h1 className="break-words font-khelo-display text-[24px] font-extrabold leading-tight tracking-tight">{user.name || t("account.title")}</h1>
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[14px] text-khelo-muted">
                <span className="rounded-full bg-khelo-mint px-3 py-0.5 text-[12px] font-extrabold text-khelo-teal" data-testid="account-role">
                  {roleLabel}
                </span>
                {cityLabel ? <span>{cityLabel}</span> : null}
              </div>
              {memberSince ? <p className="text-[13px] text-khelo-muted-2">{t("account.memberSince", { date: memberSince })}</p> : null}
            </div>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          {/* Sticky on phones so the section stays reachable while scrolling a long panel. */}
          <div className="sticky top-0 z-20 -mx-6 border-b border-khelo-divider bg-khelo-page/95 px-6 py-2 backdrop-blur lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0">
            <div role="tablist" aria-label={t("account.tabs.aria")} className="flex gap-2 overflow-x-auto">
              {tabs.map((key, i) => {
                const on = key === active;
                return (
                  <button
                    key={key}
                    ref={(el) => {
                      tabRefs.current[key] = el;
                    }}
                    id={`account-tab-${key}`}
                    role="tab"
                    type="button"
                    aria-selected={on}
                    aria-controls={`account-panel-${key}`}
                    tabIndex={on ? 0 : -1}
                    onClick={() => select(key)}
                    onKeyDown={(e) => onKeyDown(e, i)}
                    data-testid={`account-tab-${key}`}
                    className={`khelo-btn inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center whitespace-nowrap rounded-full px-5 py-2.5 text-[15px] font-extrabold sm:flex-none ${
                      on ? "bg-khelo-ink text-white" : "bg-khelo-booked-bg text-khelo-ink"
                    }`}
                  >
                    {t(TAB_LABEL[key])}
                  </button>
                );
              })}
            </div>
          </div>

          <div id={`account-panel-${active}`} role="tabpanel" aria-labelledby={`account-tab-${active}`} tabIndex={0} className="rounded-3xl outline-offset-4">
            {active === "profile" ? <ProfilePanel /> : null}
            {active === "bookings" ? <BookingsPanel /> : null}
            {active === "saved" ? (
              <div className="flex flex-col gap-4">
                <SavedVenues grid />
              </div>
            ) : null}
            {active === "settings" ? <SettingsPanel help={help} /> : null}
          </div>
        </div>
      </div>
    </Container>
  );
}
