import { useState } from "react";
import { Text } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { isValidOtp } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { getDeviceName, getOrCreateDeviceId, getPlatform } from "@/lib/device";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { usePendingAuth } from "@/lib/pending-auth";
import { AuthScreen, FormMessage, OtpControls, SubmitButton, TextField, toneColors, useOtpFlow } from "@/components/auth/kit";

/** One OTP screen, two purposes -- and the copy says which:
 *  - purpose=signup:   "Verify your new account" (finishes signup and signs the user in)
 *  - purpose=reverify: "Verify your phone" (365 days passed, or signup was never finished; proves
 *                      the phone, then retries the password login with the password just typed) */
export default function VerifyScreen() {
  const { phone = "", purpose: rawPurpose, role: rawRole } = useLocalSearchParams<{ phone?: string; purpose?: string; role?: string }>();
  const purpose = rawPurpose === "reverify" ? "reverify" : "signup";
  const tone = purpose === "signup" && rawRole === "owner" ? "owner" : "player";
  const c = toneColors(tone);

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const flow = useOtpFlow(purpose, phone, async () => (await api.auth.requestOtp({ phone })).expires_in);
  const ready = isValidOtp(code) && !flow.expired;

  async function handleVerify() {
    setBusy(true);
    setError(null);
    try {
      const device = {
        device_id: await getOrCreateDeviceId(),
        device_name: getDeviceName(),
        platform: getPlatform(),
      };
      if (purpose === "signup") {
        const res = await api.auth.verifySignupOtp({ phone, otp: code, ...device });
        // The root layout swaps to the role's group; a new owner lands on the venue-setup gate.
        await useAuthStore.getState().signIn(res.token, res.user, res.expires_at);
        return;
      }

      await api.auth.reverifyPhone({ phone, otp: code });
      const password = usePendingAuth.getState().password;
      usePendingAuth.getState().setPassword(null);
      if (!password) {
        router.replace({ pathname: "/(auth)/login", params: { phone, notice: "phone-verified" } });
        return;
      }
      const res = await api.auth.login({ phone, password, ...device });
      await useAuthStore.getState().signIn(res.token, res.user, res.expires_at);
    } catch (err) {
      setError(friendlyErrorMessage(err));
      if (err instanceof ApiError && (err.code === "INVALID_OTP" || err.code === "OTP_EXPIRED")) setCode("");
    } finally {
      setBusy(false);
    }
  }

  const link = tone === "owner" ? "font-plex-bold" : "font-figtree-bold";
  return (
    <AuthScreen
      tone={tone}
      title={purpose === "signup" ? "Verify your new account" : "Verify your phone"}
      subtitle={
        <>
          {purpose === "signup"
            ? "Almost there. We sent a 6-digit code on WhatsApp to "
            : "For your security we need to confirm this number again. We sent a 6-digit code on WhatsApp to "}
          <Text className="font-mono-semibold" style={{ color: c.ink }}>
            {phone}
          </Text>
          .
        </>
      }
      footer={
        <Text
          onPress={() => (purpose === "signup" ? router.replace("/(auth)/signup") : router.replace("/(auth)/login"))}
          className={link}
          style={{ fontSize: 14, color: c.inkMuted, textDecorationLine: "underline" }}
        >
          {purpose === "signup" ? "Wrong number? Start again" : "Back to log in"}
        </Text>
      }
    >
      <TextField
        label="Verification code"
        tone={tone}
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

      <OtpControls flow={flow} tone={tone} />

      {error ? <FormMessage kind="error" tone={tone}>{error}</FormMessage> : null}

      <SubmitButton
        tone={tone}
        ready={ready}
        busy={busy}
        label={purpose === "signup" ? "Verify and continue" : "Verify"}
        busyLabel="Verifying…"
        onPress={handleVerify}
      />
    </AuthScreen>
  );
}
