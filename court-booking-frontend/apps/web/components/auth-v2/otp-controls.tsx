"use client";

import { useId, type InputHTMLAttributes } from "react";
import { formatCountdown } from "@court-booking/types";
import { ERROR_TEXT } from "./fields";
import type { useOtpFlow } from "@/components/auth/otp-controls";

/** Khelo styling of the WhatsApp-code screens. The timers and resend rules live in `useOtpFlow` (unchanged). */

/** The 6-digit code input: a labelled, centred mono field. */
export function CodeField({ label, ...input }: { label: string } & Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "className">) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-[14px] font-bold">
        {label}
      </label>
      <input
        {...input}
        id={id}
        className="khelo-input w-full box-border rounded-[14px] border-[1.5px] border-khelo-border bg-white px-[18px] py-[17px] text-center font-mono-plex text-[22px] tracking-[0.35em] text-khelo-ink placeholder:text-khelo-muted-3 disabled:opacity-50"
      />
    </div>
  );
}

/** Expiry clock, resend button / cooldown, and resend errors. */
export function OtpStatus({ flow }: { flow: ReturnType<typeof useOtpFlow> }) {
  const { secondsLeft, expired, resendLeft, resendLockSeconds, resending, resendError, resend } = flow;
  const canResend = resendLeft === 0 && resendLockSeconds === 0 && !resending;
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      {secondsLeft === null ? null : expired ? (
        <p role="alert" className={`text-[14px] font-bold ${ERROR_TEXT}`}>
          Code expired
        </p>
      ) : (
        <p className="text-[14px] font-medium text-khelo-muted" aria-live="off">
          Code expires in <span className="font-mono-plex font-semibold text-khelo-ink">{formatCountdown(secondsLeft)}</span>
        </p>
      )}

      {canResend ? (
        <button type="button" onClick={resend} className="min-h-11 cursor-pointer px-4 text-[14px] font-bold text-khelo-orange-text underline">
          Resend code
        </button>
      ) : resendLockSeconds > 0 ? (
        <p role="alert" className={`flex min-h-11 items-center text-[14px] font-semibold ${ERROR_TEXT}`}>
          Too many code requests &mdash; resend in{" "}
          <span className="ml-1 font-mono-plex font-semibold">{formatCountdown(resendLockSeconds)}</span>
        </p>
      ) : (
        <p className="flex min-h-11 items-center text-[14px] font-medium text-khelo-muted-2">
          {resending ? "Sending…" : "Resend in "}
          {resending ? null : <span className="ml-1 font-mono-plex font-semibold text-khelo-muted">{formatCountdown(resendLeft)}</span>}
        </p>
      )}
      {resendError ? (
        <p role="alert" className={`text-[13px] font-semibold ${ERROR_TEXT}`}>
          {resendError}
        </p>
      ) : null}
    </div>
  );
}
