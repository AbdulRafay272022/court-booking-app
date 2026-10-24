import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { isValidPkMobile, pkNationalDigits, toE164 } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";

import { Banner, Button, Input, useCopy } from "@/components/ui";
import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { usePendingAuth } from "@/lib/pending-auth";
import { retryAfterSeconds, useCountdown } from "@/lib/use-countdown";
import { AuthShell, TextLink } from "./_fl";

/** Step 1 of password reset, also how an old account SETS its first password (`mode=set`). An unknown number is rejected
 * (USER_NOT_FOUND) and we never advance; we only navigate on a successful send. */
export default function ForgotPasswordScreen() {
  const copy = useCopy();
  const params = useLocalSearchParams<{ phone?: string; mode?: string }>();
  const setMode = params.mode === "set";
  const [phone, setPhone] = useState(params.phone ? pkNationalDigits(params.phone) : "");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useCountdown();
  const valid = isValidPkMobile(phone);

  async function handleSend() {
    if (lock.seconds > 0 || !valid) return;
    setBusy(true);
    setError(null);
    try {
      const e164 = toE164(phone);
      const res = await api.auth.requestPasswordReset({ phone: e164 });
      usePendingAuth.getState().rememberOtpExpiry("password_reset", e164, res.expires_in);
      router.push({ pathname: "/(auth)/reset-password", params: { phone: e164, ...(setMode ? { mode: "set" } : {}) } });
    } catch (err) {
      if (err instanceof ApiError && (err.code === "OTP_RATE_LIMITED" || err.code === "OTP_IP_RATE_LIMITED")) lock.start(retryAfterSeconds(err.details) || 60);
      else setError(friendlyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title={setMode ? copy("Password banayein", "Set your password") : copy("Password reset karein", "Reset your password")}
      subtitle={
        setMode
          ? copy("Khelo account ab password se chalte hain. WhatsApp par number confirm karein, phir password chunein.", "Khelo accounts now use a password. Confirm your number on WhatsApp, then choose one.")
          : copy("Mobile number likhein, hum WhatsApp par code bhejenge.", "Enter your mobile number and we'll send a code on WhatsApp.")
      }
      onBack={() => router.replace("/(auth)/login")}
      footer={<TextLink label={copy("Login par wapas", "Back to log in")} onPress={() => router.replace("/(auth)/login")} />}
    >
      <Input
        label={copy("Mobile number", "Mobile number")}
        prefix="+92"
        keyboardType="number-pad"
        autoFocus
        value={phone}
        onChangeText={(v) => setPhone(pkNationalDigits(v).slice(0, 10))}
        onBlur={() => setTouched(true)}
        error={touched && !valid ? copy("Sahi mobile number likhein, jaise 300 1234567", "Enter a valid mobile number, e.g. 300 1234567") : null}
        placeholder="300 1234567"
      />
      {lock.seconds > 0 ? (
        <Banner tone="danger" body={copy(`Bohat zyada codes maange. ${lock.seconds}s baad dobara.`, `Too many code requests. Try again in ${lock.seconds}s.`)} />
      ) : error ? (
        <Banner tone="danger" body={error} />
      ) : null}
      <Button label={lock.seconds > 0 ? copy(`${lock.seconds}s baad`, `Try again in ${lock.seconds}s`) : copy("Code bhejein", "Send code")} block loading={busy} disabled={!valid || lock.seconds > 0} onPress={handleSend} />
    </AuthShell>
  );
}
