"use client";

import { useEffect, useState } from "react";
import { formatCountdown } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";
import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { recallOtpExpiry, rememberOtpExpiry } from "@/lib/pending-auth";
import { retryAfterSeconds, useCountdown } from "@/lib/use-countdown";
import { useCooldown, useSecondsUntil } from "@/lib/use-auth-helpers";
import { TONES, type Tone } from "./tone";

const RESEND_COOLDOWN_SECONDS = 30;
const RATE_LIMIT_CODES = new Set(["OTP_RATE_LIMITED", "OTP_IP_RATE_LIMITED"]);

/** Two separate clocks on every OTP screen -- keep both, don't merge them:
 *  1. the code's own expiry (backend `expires_in`, 300s), shown as MM:SS and, at zero, the
 *     field is disabled and "Code expired" appears;
 *  2. a short resend cooldown (30s) so "Resend code" can't be hammered.
 * The expiry start value is whatever `expires_in` the backend returned when the code was
 * requested (remembered per phone+purpose), never a hardcoded 300. */
export function useOtpFlow(
  purpose: string,
  phone: string,
  requestNewCode: () => Promise<number>,
  onResendSuccess?: () => void,
) {
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const secondsLeft = useSecondsUntil(expiresAt);
  const cooldown = useCooldown(RESEND_COOLDOWN_SECONDS);
  const rateLock = useCountdown(); // QA #5: a rate-limited (429) resend shows a real countdown
  const [resending, setResending] = useState(false);
  const [resendError, setResendError] = useState<string | null>(null);

  useEffect(() => {
    if (!phone) return;
    let cancelled = false;

    // Seed from the tab's own sessionStorage if we set an expiry there earlier -- the same-tab
    // fast path when the screen was just opened from signup/reset via a client-side navigation.
    const stored = recallOtpExpiry(purpose, phone);
    if (stored) setExpiresAt(stored);

    // QA round 4 item 2: an already-open tab must not go stale when the user resends (or a
    // second tab / device resends) elsewhere. Poll /auth/otp-status on mount, on window focus,
    // on `visibilitychange`, and every ~25s while mounted; when the server says a newer code is
    // live, adopt its expiry so an inaccurate "Code expired" state clears on its own within
    // one polling interval or the next focus. Errors are swallowed (offline / transient) --
    // the countdown then keeps running against whatever it last knew about.
    async function refresh() {
      try {
        const s = await api.auth.otpStatus(phone);
        if (cancelled) return;
        if (s.expires_in <= 0) return; // no live code -- leave the current state alone
        const nextExpiresAt = Date.now() + s.expires_in * 1000;
        setExpiresAt((prev) => {
          // Only adopt if the server says the code lives longer than we thought (a resend), or we
          // didn't know about a live code at all. Tolerate 3s of clock skew so we don't churn.
          if (prev === null || nextExpiresAt > prev + 3_000) {
            rememberOtpExpiry(purpose, phone, s.expires_in);
            return nextExpiresAt;
          }
          return prev;
        });
      } catch {
        // ignored -- the countdown keeps running from its last known value
      }
    }

    // First live check happens right after mount so a cold tab (no stored expiry) still gets a
    // real countdown.
    void refresh();
    const interval = setInterval(refresh, 25_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", refresh);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", refresh);
    };
  }, [purpose, phone]);

  async function resend() {
    if (resending || cooldown.left > 0 || rateLock.seconds > 0) return;
    setResending(true);
    setResendError(null);
    try {
      const expiresIn = await requestNewCode();
      rememberOtpExpiry(purpose, phone, expiresIn);
      setExpiresAt(Date.now() + expiresIn * 1000);
      cooldown.restart();
      // QA #5: a successful resend clears any stale "too many attempts" banner the screen was showing.
      onResendSuccess?.();
    } catch (e) {
      if (e instanceof ApiError && RATE_LIMIT_CODES.has(e.code)) {
        rateLock.start(retryAfterSeconds(e.details) || 60); // live countdown instead of a bare message
      } else {
        setResendError(friendlyErrorMessage(e));
      }
    } finally {
      setResending(false);
    }
  }

  return {
    secondsLeft,
    expired: secondsLeft === 0,
    resendLeft: cooldown.left,
    resendLockSeconds: rateLock.seconds,
    resending,
    resendError,
    resend,
  };
}

export function OtpControls({ flow, tone = "player" }: { flow: ReturnType<typeof useOtpFlow>; tone?: Tone }) {
  const t = TONES[tone];
  const { secondsLeft, expired, resendLeft, resendLockSeconds, resending, resendError, resend } = flow;
  const canResend = resendLeft === 0 && resendLockSeconds === 0 && !resending;
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      {secondsLeft === null ? null : expired ? (
        <p role="alert" className="text-[14px] font-bold" style={{ color: t.danger }}>
          Code expired
        </p>
      ) : (
        <p className="text-[14px] font-medium" style={{ color: t.muted }} aria-live="off">
          Code expires in{" "}
          <span className="font-[family-name:var(--font-mono-x)] font-semibold" style={{ color: t.ink }}>
            {formatCountdown(secondsLeft)}
          </span>
        </p>
      )}

      {canResend ? (
        <button type="button" onClick={resend} className="min-h-11 px-4 text-[14px] font-bold" style={{ color: t.accent }}>
          Resend code
        </button>
      ) : resendLockSeconds > 0 ? (
        <p role="alert" className="min-h-11 flex items-center text-[13.5px] font-medium" style={{ color: t.danger }}>
          Too many code requests — resend in{" "}
          <span className="font-[family-name:var(--font-mono-x)] font-semibold ml-1" style={{ color: t.danger }}>
            {formatCountdown(resendLockSeconds)}
          </span>
        </p>
      ) : (
        <p className="min-h-11 flex items-center text-[14px] font-medium" style={{ color: t.faint }}>
          {resending ? "Sending…" : "Resend in "}
          {resending ? null : (
            <span className="font-[family-name:var(--font-mono-x)] font-semibold ml-1" style={{ color: t.muted }}>
              {formatCountdown(resendLeft)}
            </span>
          )}
        </p>
      )}
      {resendError ? (
        <p role="alert" className="text-[13px] font-medium" style={{ color: t.danger }}>
          {resendError}
        </p>
      ) : null}
    </div>
  );
}
