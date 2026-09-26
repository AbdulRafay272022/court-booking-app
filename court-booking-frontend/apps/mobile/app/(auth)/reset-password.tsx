import { useState } from "react";
import { Text } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { isValidOtp, validateNewPassword } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { playerColors } from "@/lib/colors";
import { AuthScreen, FormMessage, OtpControls, PasswordField, SubmitButton, TextField, useOtpFlow } from "@/components/auth/kit";

/** Step 2 of password reset: the WhatsApp code plus the new password. Success ends every session
 * for the account (other devices are logged out) and returns to the login screen. */
export default function ResetPasswordScreen() {
  const { phone = "", mode } = useLocalSearchParams<{ phone?: string; mode?: string }>();
  const setMode = mode === "set";

  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [touched, setTouched] = useState({ password: false, confirmPassword: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const flow = useOtpFlow("password_reset", phone, async () => (await api.auth.requestPasswordReset({ phone })).expires_in);
  const errors = validateNewPassword({ password, confirmPassword });
  const ready = isValidOtp(code) && !flow.expired && Object.keys(errors).length === 0;

  async function handleSubmit() {
    setBusy(true);
    setError(null);
    try {
      await api.auth.verifyPasswordReset({ phone, otp: code, new_password: password, confirm_password: confirmPassword });
      router.replace({ pathname: "/(auth)/login", params: { phone, notice: "password-updated" } });
    } catch (err) {
      setError(friendlyErrorMessage(err));
      if (err instanceof ApiError && ["INVALID_OTP", "OTP_EXPIRED", "OTP_SUPERSEDED"].includes(err.code)) setCode("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthScreen
      title={setMode ? "Choose your password" : "Choose a new password"}
      subtitle={
        <>
          Enter the 6-digit code we sent on WhatsApp to{" "}
          <Text className="font-mono-semibold" style={{ color: playerColors.ink }}>
            {phone}
          </Text>
          , then your new password.
        </>
      }
      footer={
        <Text
          onPress={() => router.replace("/(auth)/login")}
          className="font-figtree-bold"
          style={{ fontSize: 14, color: playerColors.inkMuted, textDecorationLine: "underline" }}
        >
          Back to log in
        </Text>
      }
    >
      <TextField
        label="Verification code"
        mono
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        autoFocus
        maxLength={6}
        value={code}
        editable={!flow.expired}
        onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))}
        placeholder="••••••"
        style={{ textAlign: "center", fontSize: 22, letterSpacing: 8 }}
      />
      <OtpControls flow={flow} />

      <PasswordField
        label="New password"
        value={password}
        onChangeText={setPassword}
        onBlur={() => setTouched((p) => ({ ...p, password: true }))}
        error={errors.password}
        showError={touched.password}
        placeholder="At least 8 characters"
        autoComplete="new-password"
      />
      <PasswordField
        label="Confirm new password"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        onBlur={() => setTouched((p) => ({ ...p, confirmPassword: true }))}
        error={errors.confirmPassword}
        showError={touched.confirmPassword}
        placeholder="Type it again"
        autoComplete="new-password"
      />

      {error ? <FormMessage kind="error">{error}</FormMessage> : null}

      <SubmitButton
        ready={ready}
        busy={busy}
        label={setMode ? "Set password" : "Update password"}
        busyLabel="Saving…"
        onPress={handleSubmit}
      />
    </AuthScreen>
  );
}
