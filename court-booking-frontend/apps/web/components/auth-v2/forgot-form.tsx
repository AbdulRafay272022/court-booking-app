"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { isValidPkMobile, toE164 } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";
import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { rememberOtpExpiry } from "@/lib/pending-auth";
import { retryAfterSeconds, useCountdown } from "@/lib/use-countdown";
import { AuthFrame } from "./frame";
import { CountryPrefix, FormNotice, SmartButton, TextField } from "./fields";

/** Step 1 of password reset (also how a pre-Section-26 account SETS its first password,
 * `mode=set`): ask for a WhatsApp code. The reply is the same whether or not the number has
 * an account, so this screen can't be used to find out who's registered. */
export function ForgotForm() {
  const router = useRouter();
  const search = useSearchParams();
  const setMode = search.get("mode") === "set";

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
    <AuthFrame
      brandTitle={
        <>
          Password bhool gaye?
          <br />
          Koi baat nahi. <span className="text-khelo-orange">Khelo.</span>
        </>
      }
      brandText="Apna number daalo, hum WhatsApp par code bhejenge. Naya password banao aur wapas court par."
    >
      <div className="w-full max-w-[420px]">
        <h1 className="m-0 font-khelo-display text-[34px] font-extrabold leading-[1.1] tracking-[-1px] min-[420px]:text-[42px] min-[420px]:leading-[1.05] min-[420px]:tracking-[-1.3px]">
          {setMode ? "Set your password" : "Reset your password"}
        </h1>
        <p className="mt-3 text-[16px] leading-[1.6] text-khelo-muted">
          {setMode
            ? "Khelo accounts now use a password. Confirm your number on WhatsApp, then choose one."
            : "Enter your mobile number and we'll send a code on WhatsApp."}
        </p>

        <form onSubmit={handleSubmit} noValidate className="mt-8 flex flex-col gap-5">
          <TextField
            label="Mobile number"
            type="tel"
            inputMode="numeric"
            autoFocus
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
            onBlur={() => setTouched(true)}
            error={valid ? null : "Enter a valid mobile number, e.g. 300 1234567"}
            showError={touched}
            autoComplete="tel-national"
            placeholder="300 1234567"
            prefix={<CountryPrefix />}
          />
          {lock.seconds > 0 ? (
            <FormNotice kind="error">Too many code requests. Please try again in {lock.seconds}s.</FormNotice>
          ) : error ? (
            <FormNotice kind="error">
              {error}
              {noAccount ? (
                <>
                  {" "}
                  <Link href={`/signup?phone=${encodeURIComponent(toE164(phone))}`} className="font-bold underline">
                    Sign up
                  </Link>
                </>
              ) : null}
            </FormNotice>
          ) : null}
          <SmartButton ready={valid && lock.seconds === 0} busy={busy} busyLabel={"Sending code…"} className="mt-1.5">
            {lock.seconds > 0 ? `Try again in ${lock.seconds}s` : "Send code"}
          </SmartButton>
        </form>

        <p className="mt-6 text-center text-[14px]">
          <Link href="/login" className="inline-flex min-h-11 items-center font-bold text-khelo-teal underline">
            Back to log in
          </Link>
        </p>
      </div>
    </AuthFrame>
  );
}

