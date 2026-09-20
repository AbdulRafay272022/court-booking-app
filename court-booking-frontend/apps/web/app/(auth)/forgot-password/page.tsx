"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { isValidPkMobile, toE164 } from "@court-booking/types";
import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { rememberOtpExpiry } from "@/lib/pending-auth";
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

  const valid = isValidPkMobile(phone);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const e164 = toE164(phone);
      const res = await api.auth.requestPasswordReset({ phone: e164 });
      rememberOtpExpiry("password_reset", e164, res.expires_in);
      router.push(`/reset-password?phone=${encodeURIComponent(e164)}${setMode ? "&mode=set" : ""}`);
    } catch (err) {
      setError(friendlyErrorMessage(err));
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
          onChange={(e) => setPhone(e.target.value)}
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
        {error ? <FormMessage kind="error">{error}</FormMessage> : null}
        <SubmitButton ready={valid} busy={busy} busyLabel="Sending code…">
          Send code
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
