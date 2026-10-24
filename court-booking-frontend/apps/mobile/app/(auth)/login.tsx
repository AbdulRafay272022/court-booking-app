import { useState } from "react";
import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { MessageCircle } from "lucide-react-native";
import { pkNationalDigits, toE164, validateLogin } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";
import { space } from "@court-booking/ui-tokens";

import { Banner, Button, Input, useCopy } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { getDeviceName, getOrCreateDeviceId, getPlatform } from "@/lib/device";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { usePendingAuth } from "@/lib/pending-auth";
import { openSupportWhatsApp } from "@/lib/support";
import { retryAfterSeconds, useCountdown } from "@/lib/use-countdown";
import { AuthShell, TextLink } from "./_fl";

/** PAuth board frame 1 (Login). Same auth API and error handling as before; only the look changed. */
export default function LoginScreen() {
  const copy = useCopy();
  const params = useLocalSearchParams<{ phone?: string; notice?: string }>();
  const [phone, setPhone] = useState(params.phone ? pkNationalDigits(params.phone) : "");
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState({ phone: false, password: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useCountdown(); // QA #5: LOGIN_RATE_LIMITED retry countdown

  const notices: Record<string, string> = {
    "password-updated": copy("Password badal gaya. Naye password se login karein.", "Password updated. Log in with your new password."),
    "phone-verified": copy("Number verify ho gaya. Login karein.", "Phone verified. Log in to continue."),
    "phone-changed": copy("Number badal gaya. Naye number se login karein.", "Phone number updated. Log in with your new number."),
  };
  const errors = validateLogin({ phone, password });
  const valid = Object.keys(errors).length === 0;
  const notice = notices[params.notice ?? ""] ?? null;

  async function handleLogin() {
    if (lock.seconds > 0 || !valid) return;
    setBusy(true);
    setError(null);
    const e164 = toE164(phone);
    try {
      const deviceId = await getOrCreateDeviceId();
      const res = await api.auth.login({ phone: e164, password, device_id: deviceId, device_name: getDeviceName(), platform: getPlatform() });
      // Stack.Protected in the root layout reacts to status/role and swaps the visible group.
      await useAuthStore.getState().signIn(res.token, res.user, res.expires_at);
    } catch (err) {
      if (err instanceof ApiError && err.code === "PHONE_REVERIFICATION_REQUIRED") {
        // Not a wrong password: the phone needs proving again. Send a code, keep the password in memory for the retry.
        try {
          const otp = await api.auth.requestOtp({ phone: e164 });
          usePendingAuth.getState().rememberOtpExpiry("reverify", e164, otp.expires_in);
          usePendingAuth.getState().setPassword(password);
          router.push({ pathname: "/(auth)/verify", params: { purpose: "reverify", phone: e164 } });
        } catch (otpErr) {
          setError(friendlyErrorMessage(otpErr));
        }
      } else if (err instanceof ApiError && err.code === "PASSWORD_NOT_SET") {
        router.push({ pathname: "/(auth)/forgot-password", params: { phone: e164, mode: "set" } });
      } else if (err instanceof ApiError && err.code === "LOGIN_RATE_LIMITED") {
        lock.start(retryAfterSeconds(err.details) || 60);
      } else {
        // USER_NOT_FOUND lands here ("No account found. Please sign up."); never enters an OTP flow.
        setError(friendlyErrorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      hero
      testID="login-screen"
      title={copy("Wapas aaye!", "Welcome back!")}
      subtitle={copy("Mobile number aur password se login karein.", "Log in with your mobile number and password.")}
      footer={
        <>
          <TextLink before={copy("Naya account?", "New here?")} label={copy("Sign up karein", "Create an account")} onPress={() => router.push("/(auth)/signup")} testID="login-signup" />
          <Banner
            tone="info"
            icon={MessageCircle}
            body={copy("Login mein masla? WhatsApp par madad lein.", "Trouble logging in? Get help on WhatsApp.")}
            action={<Button label={copy("WhatsApp madad", "WhatsApp help")} variant="soft" size="sm" onPress={() => openSupportWhatsApp("Login help")} />}
          />
        </>
      }
    >
      {notice ? <Banner tone="open" body={notice} /> : null}
      <Input
        label={copy("Mobile number", "Mobile number")}
        prefix="+92"
        keyboardType="number-pad"
        value={phone}
        onChangeText={(v) => setPhone(pkNationalDigits(v).slice(0, 10))}
        onBlur={() => setTouched((p) => ({ ...p, phone: true }))}
        error={touched.phone ? errors.phone : null}
        placeholder="300 1234567"
        autoComplete="tel-national"
        testID="login-phone"
      />
      <View style={{ gap: space[1] }}>
        <Input
          label={copy("Password", "Password")}
          secureToggle
          value={password}
          onChangeText={setPassword}
          onBlur={() => setTouched((p) => ({ ...p, password: true }))}
          error={touched.password ? errors.password : null}
          placeholder={copy("Aap ka password", "Your password")}
          autoComplete="current-password"
          onSubmitEditing={handleLogin}
          testID="login-password"
        />
        <View style={{ alignSelf: "flex-end" }}>
          <TextLink label={copy("Password bhool gaye?", "Forgot password?")} onPress={() => router.push({ pathname: "/(auth)/forgot-password", params: phone ? { phone: toE164(phone) } : {} })} />
        </View>
      </View>
      {lock.seconds > 0 ? (
        <Banner tone="danger" body={copy(`Bohat zyada koshishein. ${lock.seconds}s baad dobara, ya password reset karein.`, `Too many failed attempts. Try again in ${lock.seconds}s, or reset your password.`)} />
      ) : error ? (
        <Banner tone="danger" body={error} testID="login-error" />
      ) : null}
      <Button
        label={lock.seconds > 0 ? copy(`${lock.seconds}s baad`, `Try again in ${lock.seconds}s`) : copy("Login karein", "Log in")}
        block
        loading={busy}
        disabled={!valid || lock.seconds > 0}
        onPress={handleLogin}
        testID="login-submit"
      />
    </AuthShell>
  );
}
