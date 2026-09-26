"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { isValidOtp, validateNewPassword } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";
import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useAuthStore } from "@/lib/auth-store";
import { suppressAuthRedirect } from "@/lib/use-require-auth";
import { AuthShell } from "@/components/auth/auth-shell";
import { FormMessage, PasswordField, TextField } from "@/components/auth/fields";
import { OtpControls, useOtpFlow } from "@/components/auth/otp-controls";
import { SubmitButton } from "@/components/auth/submit-button";

/** Step 2 of password reset: the WhatsApp code plus the new password. Success ends every
 * session for the account (other devices are logged out) and returns to the login screen. */
function ResetForm() {
  const router = useRouter();
  const search = useSearchParams();
  const phone = search.get("phone") ?? "";
  const setMode = search.get("mode") === "set";

  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [touched, setTouched] = useState({ password: false, confirmPassword: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const flow = useOtpFlow(
    "password_reset",
    phone,
    async () => (await api.auth.requestPasswordReset({ phone })).expires_in,
    () => setError(null), // QA #5: clear a stale banner after a successful resend
  );
  const errors = validateNewPassword({ password, confirmPassword });
  const ready = isValidOtp(code) && !flow.expired && Object.keys(errors).length === 0;

  useEffect(() => {
    if (!phone) router.replace("/forgot-password");
  }, [phone, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.auth.verifyPasswordReset({ phone, otp: code, new_password: password, confirm_password: confirmPassword });
      // A reset ends every session server-side. If the user started it from inside the app
      // (Account -> Change password) this device is still "signed in" locally, so sign out here
      // too -- otherwise the login screen would bounce them straight back home on a dead token.
      if (useAuthStore.getState().token) {
        suppressAuthRedirect();
        useAuthStore.getState().signOut();
      }
      router.replace(`/login?phone=${encodeURIComponent(phone)}&notice=password-updated`);
    } catch (err) {
      setError(friendlyErrorMessage(err));
      if (err instanceof ApiError && ["INVALID_OTP", "OTP_EXPIRED", "OTP_SUPERSEDED"].includes(err.code)) setCode("");
    } finally {
      setBusy(false);
    }
  }

  if (!phone) return null;

  return (
    <AuthShell
      title={setMode ? "Choose your password" : "Choose a new password"}
      subtitle={
        <>
          Enter the 6-digit code we sent on WhatsApp to{" "}
          <span className="font-[family-name:var(--font-mono-x)] font-semibold">{phone}</span>, then your new password.
        </>
      }
      footer={
        <Link href="/login" className="font-semibold underline">
          Back to log in
        </Link>
      }
    >
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
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

        <PasswordField
          label="New password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onBlur={() => setTouched((p) => ({ ...p, password: true }))}
          error={errors.password}
          showError={touched.password}
          autoComplete="new-password"
          placeholder="At least 8 characters"
        />
        <PasswordField
          label="Confirm new password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          onBlur={() => setTouched((p) => ({ ...p, confirmPassword: true }))}
          error={errors.confirmPassword}
          showError={touched.confirmPassword}
          autoComplete="new-password"
          placeholder="Type it again"
        />

        {error ? <FormMessage kind="error">{error}</FormMessage> : null}

        <SubmitButton ready={ready} busy={busy} busyLabel="Saving…">
          {setMode ? "Set password" : "Update password"}
        </SubmitButton>
      </form>
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
