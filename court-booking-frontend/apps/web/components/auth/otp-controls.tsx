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
    const stored = recallOtpExpiry(purpose, phone);
    if (stored) {
      setExpiresAt(stored);
      return;
    }
    // QA #10: a fresh tab/page load has no remembered expiry -- ask the server for the live
    // code's remaining time so the countdown is still correct.
    if (!phone) return;
    let cancelled = false;
    api.auth
      .otpStatus(phone)
      .then((s) => {
        if (cancelled || s.expires_in <= 0) return;
        rememberOtpExpiry(purpose, phone, s.expires_in);
        setExpiresAt(Date.now() + s.expires_in * 1000);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
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
