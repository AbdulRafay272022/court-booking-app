"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { isValidOtp } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { webDeviceInfo } from "@/lib/device";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { retryAfterSeconds, useCountdown } from "@/lib/use-countdown";
import { usePendingAuth } from "@/lib/pending-auth";
import { homeForRole, safeNext, useRedirectIfSignedIn } from "@/lib/use-auth-helpers";
import { AuthShell } from "@/components/auth/auth-shell";
import { FormMessage, TextField } from "@/components/auth/fields";
import { OtpControls, useOtpFlow } from "@/components/auth/otp-controls";
import { SubmitButton } from "@/components/auth/submit-button";

/** One OTP screen, two purposes -- and the copy says which:
 *  - purpose=signup:   "Verify your new account" (finishes signup, signs the user in)
 *  - purpose=reverify: "Verify your phone" (365 days passed, or signup was never finished;
 *                      proves the phone, then retries the password login) */
function VerifyForm() {
  const router = useRouter();
  const search = useSearchParams();
  const phone = search.get("phone") ?? "";
  const purpose = search.get("purpose") === "reverify" ? "reverify" : "signup";
  const role = search.get("role") === "owner" ? "owner" : "player";
  const pending = search.get("pending") === "1"; // arrived here because a signup was already in progress (item E)
  const next = safeNext(search.get("next"));
  const signedIn = useRedirectIfSignedIn();

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alreadyVerified, setAlreadyVerified] = useState(false); // QA #2: show a Log in button
  const submitting = useRef(false); // QA #8: block a rapid second submit before state updates
  const lock = useCountdown(); // QA #5: rate-limit retry countdown

  const flow = useOtpFlow(
    purpose,
    phone,
    async () => (await api.auth.requestOtp({ phone })).expires_in,
    () => {
      // QA #5: a successful resend clears a stale "too many attempts" banner / lock.
      setError(null);
      lock.start(0);
    },
  );
  const ready = isValidOtp(code) && !flow.expired && !alreadyVerified && lock.seconds === 0;

  useEffect(() => {
    if (!phone) router.replace("/login");
  }, [phone, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // QA #8: a ref (not state) guards against a double-tap firing two requests before re-render.
    if (!ready || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      if (purpose === "signup") {
        const res = await api.auth.verifySignupOtp({ phone, otp: code, ...webDeviceInfo() });
        useAuthStore.getState().signIn(res.token, res.user, res.expires_at);
        // A new owner goes straight into the venue-setup wizard; a player to where they were headed.
        router.replace(res.user.role === "owner" ? "/venue-setup/register" : (next ?? "/"));
        return;
      }

      // Re-verification: prove the phone, then log in with the password they already typed.
      await api.auth.reverifyPhone({ phone, otp: code });
      const password = usePendingAuth.getState().password;
      usePendingAuth.getState().setPassword(null);
      if (!password) {
        router.replace(`/login?phone=${encodeURIComponent(phone)}&notice=phone-verified`);
        return;
      }
      const res = await api.auth.login({ phone, password, ...webDeviceInfo() });
      useAuthStore.getState().signIn(res.token, res.user, res.expires_at);
      router.replace(next ?? homeForRole(res.user.role));
    } catch (err) {
      if (err instanceof ApiError && err.code === "ALREADY_VERIFIED") {
        // QA #2: a dropped-response retry after verify already succeeded -> offer Log in, not a
        // dead-end expired-code error.
        setAlreadyVerified(true);
        setError("This number is already verified — please log in.");
      } else if (
        err instanceof ApiError &&
        (err.code === "OTP_RATE_LIMITED" || err.code === "LOGIN_RATE_LIMITED" || err.code === "OTP_IP_RATE_LIMITED")
      ) {
        // QA #5: live countdown with the request-rate message.
        lock.start(retryAfterSeconds(err.details) || 60);
        setError(null);
      } else {
        setError(friendlyErrorMessage(err));
        // Clear the field for a fresh entry on a wrong/expired/superseded code (QA #10).
        if (err instanceof ApiError && ["INVALID_OTP", "OTP_EXPIRED", "OTP_SUPERSEDED"].includes(err.code)) setCode("");
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  if (signedIn || !phone) return null;

  return (
    <AuthShell
      tone={purpose === "signup" && role === "owner" ? "owner" : "player"}
      title={purpose === "signup" ? "Verify your new account" : "Verify your phone"}
      subtitle={
        <>
          {purpose === "signup"
            ? "Almost there. We sent a 6-digit code on WhatsApp to "
            : "For your security we need to confirm this number again. We sent a 6-digit code on WhatsApp to "}
          <span className="font-[family-name:var(--font-mono-x)] font-semibold">{phone}</span>.
        </>
      }
      footer={
        <Link href={purpose === "signup" ? "/signup" : "/login"} className="font-semibold underline">
          {purpose === "signup" ? "Wrong number? Start again" : "Back to log in"}
        </Link>
      }
    >
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
        {pending ? (
          <FormMessage kind="info">
            You already have a signup in progress for this number — check WhatsApp for your code, or tap Resend
            below. (Any details you just re-entered weren&apos;t saved.)
          </FormMessage>
        ) : null}
        <TextField
          label="Verification code"
          mono
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={6}
          value={code}
          disabled={flow.expired}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="••••••"
          className="text-center text-[22px] tracking-[0.35em]"
        />

        <OtpControls flow={flow} />

        {/* QA #8: reserve the banner's space so showing/hiding it never shifts the button below. */}
        <div className="min-h-[44px]">
          {lock.seconds > 0 ? (
            <FormMessage kind="error">Too many attempts. Please try again in {lock.seconds}s.</FormMessage>
          ) : error ? (
            <FormMessage kind="error">{error}</FormMessage>
          ) : null}
        </div>

        {alreadyVerified ? (
          <Link
            href={`/login?phone=${encodeURIComponent(phone)}&notice=phone-verified`}
            className="flex h-14 items-center justify-center rounded-2xl bg-player-accent text-white text-[16px] font-bold"
          >
            Log in
          </Link>
        ) : (
          <SubmitButton ready={ready} busy={busy} busyLabel="Verifying…">
            {lock.seconds > 0 ? `Try again in ${lock.seconds}s` : purpose === "signup" ? "Verify and continue" : "Verify"}
          </SubmitButton>
        )}
      </form>
    </AuthShell>
  );
}

export default function VerifyPage() {
  return (
    <Suspense>
      <VerifyForm />
    </Suspense>
  );
}
