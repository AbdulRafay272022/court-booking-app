"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { countdown, isConfirmed, ringDash, type JourneyStepState, type StatusInput } from "@court-booking/ui-tokens";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "./Button";
import { StatusPill } from "./Basics";
import { ArrowLeft, Check, CircleAlert, Inbox, Info, WifiOff, X, type FlIcon } from "./icons";
import { cx, useFlCopy, useFlRole } from "./role";

/* ---------------- Skeleton ---------------- */

export function Skeleton({ className, shade = "soft" }: { className?: string; shade?: "strong" | "soft" | "photo" }) {
  const bg = shade === "strong" ? "bg-fl-line" : shade === "photo" ? "bg-fl-booked-bg" : "bg-fl-mist";
  return <span aria-hidden className={cx("block animate-pulse rounded-lg motion-reduce:animate-none", bg, className)} />;
}

export function SkeletonCard() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" className="overflow-hidden rounded-fl-card bg-fl-white">
      <Skeleton shade="photo" className="h-[140px] rounded-none" />
      <div className="flex flex-col gap-2.5 p-4">
        <Skeleton shade="strong" className="h-5 w-[55%]" />
        <Skeleton className="h-3.5 w-[80%]" />
        <div className="flex gap-2">
          <Skeleton className="h-10 w-[76px] rounded-fl-sm" />
          <Skeleton className="h-10 w-[76px] rounded-fl-sm" />
          <Skeleton className="h-10 w-[76px] rounded-fl-sm" />
        </div>
      </div>
    </div>
  );
}

/* ---------------- EmptyState / ErrorState / NotFound / OfflineBanner ---------------- */

export function EmptyState({ title, body, icon: Icon = Inbox, actionLabel, onAction }: { title: string; body?: string; icon?: FlIcon; actionLabel?: string; onAction?: () => void }) {
  return (
    <div data-testid="empty-state" className="flex flex-col items-center gap-3 px-4 py-8 text-center">
      <span className="flex h-[72px] w-[72px] items-center justify-center rounded-[22px] bg-fl-teal-tint text-fl-teal-deep">
        <Icon size={32} />
      </span>
      <h2 className="m-0 font-fl-display text-[20px] font-extrabold text-fl-night">{title}</h2>
      {body ? <p className="m-0 text-[14px] text-fl-muted">{body}</p> : null}
      {actionLabel && onAction ? <Button label={actionLabel} onClick={onAction} size="md" /> : null}
    </div>
  );
}

export function ErrorState({ title, message, onRetry, onBack, backLabel, reassurance, code }: { title?: string; message?: string; onRetry: () => void; onBack?: () => void; backLabel?: string; reassurance?: string; code?: string }) {
  const copy = useFlCopy();
  return (
    <div data-testid="error-state" role="alert" className="flex flex-col items-center gap-3.5 text-center">
      <span className="flex h-[88px] w-[88px] items-center justify-center rounded-fl-card-l bg-fl-danger-tint text-fl-danger">
        <CircleAlert size={40} />
      </span>
      <h2 className="m-0 font-fl-display text-[26px] font-extrabold text-fl-night">{title ?? copy("Kuch gadbad ho gayi", "Something went wrong")}</h2>
      {message || reassurance ? <p className="m-0 text-[15px] leading-normal text-fl-muted">{[message, reassurance].filter(Boolean).join(" ")}</p> : null}
      <Button label={copy("Dobara koshish", "Try again")} onClick={onRetry} block />
      {onBack ? <Button label={backLabel ?? copy("Wapas jayein", "Go back")} variant="soft" size="md" onClick={onBack} block icon={<ArrowLeft size={18} />} /> : null}
      {code ? <span className="text-[12px] text-fl-muted2">{copy(`Code: ${code} · WhatsApp madad mein batayein`, `Code: ${code} · mention it on WhatsApp support`)}</span> : null}
    </div>
  );
}

export function NotFound({ onHome, title, body }: { onHome: () => void; title?: string; body?: string }) {
  const copy = useFlCopy();
  return (
    <div data-testid="not-found" className="flex min-h-[480px] flex-col items-center justify-center gap-3.5 bg-fl-night px-7 text-center text-fl-white">
      <b className="font-fl-display text-[90px] leading-none tracking-[-4px] text-fl-orange">Out!</b>
      <h2 className="m-0 font-fl-display text-[26px] font-extrabold">{title ?? copy("Ye page court se bahar chala gaya", "This page went out of court")}</h2>
      <p className="m-0 text-[15px] text-fl-on-dark-muted">{body ?? copy("Link purana ho sakta hai ya venue band ho gaya hai.", "The link may be old or the venue may have closed.")}</p>
      <Button label={copy("Home par jayein", "Go home")} onClick={onHome} block />
    </div>
  );
}

export function OfflineBanner({ visible, onRetry }: { visible: boolean; onRetry?: () => void }) {
  const copy = useFlCopy();
  if (!visible) return null;
  return (
    <div role="alert" className="flex items-center gap-2.5 rounded-fl-input bg-fl-night px-3.5 py-3 text-fl-white">
      <WifiOff size={20} className="shrink-0 text-fl-amber" />
      <span className="flex-1 text-[14px]">{copy("Internet nahi hai. Purani info dikh rahi hai.", "No internet. You're seeing saved info.")}</span>
      {onRetry ? <Button label="Retry" size="sm" onClick={onRetry} /> : null}
    </div>
  );
}

/* ---------------- Toast ---------------- */

type ToastTone = "neutral" | "success" | "danger";
const ToastCtx = createContext<{ show: (o: { message: string; tone?: ToastTone; duration?: number } | string) => void }>({ show: () => undefined });
export function useToast() {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ id: number; message: string; tone?: ToastTone; duration?: number } | null>(null);
  const idRef = useRef(0);
  const show = useCallback((o: { message: string; tone?: ToastTone; duration?: number } | string) => {
    idRef.current += 1;
    setT({ id: idRef.current, ...(typeof o === "string" ? { message: o } : o) });
  }, []);
  useEffect(() => {
    if (!t) return;
    const ms = t.duration ?? (t.tone === "danger" ? 5000 : 3000);
    const id = setTimeout(() => setT(null), ms);
    return () => clearTimeout(id);
  }, [t]);
  return (
    <ToastCtx.Provider value={{ show }}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-6 z-[80] flex justify-center">
        {t ? <Toast key={t.id} message={t.message} tone={t.tone} /> : null}
      </div>
    </ToastCtx.Provider>
  );
}

export function Toast({ message, tone = "neutral" }: { message: string; tone?: ToastTone }) {
  const Icon = tone === "success" ? Check : tone === "danger" ? CircleAlert : Info;
  const ic = tone === "success" ? "text-fl-mint" : tone === "danger" ? "text-fl-amber" : "text-fl-on-dark-muted";
  return (
    <div role="status" className="flex max-w-[480px] items-center gap-2.5 rounded-fl-input bg-fl-night px-4 py-3 text-[14px] font-semibold text-fl-white shadow-fl-raised motion-safe:animate-[fl-toast-in_200ms_ease-out]">
      <Icon size={18} className={ic} />
      <span>{message}</span>
    </div>
  );
}

/* ---------------- CountdownRing ---------------- */

export function CountdownRing({ expiresAt, totalMs, caption, tone = "dark", diameter = 150, onExpire }: { expiresAt: string | null; totalMs?: number; caption?: string; tone?: "dark" | "light"; diameter?: number; onExpire?: () => void }) {
  const role = useFlRole();
  const copy = useFlCopy();
  // `now` starts null so the server render and the first client render match (no hydration mismatch); the clock starts after mount.
  const [now, setNow] = useState<number | null>(null);
  const c = countdown(expiresAt, now ?? 0, totalMs);
  const ticking = now !== null && !c.expired;
  useEffect(() => {
    setNow(Date.now());
  }, []);
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ticking]);
  useEffect(() => {
    if (now !== null && c.expired && expiresAt) onExpire?.();
  }, [now, c.expired, expiresAt, onExpire]);
  const stroke = 8;
  const r = diameter / 2 - stroke;
  const { circumference, offset } = ringDash(r, c.fraction);
  const dark = tone === "dark";
  const minutes = Math.ceil(c.msLeft / 60000);
  return (
    <div data-fl-role={role} role="timer" style={{ width: diameter, height: diameter, visibility: now === null ? "hidden" : "visible" }} aria-label={c.expired ? copy("Waqt khatam", "Time is up") : copy(`${minutes} minute baqi`, `${minutes} minutes left`)} className="relative">
      <svg width={diameter} height={diameter} viewBox={`0 0 ${diameter} ${diameter}`} aria-hidden>
        <circle cx={diameter / 2} cy={diameter / 2} r={r} fill="none" strokeWidth={stroke} className={dark ? "stroke-fl-a-ring-track-on-dark" : "stroke-fl-a-ring-track-on-light"} />
        <circle
          cx={diameter / 2}
          cy={diameter / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${diameter / 2} ${diameter / 2})`}
          className={c.expired ? "stroke-fl-danger" : dark ? "stroke-fl-role-ring-on-hero" : "stroke-fl-role-ring"}
        />
      </svg>
      <div className={cx("absolute inset-0 flex flex-col items-center justify-center", dark ? "text-fl-white" : "text-fl-night")}>
        <span className={cx("font-fl-display font-extrabold tabular-nums tracking-tight", diameter < 120 ? "text-[24px]" : "text-[34px]")}>{c.label}</span>
        {caption ? <span className={cx("text-[12px] font-bold", dark ? "text-fl-on-dark-muted" : "text-fl-muted")}>{caption}</span> : null}
      </div>
    </div>
  );
}

/* ---------------- Timeline ---------------- */

export function Timeline({ steps }: { steps: { label: string; sub?: string; state: JourneyStepState }[] }) {
  const copy = useFlCopy();
  const word = (s: JourneyStepState) => (s === "done" ? copy("ho gaya", "done") : s === "now" ? copy("abhi", "now") : s === "failed" ? copy("ruk gaya", "stopped") : copy("baqi", "next"));
  return (
    <ol className="m-0 list-none p-0">
      {steps.map((st, i) => {
        const last = i === steps.length - 1;
        const dot = st.state === "done" ? "bg-fl-teal text-fl-white" : st.state === "now" ? "bg-fl-waiting-tint border-[3px] border-fl-amber" : st.state === "failed" ? "bg-fl-danger text-fl-white" : "bg-fl-white border-2 border-fl-line-strong";
        const title = st.state === "now" ? "text-fl-waiting" : st.state === "next" ? "text-fl-muted2 font-bold" : st.state === "failed" ? "text-fl-danger" : "text-fl-night";
        return (
          <li key={`${i}-${st.label}`} className="flex gap-3.5">
            <div className="flex w-7 flex-none flex-col items-center">
              <span className={cx("flex h-7 w-7 items-center justify-center rounded-full", dot)}>
                {st.state === "done" ? <Check size={14} strokeWidth={3.2} /> : st.state === "failed" ? <X size={14} strokeWidth={3.2} /> : null}
              </span>
              {!last ? <span className={cx("min-h-[18px] w-0.5 flex-1", st.state === "done" ? "bg-fl-teal" : "bg-fl-line")} /> : null}
            </div>
            <div className={cx("flex flex-col gap-0.5 pt-[3px]", !last && "pb-[18px]")}>
              <span className={cx("text-[15px] font-extrabold", title)}>
                {st.label}
                <span className="sr-only">, {word(st.state)}</span>
              </span>
              {st.sub ? <span className="text-[13px] text-fl-muted">{st.sub}</span> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}


/* ---------------- Ticket ---------------- */

export function Ticket({ bookingId, booking, venueName, eyebrow, fields, qrTitle, qrBody }: { bookingId: string; booking: StatusInput; venueName: string; eyebrow?: string; fields: { label: string; value: string }[]; qrTitle?: string; qrBody?: string }) {
  const copy = useFlCopy();
  const ok = isConfirmed(booking.status);
  return (
    <div data-testid="ticket" className="overflow-hidden rounded-fl-card-l bg-fl-white shadow-fl-ticket">
      <div className="flex flex-col gap-3.5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-2.5">
          <div className="flex min-w-40 flex-1 flex-col gap-0.5">
            {eyebrow ? <span className="text-[12px] font-extrabold tracking-[0.1em] text-fl-muted2">{eyebrow}</span> : null}
            <span className="font-fl-display text-[24px] font-extrabold">{venueName}</span>
          </div>
          <StatusPill booking={booking} />
        </div>
        <dl className="m-0 grid grid-cols-2 gap-3">
          {fields.map((f) => (
            <div key={f.label} className="flex flex-col gap-0.5">
              <dt className="text-[12px] font-bold text-fl-muted2">{f.label}</dt>
              <dd className="m-0 text-[16px] font-extrabold tabular-nums">{f.value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div aria-hidden className="relative flex h-[22px] items-center">
        <span className="absolute -left-[11px] h-[22px] w-[22px] rounded-full bg-fl-ground" />
        <span className="mx-[18px] flex-1 border-t-2 border-dashed border-fl-line" />
        <span className="absolute -right-[11px] h-[22px] w-[22px] rounded-full bg-fl-ground" />
      </div>
      <div className="flex flex-wrap items-center gap-4 p-5 pt-4">
        {ok ? (
          <div role="img" aria-label="Check-in QR code" className="rounded-fl-md border border-fl-line bg-fl-white p-1.5 text-fl-night">
            <QRCodeSVG value={bookingId} size={100} fgColor="currentColor" bgColor="transparent" level="M" />
          </div>
        ) : null}
        <div className="flex min-w-[150px] flex-1 flex-col gap-1">
          <span className="text-[16px] font-extrabold">{ok ? qrTitle ?? copy("Gate par ye dikhayein", "Show this at the gate") : copy("QR pakki booking par milega", "QR appears once booked")}</span>
          <span className="text-[13px] text-fl-muted">
            {ok ? qrBody ?? copy("Venue scan karega aur aap ka check-in ho jayega.", "The venue scans it to check you in.") : copy("Venue ke approve karte hi yahan QR aa jayega.", "The QR shows here as soon as the venue approves.")}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Sheet / Dialog ---------------- */

/**
 * Bottom sheet on phones (< 640px), centered dialog on wider screens. Native <dialog> (focus trap, Esc, backdrop click
 * closes, focus returns). Same API as mobile <Sheet>.
 */
export function Sheet({ open, onClose, title, subtitle, footer, children, "data-testid": testId }: { open: boolean; onClose: () => void; title?: string; subtitle?: string; footer?: ReactNode; children: ReactNode; "data-testid"?: string }) {
  const role = useFlRole();
  const copy = useFlCopy();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      data-fl-role={role}
      data-testid={testId ?? "fl-sheet"}
      aria-label={title}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cx(
        "m-0 mt-auto w-full max-w-none rounded-t-fl-sheet border-0 bg-fl-white p-0 text-fl-night backdrop:bg-fl-a-scrim",
        "sm:m-auto sm:w-[480px] sm:rounded-fl-sheet max-h-[calc(100dvh-24px)]",
      )}
    >
      <div className="flex max-h-[calc(100dvh-24px)] flex-col">
        <div className="flex flex-col gap-4 overflow-y-auto px-5 pb-5 pt-2.5">
          <span aria-hidden className="mx-auto h-[5px] w-10 rounded-full bg-fl-line-strong sm:hidden" />
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              {title ? <h2 className="m-0 font-fl-display text-[24px] font-extrabold">{title}</h2> : null}
              {subtitle ? <span className="text-[13px] text-fl-muted">{subtitle}</span> : null}
            </div>
            <button type="button" aria-label={copy("Band karein", "Close")} onClick={onClose} className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-fl-mist text-fl-night">
              <X size={18} strokeWidth={2.4} />
            </button>
          </div>
          {children}
        </div>
        {footer ? <div className="border-t border-fl-divider px-5 pb-5 pt-3">{footer}</div> : null}
      </div>
    </dialog>
  );
}

