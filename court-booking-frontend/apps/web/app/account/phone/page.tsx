"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isValidOtp, isValidPkMobile, toE164, validatePhoneChange } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { rememberOtpExpiry } from "@/lib/pending-auth";
import { suppressAuthRedirect } from "@/lib/use-require-auth";
import { FormMessage, PasswordField, TextField } from "@/components/auth/fields";
import { OtpControls, useOtpFlow } from "@/components/auth/otp-controls";
import { SubmitButton } from "@/components/auth/submit-button";
import { TONES } from "@/components/auth/tone";

/** Phone-number change (both roles). Two steps:
 *  1. new number + CURRENT password (re-authentication for a sensitive change) -> a code goes to the NEW number;
 *  2. the code. Only when it succeeds does the number change -- and then EVERY session ends (this one
 *     too), so we sign out locally and send the user to log in with the new number, with a notice saying
 *     so. Abandoning at either step changes nothing. */
export default function ChangePhonePage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user)!;
  const tone = user.role === "owner" || user.role === "admin" ? "owner" : "player";
  const t = TONES[tone];

  const [step, setStep] = useState<1 | 2>(1);
  const [newPhone, setNewPhone] = useState("");
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState({ newPhone: false, password: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phoneTaken, setPhoneTaken] = useState(false);

  const e164 = isValidPkMobile(newPhone) ? toE164(newPhone) : "";
  const errors = validatePhoneChange({ newPhone, password });
  const step1Ready = Object.keys(errors).length === 0 && e164 !== user.phone;

  useEffect(() => setPhoneTaken(false), [newPhone]);

  async function handleRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!step1Ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.auth.requestPhoneChange({ new_phone: e164, password });
      rememberOtpExpiry("phone_change", e164, res.expires_in);
      setStep(2);
    } catch (err) {
      if (err instanceof ApiError && err.code === "PHONE_ALREADY_REGISTERED") setPhoneTaken(true);
      else if (err instanceof ApiError && err.code === "INVALID_CREDENTIALS") setError("Incorrect password.");
      else setError(friendlyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-1">
        <Link href="/account" className="text-[13.5px] font-semibold" style={{ color: t.muted }}>
          ← Back to account
        </Link>
        <h1 className="text-[26px] font-extrabold tracking-[-0.03em]">Change phone number</h1>
        <p className="text-[14.5px] font-medium leading-relaxed" style={{ color: t.muted }}>
          Your current number is{" "}
          <span className="font-[family-name:var(--font-mono-x)] font-semibold" style={{ color: t.ink }}>
            {user.phone}
          </span>
          . After the change you&apos;ll be logged out everywhere and sign in again with the new number and your existing password.
        </p>
      </div>

      {step === 1 ? (
        <form onSubmit={handleRequest} noValidate className="flex flex-col gap-5 rounded-3xl p-6" style={{ background: t.surface, border: `1px solid ${t.border}` }}>
          <TextField
            label="New mobile number"
            tone={tone}
            mono
            inputMode="numeric"
            autoFocus
            value={newPhone}
            onChange={(e) => setNewPhone(e.target.value)}
            onBlur={() => setTouched((p) => ({ ...p, newPhone: true }))}
            error={phoneTaken ? "An account with this number already exists." : e164 === user.phone && newPhone ? "That is already your number." : errors.newPhone}
            showError={phoneTaken || touched.newPhone}
            placeholder="300 4408817"
            autoComplete="tel-national"
            prefix={
              <span className="font-[family-name:var(--font-mono-x)] text-[15px] font-semibold" style={{ color: t.muted }}>
                +92
              </span>
            }
          />
          <PasswordField
            label="Current password"
            tone={tone}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={() => setTouched((p) => ({ ...p, password: true }))}
            error={errors.password}
            showError={touched.password}
            autoComplete="current-password"
            placeholder="Confirms it's really you"
          />
          {error ? <FormMessage kind="error" tone={tone}>{error}</FormMessage> : null}
          <SubmitButton tone={tone} ready={step1Ready} busy={busy} busyLabel="Sending code…">
            Send code to new number
          </SubmitButton>
        </form>
      ) : (
        <CodeStep
          e164={e164}
          password={password}
          tone={tone}
          onBack={() => {
            setStep(1);
            setError(null);
          }}
        />
      )}
    </>
  );
}

function CodeStep({ e164, password, tone, onBack }: { e164: string; password: string; tone: "player" | "owner"; onBack: () => void }) {
  const router = useRouter();
  const t = TONES[tone];
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const flow = useOtpFlow("phone_change", e164, async () => (await api.auth.requestPhoneChange({ new_phone: e164, password })).expires_in);
  const ready = isValidOtp(code) && !flow.expired;

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.auth.verifyPhoneChange({ new_phone: e164, otp: code });
      // The backend just ended every session, this one included. Sign out locally and go to login
      // (prefilled with the NEW number, with a notice) -- never leave them on a page whose token is dead.
      suppressAuthRedirect();
      useAuthStore.getState().signOut();
      router.replace(`/login?phone=${encodeURIComponent(e164)}&notice=phone-changed`);
    } catch (err) {
      setError(friendlyErrorMessage(err));
      if (err instanceof ApiError && (err.code === "INVALID_OTP" || err.code === "OTP_EXPIRED")) setCode("");
      if (err instanceof ApiError && err.code === "PHONE_ALREADY_REGISTERED") onBack();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleVerify} noValidate className="flex flex-col gap-5 rounded-3xl p-6" style={{ background: t.surface, border: `1px solid ${t.border}` }}>
      <p className="text-[14.5px] font-medium leading-relaxed" style={{ color: t.muted }}>
        We sent a 6-digit code on WhatsApp to{" "}
        <span className="font-[family-name:var(--font-mono-x)] font-semibold" style={{ color: t.ink }}>
          {e164}
        </span>
        .
      </p>
      <TextField
        label="Verification code"
        tone={tone}
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
      <OtpControls flow={flow} tone={tone} />
      {error ? <FormMessage kind="error" tone={tone}>{error}</FormMessage> : null}
      <SubmitButton tone={tone} ready={ready} busy={busy} busyLabel="Verifying…">
        Verify and change number
      </SubmitButton>
      <button type="button" onClick={onBack} className="text-[13.5px] font-semibold underline" style={{ color: t.muted }}>
        Use a different number
      </button>
    </form>
  );
}
