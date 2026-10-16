"use client";

import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import type { ReactNode, RefObject } from "react";
import { useT } from "@/components/i18n/lang-provider";

const NARROW_QUERY = "(max-width: 767.98px)";

function subscribeNarrow(cb: () => void) {
  const mq = window.matchMedia(NARROW_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/** True below 768px (phone): popovers become bottom sheets and the table becomes a card list. Desktop on the server. */
export function useIsNarrow(): boolean {
  return useSyncExternalStore(
    subscribeNarrow,
    () => window.matchMedia(NARROW_QUERY).matches,
    () => false,
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Focus goes in when it opens and back to the opener when it closes; Escape closes; `trap` keeps Tab inside. */
function useDialogBehavior(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void, trap: boolean) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const panel = ref.current;
    const first = panel?.querySelector<HTMLElement>("[data-autofocus]") ?? panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab" || !trap || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [open, ref, trap]);
}

function CloseButton({ onClick }: { onClick: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t("ovw.kpi.close")}
      className="shrink-0 w-11 h-11 -mr-2 -mt-2 flex items-center justify-center rounded-full text-khelo-muted hover:bg-khelo-page"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden="true">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
}

/** A modal dialog: centred card on desktop, bottom sheet below 768px. */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  size = "md",
  testId,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  size?: "md" | "lg";
  testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialogBehavior(ref, open, onClose, true);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center" data-testid={testId}>
      <div className="absolute inset-0 bg-khelo-ink/45" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative w-full ${size === "lg" ? "md:max-w-4xl" : "md:max-w-lg"} max-h-[92vh] md:max-h-[88vh] overflow-y-auto overscroll-contain bg-khelo-surface rounded-t-3xl md:rounded-3xl p-5 md:p-7 shadow-2xl outline-none`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={titleId} className="font-khelo-display font-extrabold text-2xl text-khelo-ink leading-tight">
              {title}
            </h2>
            {subtitle ? <p className="mt-1 text-sm text-khelo-muted">{subtitle}</p> : null}
          </div>
          <CloseButton onClick={onClose} />
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

/**
 * A popover that hangs under its trigger on desktop (put it inside a `relative` wrapper next to the trigger) and is a bottom
 * sheet below 768px. Closes on Escape and on a click outside.
 */
export function Popover({
  open,
  onClose,
  title,
  children,
  align = "left",
  width = "w-80",
  testId,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  align?: "left" | "right";
  width?: string;
  testId?: string;
}) {
  const narrow = useIsNarrow();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialogBehavior(ref, open, onClose, narrow);

  useEffect(() => {
    if (!open || narrow) return;
    function onDown(e: PointerEvent) {
      const panel = ref.current;
      if (!panel) return;
      const target = e.target as Node;
      // a click on the trigger (the panel's parent wrapper) is handled by the trigger's own toggle
      if (!panel.contains(target) && !panel.parentElement?.contains(target)) onClose();
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, narrow, onClose]);

  if (!open) return null;
  if (narrow) {
    return (
      <div className="fixed inset-0 z-50 flex items-end" data-testid={testId}>
        <div className="absolute inset-0 bg-khelo-ink/45" onClick={onClose} aria-hidden="true" />
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          className="relative w-full max-h-[80vh] overflow-y-auto overscroll-contain bg-khelo-surface rounded-t-3xl p-5 shadow-2xl outline-none"
        >
          <div className="flex items-start justify-between gap-3">
            <h2 id={titleId} className="font-khelo-display font-extrabold text-xl text-khelo-ink">
              {title}
            </h2>
            <CloseButton onClick={onClose} />
          </div>
          <div className="mt-3">{children}</div>
        </div>
      </div>
    );
  }
  return (
    <div
      ref={ref}
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      data-testid={testId}
      className={`absolute z-40 top-full mt-2 ${align === "right" ? "right-0" : "left-0"} ${width} max-w-[90vw] max-h-[70vh] overflow-y-auto bg-khelo-surface border border-khelo-border rounded-2xl shadow-xl p-4 outline-none`}
    >
      <p id={titleId} className="font-khelo-display font-extrabold text-base text-khelo-ink mb-2">
        {title}
      </p>
      {children}
    </div>
  );
}
