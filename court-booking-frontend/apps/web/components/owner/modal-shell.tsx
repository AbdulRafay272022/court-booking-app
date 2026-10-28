"use client";

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

import { lockScroll, unlockScroll } from "@/lib/scroll-lock";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ModalShellProps {
  /** Accessible name of the dialog (use a visible heading's id via `labelledBy` instead when there is one). */
  label?: string;
  labelledBy?: string;
  onClose: () => void;
  children: ReactNode;
  /** Panel width on >= 768px. */
  maxWidthClass?: string;
  /** Darker backdrop and no sheet behaviour (used by the screenshot lightbox). */
  fullscreen?: boolean;
}

/**
 * The one modal frame for the owner popups: centered dialog from 768px, bottom sheet below.
 * Focus trap, Escape closes, focus goes back to the element that opened it, body scroll is locked.
 */
export function ModalShell({ label, labelledBy, onClose, children, maxWidthClass = "md:max-w-[880px]", fullscreen }: ModalShellProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    lockScroll();
    panelRef.current?.focus();
    return () => {
      unlockScroll();
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onCloseRef.current();
      return;
    }
    if (e.key !== "Tab") return;
    e.stopPropagation(); // a dialog opened from inside another dialog is its DOM child: only the inner one traps
    const panel = panelRef.current;
    if (!panel) return;
    const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-center ${fullscreen ? "items-center bg-fl-night/85" : "items-end md:items-center bg-fl-a-scrim"}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCloseRef.current();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={
          fullscreen
            ? "relative w-full h-full outline-none"
            : `relative bg-owner-surface w-full ${maxWidthClass} max-h-[92dvh] overflow-y-auto overflow-x-hidden rounded-t-3xl md:rounded-3xl outline-none shadow-2xl md:mx-4`
        }
      >
        {children}
      </div>
    </div>
  );
}
