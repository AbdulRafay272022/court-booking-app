import { useState } from "react";
import { Text } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { isValidPkMobile, pkNationalDigits, toE164 } from "@court-booking/types";

import { ApiError } from "@court-booking/api-client";
import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { usePendingAuth } from "@/lib/pending-auth";
import { retryAfterSeconds, useCountdown } from "@/lib/use-countdown";
import { playerColors } from "@/lib/colors";
import { AuthScreen, FormMessage, SubmitButton, TextField } from "@/components/auth/kit";

/** Step 1 of password reset -- also how a pre-Section-26 account SETS its first password
 * (`mode=set`). NEW BUG 1: an unknown number is rejected (USER_NOT_FOUND) and we don't advance
 * to the code screen; we only navigate on a successful send. */
export default function ForgotPasswordScreen() {
  const params = useLocalSearchParams<{ phone?: string; mode?: string }>();
  const setMode = params.mode === "set";
  const [phone, setPhone] = useState(params.phone ? pkNationalDigits(params.phone) : "");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useCountdown(); // QA #5
  const valid = isValidPkMobile(phone);

  async function handleSend() {
    if (lock.seconds > 0) return;
    setBusy(true);
    setError(null);
    try {
      const e164 = toE164(phone);
      const res = await api.auth.requestPasswordReset({ phone: e164 });
      usePendingAuth.getState().rememberOtpExpiry("password_reset", e164, res.expires_in);
      router.push({ pathname: "/(auth)/reset-password", params: { phone: e164, ...(setMode ? { mode: "set" } : {}) } });
    } catch (err) {
      if (err instanceof ApiError && (err.code === "OTP_RATE_LIMITED" || err.code === "OTP_IP_RATE_LIMITED")) {
        lock.start(retryAfterSeconds(err.details) || 60); // QA #5
      } else {
        // NEW BUG 1: USER_NOT_FOUND -> "No account found. Please sign up." (message map); no nav.
        setError(friendlyErrorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthScreen
      title={setMode ? "Set your password" : "Reset your password"}
      subtitle={
        setMode
          ? "Maidan accounts now use a password. Confirm your number on WhatsApp, then choose one."
          : "Enter your mobile number and we'll send a code on WhatsApp."
      }
      footer={
        <Text
          onPress={() => router.replace("/(auth)/login")}
          className="font-figtree-bold"
          style={{ fontSize: 14, color: playerColors.accent, textDecorationLine: "underline" }}
        >
          Back to log in
        </Text>
      }
    >
      <TextField
        label="Mobile number"
        mono
        keyboardType="number-pad"
        autoFocus
        value={phone}
        onChangeText={(v) => setPhone(pkNationalDigits(v).slice(0, 10))}
        onBlur={() => setTouched(true)}
        error={valid ? null : "Enter a valid mobile number, e.g. 300 1234567"}
        showError={touched}
        placeholder="300 4408817"
        prefix={
          <Text className="font-mono-semibold" style={{ fontSize: 15, color: playerColors.inkMuted }}>
            +92
          </Text>
        }
      />
      {lock.seconds > 0 ? (
        <FormMessage kind="error">{`Too many code requests. Please try again in ${lock.seconds}s.`}</FormMessage>
      ) : error ? (
        <FormMessage kind="error">{error}</FormMessage>
      ) : null}
      <SubmitButton
        ready={valid && lock.seconds === 0}
        busy={busy}
        label={lock.seconds > 0 ? `Try again in ${lock.seconds}s` : "Send code"}
        busyLabel="Sending code…"
        onPress={handleSend}
      />
    </AuthScreen>
  );
}
