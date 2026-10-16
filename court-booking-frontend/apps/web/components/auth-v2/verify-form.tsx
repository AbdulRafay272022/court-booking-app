"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { isValidOtp } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";
import { useT } from "@/components/i18n/lang-provider";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { webDeviceInfo } from "@/lib/device";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { retryAfterSeconds, useCountdown } from "@/lib/use-countdown";
import { usePendingAuth } from "@/lib/pending-auth";
import { homeForRole, safeNext, useRedirectIfSignedIn } from "@/lib/use-auth-helpers";
import { useOtpFlow } from "@/components/auth/otp-controls";
import { AuthFrame } from "./frame";
import { FormNotice, SmartButton } from "./fields";
import { CodeField, OtpStatus } from "./otp-controls";

/** One OTP screen, two purposes -- and the copy says which:
 *  - purpose=signup:   "Verify your new account" (finishes signup, signs the user in)
 *  - purpose=reverify: "Verify your phone" (365 days passed, or signup was never finished;
 *                      proves the phone, then retries the password login) */
export function VerifyForm() {
  const t = useT();
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
      if (err instanceof ApiError && err.code === "PASSWORD_NOT_SET") {
        // The account has no password yet (see AuthService.login): proving the phone is not enough, so go to the set-password step
        // instead of a dead-end error. (The login screen normally sends such an account there before any code is requested.)
        router.replace(`/forgot-password?phone=${encodeURIComponent(phone)}&mode=set${next ? `&next=${encodeURIComponent(next)}` : ""}`);
        return;
      }
      if (err instanceof ApiError && err.code === "ALREADY_VERIFIED") {
        // QA #2: a dropped-response retry after verify already succeeded -> offer Log in, not a
        // dead-end expired-code error.
        setAlreadyVerified(true);
        setError(t("auth.verify.alreadyVerified"));
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

  const ownerSignup = purpose === "signup" && role === "owner";

  return (
    <AuthFrame
      brandBg={ownerSignup ? "teal" : "ink"}
      brandTitle={
        <>
          {t("auth.verify.brand.l1")}
          <br />
          {t("auth.verify.brand.l2")}<span className={ownerSignup ? "text-white" : "text-khelo-orange"}>Khelo.</span>
        </>
      }
      brandText={t("auth.verify.brand.text")}
    >
      <div className="w-full max-w-[420px]">
        <h1 className="m-0 font-khelo-display text-[34px] font-extrabold leading-[1.1] tracking-[-1px] min-[420px]:text-[42px] min-[420px]:leading-[1.05] min-[420px]:tracking-[-1.3px]">
          {purpose === "signup" ? t("auth.verify.title.signup") : t("auth.verify.title.reverify")}
        </h1>
        <p className="mt-3 text-[16px] leading-[1.6] text-khelo-muted">
          {purpose === "signup" ? t("auth.verify.intro.signup") : t("auth.verify.intro.reverify")}
          <span className="font-mono-plex font-semibold text-khelo-ink">{phone}</span>.
        </p>

        <form onSubmit={handleSubmit} noValidate className="mt-8 flex flex-col gap-5">
          {pending ? (
            <FormNotice kind="success">
              {t("auth.verify.pending")}
            </FormNotice>
          ) : null}
          <CodeField
            label={t("auth.field.codeLabel")}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={6}
            value={code}
            disabled={flow.expired}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder={"••••••"}
          />

          <OtpStatus flow={flow} />

          {/* Reserve the banner's space so showing/hiding it never shifts the button below (QA round 4 item 3). */}
          <div className="min-h-[60px]">
            {lock.seconds > 0 ? (
              <FormNotice kind="error">{t("auth.verify.locked", { seconds: lock.seconds })}</FormNotice>
            ) : error ? (
              <FormNotice kind="error">{error}</FormNotice>
            ) : null}
          </div>

          {alreadyVerified ? (
            <Link
              href={`/login?phone=${encodeURIComponent(phone)}&notice=phone-verified`}
              className="khelo-btn flex min-h-11 items-center justify-center rounded-[14px] bg-khelo-orange px-6 py-[18px] text-[17px] font-extrabold text-khelo-ink"
            >
              {t("auth.field.logIn")}
            </Link>
          ) : (
            <SmartButton ready={ready} busy={busy} busyLabel={t("auth.verify.busy")} theme={ownerSignup ? "owner" : "player"}>
              {lock.seconds > 0 ? t("auth.field.tryAgainIn", { seconds: lock.seconds }) : purpose === "signup" ? t("auth.verify.submit.signup") : t("auth.verify.submit.reverify")}
            </SmartButton>
          )}
        </form>

        <p className="mt-6 text-center text-[14px]">
          <Link
            href={purpose === "signup" ? "/signup" : "/login"}
            className="inline-flex min-h-11 items-center font-bold text-khelo-teal underline"
          >
            {purpose === "signup" ? t("auth.verify.back.signup") : t("auth.field.backToLogin")}
          </Link>
        </p>
      </div>
    </AuthFrame>
  );
}

