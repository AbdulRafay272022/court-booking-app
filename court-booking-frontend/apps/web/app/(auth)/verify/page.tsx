"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { isValidOtp } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { webDeviceInfo } from "@/lib/device";
import { friendlyErrorMessage } from "@/lib/error-messages";
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
  const next = safeNext(search.get("next"));
  const signedIn = useRedirectIfSignedIn();

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const flow = useOtpFlow(purpose, phone, async () => (await api.auth.requestOtp({ phone })).expires_in);
  const ready = isValidOtp(code) && !flow.expired;

  useEffect(() => {
    if (!phone) router.replace("/login");
  }, [phone, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
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
      setError(friendlyErrorMessage(err));
      if (err instanceof ApiError && (err.code === "INVALID_OTP" || err.code === "OTP_EXPIRED")) setCode("");
    } finally {
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

        {error ? <FormMessage kind="error">{error}</FormMessage> : null}

        <SubmitButton ready={ready} busy={busy} busyLabel="Verifying…">
          {purpose === "signup" ? "Verify and continue" : "Verify"}
        </SubmitButton>
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
