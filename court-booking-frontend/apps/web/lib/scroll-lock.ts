"use client";

import { useEffect } from "react";

/**
 * Body scroll lock shared by every overlay: owner modals, the player's court-day popup and duration sheet (audit 2026-10-28
 * item 5: the venue page scrolled away BEHIND the popup, so on close the player was somewhere else).
 *
 * A counter, so a sheet opened from a popup does not unlock the page early. `position: fixed` with a negative top (not just
 * `overflow: hidden`) because iOS Safari ignores overflow on body; the page's scroll position is put back exactly on unlock.
 */
let lockCount = 0;
let saved: { overflow: string; position: string; top: string; width: string; scrollY: number } | null = null;

export function lockScroll(): void {
  if (typeof document === "undefined") return;
  if (lockCount === 0) {
    const body = document.body;
    saved = { overflow: body.style.overflow, position: body.style.position, top: body.style.top, width: body.style.width, scrollY: window.scrollY };
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${saved.scrollY}px`;
    body.style.width = "100%";
  }
  lockCount += 1;
}

export function unlockScroll(): void {
  if (typeof document === "undefined") return;
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0 && saved) {
    const body = document.body;
    const { scrollY } = saved;
    body.style.overflow = saved.overflow;
    body.style.position = saved.position;
    body.style.top = saved.top;
    body.style.width = saved.width;
    saved = null;
    window.scrollTo(0, scrollY);
  }
}

/** Lock the page while `active` (an open popup / sheet). */
export function useScrollLock(active = true): void {
  useEffect(() => {
    if (!active) return;
    lockScroll();
    return unlockScroll;
  }, [active]);
}

/** For tests only. */
export function scrollLockCount(): number {
  return lockCount;
}
