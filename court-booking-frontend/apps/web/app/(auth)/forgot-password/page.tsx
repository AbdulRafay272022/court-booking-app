"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { isValidPkMobile, toE164 } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";
import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { rememberOtpExpiry } from "@/lib/pending-auth";
import { retryAfterSeconds, useCountdown } from "@/lib/use-countdown";
import { AuthShell } from "@/components/auth/auth-shell";
import { FormMessage, TextField } from "@/components/auth/fields";
import { SubmitButton } from "@/components/auth/submit-button";
import { TONES } from "@/components/auth/tone";

/** Step 1 of password reset (also how a pre-Section-26 account SETS its first password,
 * `mode=set`): ask for a WhatsApp code. The reply is the same whether or not the number has
 * an account, so this screen can't be used to find out who's registered. */
function ForgotForm() {
  const router = useRouter();
  const search = useSearchParams();
  const setMode = search.get("mode") === "set";
  const t = TONES.player;

  const [phone, setPhone] = useState(search.get("phone")?.replace(/^\+92/, "") ?? "");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noAccount, setNoAccount] = useState(false); // NEW BUG 1: show Sign up, don't proceed
  const lock = useCountdown(); // QA #5

  const valid = isValidPkMobile(phone);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy || lock.seconds > 0) return;
    setBusy(true);
    setError(null);
    setNoAccount(false);
    try {
      const e164 = toE164(phone);
      const res = await api.auth.requestPasswordReset({ phone: e164 });
      rememberOtpExpiry("password_reset", e164, res.expires_in);
      router.push(`/reset-password?phone=${encodeURIComponent(e164)}${setMode ? "&mode=set" : ""}`);
    } catch (err) {
      // NEW BUG 1: no account -> tell them to sign up; never advance to the code screen (we only
      // navigate on a successful send above).
      if (err instanceof ApiError && err.code === "USER_NOT_FOUND") {
        setNoAccount(true);
        setError("No account found for this number. Please sign up.");
      } else if (
        err instanceof ApiError &&
        (err.code === "OTP_RATE_LIMITED" || err.code === "OTP_IP_RATE_LIMITED")
      ) {
        lock.start(retryAfterSeconds(err.details) || 60);
      } else {
        setError(friendlyErrorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title={setMode ? "Set your password" : "Reset your password"}
      subtitle={
        setMode
          ? "Maidan accounts now use a password. Confirm your number on WhatsApp, then choose one."
          : "Enter your mobile number and we'll send a code on WhatsApp."
      }
      footer={
        <Link href="/login" className="font-bold underline" style={{ color: t.accent }}>
          Back to log in
        </Link>
      }
    >
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
        <TextField
          label="Mobile number"
          mono
          inputMode="numeric"
          autoFocus
          value={phone}
          onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
          onBlur={() => setTouched(true)}
          error={valid ? null : "Enter a valid mobile number, e.g. 300 1234567"}
          showError={touched}
          autoComplete="tel-national"
          placeholder="300 4408817"
          prefix={
            <span className="font-[family-name:var(--font-mono-x)] text-[15px] font-semibold" style={{ color: t.muted }}>
              +92
            </span>
          }
        />
        {lock.seconds > 0 ? (
          <FormMessage kind="error">Too many code requests. Please try again in {lock.seconds}s.</FormMessage>
        ) : error ? (
          <FormMessage kind="error">
            {error}
            {noAccount ? (
              <>
                {" "}
                <Link href={`/signup?phone=${encodeURIComponent(toE164(phone))}`} className="font-bold underline" style={{ color: t.accent }}>
                  Sign up
                </Link>
              </>
            ) : null}
          </FormMessage>
        ) : null}
        <SubmitButton ready={valid && lock.seconds === 0} busy={busy} busyLabel="Sending code…">
          {lock.seconds > 0 ? `Try again in ${lock.seconds}s` : "Send code"}
        </SubmitButton>
      </form>
    </AuthShell>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense>
      <ForgotForm />
    </Suspense>
  );
}
