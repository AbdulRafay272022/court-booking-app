"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toE164, validateLogin } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";
import { useT } from "@/components/i18n/lang-provider";
import { translateErrors } from "@/lib/validation-text";
import type { MessageKey } from "@/lib/i18n";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { webDeviceInfo } from "@/lib/device";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { rememberOtpExpiry, usePendingAuth } from "@/lib/pending-auth";
import { retryAfterSeconds, useCountdown } from "@/lib/use-countdown";
import { homeForRole, safeNext } from "@/lib/use-auth-helpers";
import { AuthFrame } from "./frame";
import { CountryPrefix, FormNotice, PasswordField, SmartButton, TextField } from "./fields";

const NOTICES: Record<string, MessageKey> = {
  "password-updated": "auth.login.notice.passwordUpdated",
  "phone-verified": "auth.login.notice.phoneVerified",
  "phone-changed": "auth.login.notice.phoneChanged",
};

const BRAND_CHIP = "rounded-full bg-white/10 px-4 py-2.5 text-[13px] font-bold";

/** Login screen (Khelo design). Behaviour is identical to the previous page: only the markup changed. */
export function LoginForm() {
  const t = useT();
  const router = useRouter();
  const search = useSearchParams();
  const next = safeNext(search.get("next"));
  const noticeKey = NOTICES[search.get("notice") ?? ""];
  const notice = noticeKey ? t(noticeKey) : null;
  // Signed-in visitors are sent away from /login, like useRedirectIfSignedIn, but to `next` when there is one: the
  // shared hook always goes home, and on a fresh login it raced the handler's own redirect and dropped `next`.
  const status = useAuthStore((s) => s.status);
  const role = useAuthStore((s) => s.user?.role);
  const signedIn = status === "signedIn";
  useEffect(() => {
    if (status === "signedIn" && role) router.replace(next ?? homeForRole(role));
  }, [status, role, next, router]);

  const [phone, setPhone] = useState(search.get("phone")?.replace(/^\+92/, "") ?? "");
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState({ phone: false, password: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noAccount, setNoAccount] = useState(false); // QA #12: show a Sign up CTA, no OTP flow
  const lock = useCountdown(); // QA #5: LOGIN_RATE_LIMITED retry countdown

  const rawErrors = validateLogin({ phone, password });
  const valid = Object.keys(rawErrors).length === 0;
  const errors = translateErrors(t, rawErrors);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy || lock.seconds > 0) return;
    setBusy(true);
    setError(null);
    setNoAccount(false);
    const e164 = toE164(phone);
    try {
      const res = await api.auth.login({ phone: e164, password, ...webDeviceInfo() });
      useAuthStore.getState().signIn(res.token, res.user, res.expires_at);
      router.replace(next ?? homeForRole(res.user.role));
    } catch (err) {
      if (err instanceof ApiError && err.code === "USER_NOT_FOUND") {
        // QA #12: no account for this number -> tell them to sign up; never start an OTP/reset flow.
        setNoAccount(true);
        setError(t("auth.field.noAccount"));
      } else if (err instanceof ApiError && err.code === "LOGIN_RATE_LIMITED") {
        lock.start(retryAfterSeconds(err.details) || 60);
        setError(null);
      } else if (err instanceof ApiError && err.code === "PHONE_REVERIFICATION_REQUIRED") {
        // Not a wrong password: the phone needs proving again (never verified, or >365 days).
        // Send a code, keep the password in memory for the retry, and go to the OTP screen.
        try {
          const otp = await api.auth.requestOtp({ phone: e164 });
          rememberOtpExpiry("reverify", e164, otp.expires_in);
          usePendingAuth.getState().setPassword(password);
          const qs = new URLSearchParams({ purpose: "reverify", phone: e164 });
          if (next) qs.set("next", next);
          router.push(`/verify?${qs.toString()}`);
          return;
        } catch (otpErr) {
          setError(friendlyErrorMessage(otpErr));
        }
      } else if (err instanceof ApiError && err.code === "PASSWORD_NOT_SET") {
        // Account from before passwords existed: set one through the reset flow.
        router.push(`/forgot-password?phone=${encodeURIComponent(e164)}&mode=set${next ? `&next=${encodeURIComponent(next)}` : ""}`);
        return;
      } else {
        setError(friendlyErrorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  if (signedIn) return null;

  const signupQs = next ? `?next=${encodeURIComponent(next)}` : "";
  const ownerSignupQs = `?role=owner${next ? `&next=${encodeURIComponent(next)}` : ""}`;

  return (
    <AuthFrame
      brandTitle={
        <>
          {t("auth.login.brand.l1")}
          <br />
          {t("auth.login.brand.l2")}
          <br />
          <span className="text-khelo-orange">Khelo.</span>
        </>
      }
      brandText={t("auth.login.brand.text")}
      brandExtra={
        <ul className="m-0 mt-8 flex list-none flex-wrap gap-2.5 p-0">
          <li className={BRAND_CHIP}>{t("auth.login.brand.chip1")}</li>
          <li className={BRAND_CHIP}>{t("auth.login.brand.chip2")}</li>
          <li className={BRAND_CHIP}>{t("auth.login.brand.chip3")}</li>
        </ul>
      }
    >
      <div className="w-full max-w-[420px]">
        <h1 className="m-0 font-khelo-display text-[42px] font-extrabold leading-[1.05] tracking-[-1.3px]">{t("auth.login.title")}</h1>
        <p className="mt-3 text-[16px] leading-[1.6] text-khelo-muted">{t("auth.login.subtitle")}</p>

        <form onSubmit={handleSubmit} noValidate className="mt-8 flex flex-col gap-5">
          {notice ? <FormNotice kind="success">{notice}</FormNotice> : null}

          <TextField
            label={t("auth.field.mobile")}
            type="tel"
            inputMode="numeric"
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
            onBlur={() => setTouched((p) => ({ ...p, phone: true }))}
            error={errors.phone}
            showError={touched.phone}
            autoComplete="tel-national"
            placeholder="300 1234567"
            prefix={<CountryPrefix />}
          />
          <PasswordField
            label={t("auth.field.password")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={() => setTouched((p) => ({ ...p, password: true }))}
            error={errors.password}
            showError={touched.password}
            autoComplete="current-password"
            placeholder={t("auth.login.passwordPlaceholder")}
            aside={
              <Link
                href={`/forgot-password${valid || phone ? `?phone=${encodeURIComponent(toE164(phone))}` : ""}`}
                className="inline-flex min-h-11 items-center text-[14px] font-bold text-khelo-orange-text"
              >
                {t("auth.login.forgot")}
              </Link>
            }
          />

          {lock.seconds > 0 ? (
            <FormNotice kind="error">{t("auth.login.locked", { seconds: lock.seconds })}</FormNotice>
          ) : error ? (
            <FormNotice kind="error">
              {error}
              {noAccount ? (
                <>
                  {" "}
                  <Link href={`/signup?phone=${encodeURIComponent(toE164(phone))}`} className="font-bold underline">
                    {t("auth.field.signUp")}
                  </Link>
                </>
              ) : null}
            </FormNotice>
          ) : null}

          <SmartButton ready={valid && lock.seconds === 0} busy={busy} busyLabel={t("auth.login.busy")} className="mt-1.5">
            {lock.seconds > 0 ? t("auth.field.tryAgainIn", { seconds: lock.seconds }) : t("auth.field.logIn")}
          </SmartButton>
        </form>

        <div className="my-7 flex items-center gap-3.5 text-[13px] font-semibold text-khelo-muted-2" aria-hidden="true">
          <div className="h-px flex-1 bg-khelo-border" />
          {t("auth.login.or")}
          <div className="h-px flex-1 bg-khelo-border" />
        </div>

        <Link
          href={`/signup${signupQs}`}
          className="khelo-btn block min-h-11 rounded-[14px] border-[1.5px] border-khelo-ink px-6 py-[17px] text-center text-[16px] font-extrabold"
        >
          {t("auth.login.createAccount")}
        </Link>
        <p className="mt-[22px] text-center text-[14px] text-khelo-muted">
          {t("auth.login.ownerPrompt")}{" "}
          <Link href={`/signup${ownerSignupQs}`} className="font-bold text-khelo-teal underline">
            {t("auth.login.ownerLink")}
          </Link>
        </p>
      </div>
    </AuthFrame>
  );
}
