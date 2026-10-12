"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isValidOtp, isValidPkMobile, toE164, validatePhoneChange } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { rememberOtpExpiry } from "@/lib/pending-auth";
import { suppressAuthRedirect } from "@/lib/use-require-auth";
import { useT } from "@/components/i18n/lang-provider";
import { Container } from "@/components/site/primitives";
import { CountryPrefix, FormNotice, PasswordField, SmartButton, TextField } from "@/components/auth-v2/fields";
import { CodeField, OtpStatus } from "@/components/auth-v2/otp-controls";
import { useOtpFlow } from "@/components/auth/otp-controls";
import { Card } from "@/components/account-hub/parts";

/** Phone-number change (both roles). Two steps:
 *  1. new number + CURRENT password (re-authentication for a sensitive change) -> a code goes to the NEW number;
 *  2. the code. Only when it succeeds does the number change -- and then EVERY session ends (this one
 *     too), so we sign out locally and send the user to log in with the new number, with a notice saying
 *     so. Abandoning at either step changes nothing. */
export default function ChangePhonePage() {
  const t = useT();
  const user = useAuthStore((s) => s.user)!;
  const theme = user.role === "owner" || user.role === "admin" ? "owner" : "player";

  const [step, setStep] = useState<1 | 2>(1);
  const [newPhone, setNewPhone] = useState("");
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState({ newPhone: false, password: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phoneTaken, setPhoneTaken] = useState(false);

  const e164 = isValidPkMobile(newPhone) ? toE164(newPhone) : "";
  const rawErrors = validatePhoneChange({ newPhone, password });
  const errors = {
    newPhone: rawErrors.newPhone ? t("account.phone.err.newPhone") : undefined,
    password: rawErrors.password ? t("account.phone.err.password") : undefined,
  };
  const step1Ready = Object.keys(rawErrors).length === 0 && e164 !== user.phone;

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
      else if (err instanceof ApiError && err.code === "INVALID_CREDENTIALS") setError(t("account.phone.wrongPassword"));
      else setError(friendlyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Container className="flex max-w-[640px] flex-col gap-6 py-8 lg:py-10">
      <div className="flex flex-col gap-2">
        <Link href="/account?tab=settings" className="inline-flex min-h-11 items-center self-start text-[15px] font-bold text-khelo-muted hover:underline">
          {"←"} {t("account.phone.back")}
        </Link>
        <h1 className="font-khelo-display text-[34px] font-extrabold leading-[1.05] tracking-[-1.5px]">{t("account.phone.title")}</h1>
        <p className="text-[16px] leading-relaxed text-khelo-muted">
          {t("account.phone.intro1")} <span className="font-mono-plex font-semibold text-khelo-ink">{user.phone}</span>
          {t("account.phone.intro2")}
        </p>
      </div>

      {step === 1 ? (
        <Card>
          <form onSubmit={handleRequest} noValidate className="flex flex-col gap-5">
            <TextField
              label={t("account.phone.newPhone")}
              inputMode="numeric"
              autoFocus
              value={newPhone}
              onChange={(e) => {
                setNewPhone(e.target.value);
                setPhoneTaken(false);
              }}
              onBlur={() => setTouched((p) => ({ ...p, newPhone: true }))}
              error={phoneTaken ? t("account.phone.err.taken") : e164 === user.phone && newPhone ? t("account.phone.err.same") : errors.newPhone}
              showError={phoneTaken || touched.newPhone}
              placeholder="300 4408817"
              autoComplete="tel-national"
              prefix={<CountryPrefix />}
            />
            <PasswordField
              label={t("account.phone.currentPassword")}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={() => setTouched((p) => ({ ...p, password: true }))}
              error={errors.password}
              showError={touched.password}
              autoComplete="current-password"
              placeholder={t("account.phone.passwordPlaceholder")}
            />
            <div aria-live="polite">{error ? <FormNotice kind="error">{error}</FormNotice> : null}</div>
            <SmartButton ready={step1Ready} busy={busy} busyLabel={t("account.phone.sending")} theme={theme}>
              {t("account.phone.send")}
            </SmartButton>
          </form>
        </Card>
      ) : (
        <CodeStep
          e164={e164}
          password={password}
          theme={theme}
          onBack={() => {
            setStep(1);
            setError(null);
          }}
        />
      )}
    </Container>
  );
}

function CodeStep({ e164, password, theme, onBack }: { e164: string; password: string; theme: "player" | "owner"; onBack: () => void }) {
  const t = useT();
  const router = useRouter();
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
    <Card>
      <form onSubmit={handleVerify} noValidate className="flex flex-col gap-5">
        <p className="text-[16px] leading-relaxed text-khelo-muted">
          {t("account.phone.codeSent")} <span className="font-mono-plex font-semibold text-khelo-ink">{e164}</span>.
        </p>
        <CodeField
          label={t("account.phone.code")}
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
        <div aria-live="polite">{error ? <FormNotice kind="error">{error}</FormNotice> : null}</div>
        <SmartButton ready={ready} busy={busy} busyLabel={t("account.phone.verifying")} theme={theme}>
          {t("account.phone.verify")}
        </SmartButton>
        <button type="button" onClick={onBack} className="inline-flex min-h-11 cursor-pointer items-center justify-center text-[15px] font-bold text-khelo-muted underline">
          {t("account.phone.different")}
        </button>
      </form>
    </Card>
  );
}
