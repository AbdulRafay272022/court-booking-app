import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { isValidOtp, validateNewPassword } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";

import { Banner, Button, Input, OtpInput, Text, useCopy } from "@/components/ui";
import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useOtpFlow } from "@/components/auth/kit";
import { AuthShell, OtpStatus, TextLink } from "./_fl";

/** Step 2 of password reset: the WhatsApp code plus the new password. Success ends every session for the account and
 * returns to the login screen. */
export default function ResetPasswordScreen() {
  const copy = useCopy();
  const { phone = "", mode } = useLocalSearchParams<{ phone?: string; mode?: string }>();
  const setMode = mode === "set";
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [touched, setTouched] = useState({ password: false, confirmPassword: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const flow = useOtpFlow("password_reset", phone, async () => (await api.auth.requestPasswordReset({ phone })).expires_in, () => setError(null));
  const errors = validateNewPassword({ password, confirmPassword });
  const ready = isValidOtp(code) && !flow.expired && Object.keys(errors).length === 0;

  async function handleSubmit() {
    if (!ready) return;
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
    <AuthShell
      title={setMode ? copy("Password chunein", "Choose your password") : copy("Naya password", "Choose a new password")}
      subtitle={copy(`${phone} par WhatsApp se aaya 6 hindson ka code likhein, phir naya password.`, `Enter the 6-digit code we sent on WhatsApp to ${phone}, then your new password.`)}
      onBack={() => router.replace("/(auth)/login")}
      footer={<TextLink label={copy("Login par wapas", "Back to log in")} onPress={() => router.replace("/(auth)/login")} />}
    >
      <Text variant="label">{copy("WhatsApp code", "WhatsApp code")}</Text>
      <OtpInput value={code} onChange={setCode} error={!!error} disabled={flow.expired} autoFocus />
      <OtpStatus flow={flow} />
      <Input
        label={copy("Naya password", "New password")}
        secureToggle
        value={password}
        onChangeText={setPassword}
        onBlur={() => setTouched((p) => ({ ...p, password: true }))}
        error={touched.password ? errors.password : null}
        placeholder={copy("Kam se kam 8 huroof", "At least 8 characters")}
        autoComplete="new-password"
      />
      <Input
        label={copy("Naya password dobara", "Confirm new password")}
        secureToggle
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        onBlur={() => setTouched((p) => ({ ...p, confirmPassword: true }))}
        error={touched.confirmPassword ? errors.confirmPassword : null}
        placeholder={copy("Wahi password", "Type it again")}
        autoComplete="new-password"
      />
      {error ? <Banner tone="danger" body={error} /> : null}
      <Button label={setMode ? copy("Password set karein", "Set password") : copy("Password badlein", "Update password")} block loading={busy} disabled={!ready} onPress={handleSubmit} />
    </AuthShell>
  );
}
