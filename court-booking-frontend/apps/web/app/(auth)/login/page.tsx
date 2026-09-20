"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toE164, validateLogin } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { webDeviceInfo } from "@/lib/device";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { rememberOtpExpiry, usePendingAuth } from "@/lib/pending-auth";
import { homeForRole, safeNext, useRedirectIfSignedIn } from "@/lib/use-auth-helpers";
import { AuthShell } from "@/components/auth/auth-shell";
import { FormMessage, PasswordField, TextField } from "@/components/auth/fields";
import { SubmitButton } from "@/components/auth/submit-button";
import { TONES } from "@/components/auth/tone";

const NOTICES: Record<string, string> = {
  "password-updated": "Password updated. Log in with your new password.",
  "phone-verified": "Phone verified. Log in to continue.",
  "phone-changed": "Phone number updated. Log in with your new number.",
};

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const next = safeNext(search.get("next"));
  const notice = NOTICES[search.get("notice") ?? ""] ?? null;
  const signedIn = useRedirectIfSignedIn();
  const t = TONES.player;

  const [phone, setPhone] = useState(search.get("phone")?.replace(/^\+92/, "") ?? "");
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState({ phone: false, password: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const errors = validateLogin({ phone, password });
  const valid = Object.keys(errors).length === 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    const e164 = toE164(phone);
    try {
      const res = await api.auth.login({ phone: e164, password, ...webDeviceInfo() });
      useAuthStore.getState().signIn(res.token, res.user, res.expires_at);
      router.replace(next ?? homeForRole(res.user.role));
    } catch (err) {
      if (err instanceof ApiError && err.code === "PHONE_REVERIFICATION_REQUIRED") {
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
        router.push(`/forgot-password?phone=${encodeURIComponent(e164)}&mode=set`);
        return;
      } else {
        setError(friendlyErrorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  if (signedIn) return null;

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Log in with your mobile number and password."
      footer={
        <>
          New to Maidan?{" "}
          <Link href={next ? `/signup?next=${encodeURIComponent(next)}` : "/signup"} className="font-bold underline" style={{ color: t.accent }}>
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
        {notice ? <FormMessage kind="success">{notice}</FormMessage> : null}

        <TextField
          label="Mobile number"
          mono
          inputMode="numeric"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onBlur={() => setTouched((p) => ({ ...p, phone: true }))}
          error={errors.phone}
          showError={touched.phone}
          autoComplete="tel-national"
          placeholder="300 4408817"
          prefix={
            <span className="font-[family-name:var(--font-mono-x)] text-[15px] font-semibold" style={{ color: t.muted }}>
              +92
            </span>
          }
        />
        <div className="flex flex-col gap-2">
          <PasswordField
            label="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={() => setTouched((p) => ({ ...p, password: true }))}
            error={errors.password}
            showError={touched.password}
            autoComplete="current-password"
            placeholder="Your password"
          />
          <Link
            href={`/forgot-password${valid || phone ? `?phone=${encodeURIComponent(toE164(phone))}` : ""}`}
            className="self-end text-[13.5px] font-bold"
            style={{ color: t.accent }}
          >
            Forgot password?
          </Link>
        </div>

        {error ? <FormMessage kind="error">{error}</FormMessage> : null}

        <SubmitButton ready={valid} busy={busy} busyLabel="Logging in…">
          Log in
        </SubmitButton>
      </form>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
