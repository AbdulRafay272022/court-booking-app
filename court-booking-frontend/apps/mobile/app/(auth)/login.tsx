import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { pkNationalDigits, toE164, validateLogin } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { getDeviceName, getOrCreateDeviceId, getPlatform } from "@/lib/device";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { usePendingAuth } from "@/lib/pending-auth";
import { retryAfterSeconds, useCountdown } from "@/lib/use-countdown";
import { playerColors } from "@/lib/colors";
import { AuthScreen, FormMessage, PasswordField, SubmitButton, TextField } from "@/components/auth/kit";

const NOTICES: Record<string, string> = {
  "password-updated": "Password updated. Log in with your new password.",
  "phone-verified": "Phone verified. Log in to continue.",
  "phone-changed": "Phone number updated. Log in with your new number.",
};

export default function LoginScreen() {
  const params = useLocalSearchParams<{ phone?: string; notice?: string }>();
  const [phone, setPhone] = useState(params.phone ? pkNationalDigits(params.phone) : "");
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState({ phone: false, password: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useCountdown(); // QA #5: LOGIN_RATE_LIMITED retry countdown

  const errors = validateLogin({ phone, password });
  const valid = Object.keys(errors).length === 0;
  const notice = NOTICES[params.notice ?? ""] ?? null;

  async function handleLogin() {
    if (lock.seconds > 0) return;
    setBusy(true);
    setError(null);
    const e164 = toE164(phone);
    try {
      const deviceId = await getOrCreateDeviceId();
      const res = await api.auth.login({
        phone: e164,
        password,
        device_id: deviceId,
        device_name: getDeviceName(),
        platform: getPlatform(),
      });
      // Stack.Protected in the root layout reacts to status/role and swaps the visible group.
      await useAuthStore.getState().signIn(res.token, res.user, res.expires_at);
    } catch (err) {
      if (err instanceof ApiError && err.code === "PHONE_REVERIFICATION_REQUIRED") {
        // Not a wrong password: the phone needs proving again (never verified, or >365 days).
        // Send a code, keep the password in memory for the retry, and go to the OTP screen.
        try {
          const otp = await api.auth.requestOtp({ phone: e164 });
          usePendingAuth.getState().rememberOtpExpiry("reverify", e164, otp.expires_in);
          usePendingAuth.getState().setPassword(password);
          router.push({ pathname: "/(auth)/verify", params: { purpose: "reverify", phone: e164 } });
        } catch (otpErr) {
          setError(friendlyErrorMessage(otpErr));
        }
      } else if (err instanceof ApiError && err.code === "PASSWORD_NOT_SET") {
        // Account from before passwords existed: set one through the reset flow.
        router.push({ pathname: "/(auth)/forgot-password", params: { phone: e164, mode: "set" } });
      } else if (err instanceof ApiError && err.code === "LOGIN_RATE_LIMITED") {
        lock.start(retryAfterSeconds(err.details) || 60); // QA #5
      } else {
        // QA #12: USER_NOT_FOUND falls here -> "No account found. Please sign up." (message map),
        // and we never enter an OTP flow (only PHONE_REVERIFICATION_REQUIRED above does).
        setError(friendlyErrorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthScreen
      title="Welcome back"
      subtitle="Log in with your mobile number and password."
      footer={
        <Text className="font-figtree-medium" style={{ fontSize: 14, color: playerColors.inkMuted }}>
          New to Maidan?{" "}
          <Text
            onPress={() => router.push("/(auth)/signup")}
            className="font-figtree-bold"
            style={{ color: playerColors.accent, textDecorationLine: "underline" }}
          >
            Create an account
          </Text>
        </Text>
      }
    >
      {notice ? <FormMessage kind="success">{notice}</FormMessage> : null}

      <TextField
        label="Mobile number"
        mono
        keyboardType="number-pad"
        value={phone}
        onChangeText={(v) => setPhone(pkNationalDigits(v).slice(0, 10))}
        onBlur={() => setTouched((p) => ({ ...p, phone: true }))}
        error={errors.phone}
        showError={touched.phone}
        placeholder="300 4408817"
        autoComplete="tel-national"
        prefix={
          <Text className="font-mono-semibold" style={{ fontSize: 15, color: playerColors.inkMuted }}>
            +92
          </Text>
        }
      />
      <View style={{ gap: 8 }}>
        <PasswordField
          label="Password"
          value={password}
          onChangeText={setPassword}
          onBlur={() => setTouched((p) => ({ ...p, password: true }))}
          error={errors.password}
          showError={touched.password}
          placeholder="Your password"
          autoComplete="current-password"
        />
        <Pressable
          onPress={() =>
            router.push({ pathname: "/(auth)/forgot-password", params: phone ? { phone: toE164(phone) } : {} })
          }
          style={{ alignSelf: "flex-end", minHeight: 36, justifyContent: "center" }}
        >
          <Text className="font-figtree-bold" style={{ fontSize: 13.5, color: playerColors.accent }}>
            Forgot password?
          </Text>
        </Pressable>
      </View>

      {lock.seconds > 0 ? (
        <FormMessage kind="error">{`Too many failed attempts. Try again in ${lock.seconds}s, or reset your password.`}</FormMessage>
      ) : error ? (
        <FormMessage kind="error">{error}</FormMessage>
      ) : null}

      <SubmitButton
        ready={valid && lock.seconds === 0}
        busy={busy}
        label={lock.seconds > 0 ? `Try again in ${lock.seconds}s` : "Log in"}
        busyLabel="Logging in…"
        onPress={handleLogin}
      />
    </AuthScreen>
  );
}
