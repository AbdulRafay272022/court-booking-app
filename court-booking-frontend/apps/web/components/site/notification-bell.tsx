"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { notificationText, type NotificationFeedItem } from "@court-booking/types";
import { useLang, useT } from "@/components/i18n/lang-provider";
import { useFmt } from "@/lib/use-fmt";
import type { MessageKey } from "@/lib/i18n";
import { capCount } from "@/lib/owner-seen";
import { feedRoute, groupByDay, ms, type NotifRole } from "@/lib/notif-helpers";
import { currentPermission, useNotifications, type PopupState } from "@/lib/use-notifications";

function BellIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

/**
 * The notifications bell, shown to every signed-in role (player, owner, staff, admin). A button with an unread badge ("9+" cap) opens a
 * dropdown with the latest notifications (Round 2: GET /users/me/notifications/feed, one readable sentence + context + delivery per
 * item, grouped by day; an older backend falls back to the plain log), polled every 15 s while the tab is visible, "mark all as read"
 * (kept in this browser, per user), and the opt-in browser popup + sound. `tone="dark"` is for the dark site header, `"light"` for the owner shell.
 * Keyboard: Enter / Space opens, Esc closes and returns focus to the bell, leaving the dropdown with Tab closes it.
 */
export function NotificationBell({ tone = "dark", className = "" }: { tone?: "dark" | "light"; className?: string }) {
  const t = useT();
  const fmt = useFmt();
  const router = useRouter();
  const n = useNotifications();
  const panelId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [top, setTop] = useState(64);
  const [perm, setPerm] = useState<PopupState>("unsupported");
  const [announce, setAnnounce] = useState("");

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  function toggle() {
    if (open) {
      close(false);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setTop(Math.round(rect.bottom + 8));
    setPerm(currentPermission());
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>("button:not([disabled]), a[href]")?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close(true);
      }
    }
    function onPointer(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open, close]);

  if (!n.signedIn) return null;

  const ownerSide = n.role === "owner" || n.role === "staff" || n.role === "admin";
  const tone2 = ownerSide ? "owner" : "player";
  const rk = (base: string) => t(`${base}.${tone2}` as MessageKey);
  const badge = capCount(n.unread, 9);
  const label = n.unread > 0 ? t("notif.bell.labelUnread", { n: n.unread }) : t("notif.bell.label");

  const btnTone = tone === "dark" ? "border-white/35 text-white hover:bg-white/10" : "border-owner-border bg-owner-surface text-owner-ink hover:bg-owner-bg";

  async function enable() {
    const result = await n.enablePopups();
    setPerm(result);
    setAnnounce(result === "granted" ? t("notif.popup.on") : result === "denied" ? rk("notif.popup.denied") : "");
  }

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        data-testid="notification-bell"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={toggle}
        className={`relative inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border-[1.5px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-khelo-orange ${btnTone}`}
      >
        <BellIcon />
        {badge ? (
          <span data-testid="notification-badge" aria-hidden="true" className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-khelo-orange px-1 text-[11px] font-extrabold leading-none text-khelo-ink">
            {badge}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label={t("notif.bell.title")}
          data-testid="notification-panel"
          style={{ "--bell-top": `${top}px` } as React.CSSProperties}
          className="fixed inset-x-3 top-(--bell-top) z-[60] whitespace-normal max-h-[min(34rem,calc(100vh-6rem))] overflow-y-auto rounded-2xl border border-khelo-border bg-white text-left text-khelo-ink shadow-[0_24px_48px_rgba(12,31,29,0.25)] sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[380px]"
        >
          <div className="flex items-center justify-between gap-2 border-b border-khelo-divider px-4 py-3">
            <h2 className="font-khelo-display text-[17px] font-extrabold">{t("notif.bell.title")}</h2>
            <div className="flex items-center gap-1">
              <button
                type="button"
                data-testid="notification-mark-all"
                onClick={n.markAllRead}
                disabled={n.unread === 0}
                className="min-h-11 cursor-pointer rounded-lg px-2.5 text-[13px] font-bold text-khelo-teal underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-khelo-orange disabled:cursor-default disabled:text-khelo-muted-2 disabled:no-underline"
              >
                {t("notif.bell.markAll")}
              </button>
              <button
                type="button"
                aria-label={t("notif.bell.close")}
                onClick={() => close(true)}
                className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-lg text-[18px] text-khelo-muted focus-visible:outline-2 focus-visible:outline-khelo-orange sm:hidden"
              >
                <span aria-hidden="true">{"\u2715"}</span>
              </button>
            </div>
          </div>

          {n.isLoading ? (
            <p className="px-4 py-8 text-center text-[14px] text-khelo-muted" role="status">
              {t("notif.bell.loading")}
            </p>
          ) : n.isError ? (
            <div className="px-4 py-6 text-center" role="alert">
              <p className="text-[14px] font-semibold text-khelo-muted">{t("notif.bell.error")}</p>
              <button type="button" onClick={n.refetch} className="mt-2 min-h-11 cursor-pointer rounded-lg border border-khelo-border px-4 text-[13px] font-bold">
                {t("notif.bell.retry")}
              </button>
            </div>
          ) : n.items.length === 0 ? (
            <p className="px-4 py-8 text-center text-[14px] text-khelo-muted">{t("notif.bell.empty")}</p>
          ) : (
            <div aria-label={t("notif.bell.listLabel")} role="group">
              {groupByDay(n.items, n.fetchedAt).map((g) => {
                const heading = g.kind === "today" ? t("notif.bell.today") : g.kind === "yesterday" ? t("notif.bell.yesterday") : fmt.dateString(g.day);
                return (
                  <section key={g.day} aria-label={heading} data-testid="notification-day">
                    <h3 className="sticky top-0 z-[1] m-0 bg-khelo-page px-4 py-1.5 text-[11.5px] font-extrabold uppercase tracking-wide text-khelo-muted-2">{heading}</h3>
                    <ul className="m-0 list-none p-0">
                      {g.items.map((e) => (
                        <Row
                          key={e.id}
                          item={e}
                          unread={ms(e.created_at) > n.readAt}
                          role={n.role}
                          onNavigate={(href) => {
                            // close the dropdown FIRST, then navigate (A2)
                            close(false);
                            router.push(href);
                          }}
                        />
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}

          {(
            <div className="flex flex-col gap-2.5 border-t border-khelo-divider bg-khelo-page px-4 py-3">
              {perm !== "unsupported" ? (
                <div className="flex flex-col gap-1.5">
                  <p className="text-[12px] font-bold uppercase tracking-wide text-khelo-muted-2">{t("notif.popup.heading")}</p>
                  <p className="text-[12.5px] leading-5 text-khelo-muted" data-testid="notification-popup-explain">{rk("notif.popup.explain")}</p>
                  {perm === "denied" ? (
                    <p className="text-[13px] leading-5 text-khelo-muted" data-testid="notification-denied">
                      {rk("notif.popup.denied")}
                    </p>
                  ) : n.popupEnabled && perm === "granted" ? (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[13px] font-semibold text-khelo-success-text">{"\u2713 "}{t("notif.popup.on")}</p>
                      <button type="button" onClick={n.disablePopups} className="min-h-11 cursor-pointer rounded-lg border border-khelo-border bg-white px-3 text-[13px] font-bold">
                        {rk("notif.popup.off")}
                      </button>
                    </div>
                  ) : (
                    <>
                      <p className="text-[13px] leading-5 text-khelo-muted">{rk("notif.popup.hint")}</p>
                      <button type="button" data-testid="notification-enable" onClick={enable} className="min-h-11 cursor-pointer self-start rounded-lg bg-khelo-ink px-4 text-[13.5px] font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-khelo-orange">
                        {rk("notif.popup.enable")}
                      </button>
                    </>
                  )}
                </div>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13px] font-semibold">{t("notif.sound.label")}</span>
                <button
                  type="button"
                  data-testid="notification-sound"
                  aria-pressed={n.soundOn}
                  onClick={() => n.setSound(!n.soundOn)}
                  className="min-h-11 cursor-pointer rounded-lg border border-khelo-border bg-white px-3 text-[13px] font-bold"
                >
                  {n.soundOn ? t("notif.sound.on") : t("notif.sound.off")}
                </button>
              </div>
              <p className="sr-only" role="status" aria-live="polite">
                {announce}
              </p>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Row({
  item,
  unread,
  role,
  onNavigate,
}: {
  item: NotificationFeedItem;
  unread: boolean;
  role: NotifRole;
  onNavigate: (href: string) => void;
}) {
  const t = useT();
  const lang = useLang();
  const fmt = useFmt();
  const text = notificationText(item, lang);
  const href = feedRoute(item, role);
  const body = (
    <>
      <span aria-hidden="true" data-testid={unread ? "notification-unread-dot" : undefined} className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${unread ? "bg-khelo-orange" : "bg-transparent"}`} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={`text-[14px] leading-5 ${unread ? "font-bold" : "font-semibold"}`} data-testid="notification-title">
          {text.title}
          {unread ? <span className="ml-2 inline-block rounded-full bg-khelo-warm px-2 py-0.5 align-middle text-[11px] font-extrabold text-khelo-orange-label">{t("notif.bell.new")}</span> : null}
        </span>
        {text.context ? (
          <span className="text-[13px] leading-5 text-khelo-ink [overflow-wrap:anywhere]" data-testid="notification-context">
            {text.context}
          </span>
        ) : null}
        <span className="text-[12px] text-khelo-muted-2" data-testid="notification-meta">
          {fmt.relative(item.created_at)}
          {text.delivery ? ` \u00b7 ${text.delivery}` : ""}
        </span>
      </span>
    </>
  );
  const cls = "flex min-h-14 items-start gap-3 border-b border-khelo-divider px-4 py-3";
  return (
    <li data-testid="notification-row">
      {href ? (
        <Link
          href={href}
          onClick={(e: ReactMouseEvent<HTMLAnchorElement>) => {
            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // new tab / window: leave it to the browser
            e.preventDefault();
            onNavigate(href);
          }}
          className={`${cls} hover:bg-khelo-page focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-khelo-orange`}
        >
          {body}
        </Link>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </li>
  );
}
