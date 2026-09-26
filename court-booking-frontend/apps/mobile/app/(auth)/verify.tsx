import { useRef, useState } from "react";
import { Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { isValidOtp } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { getDeviceName, getOrCreateDeviceId, getPlatform } from "@/lib/device";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { usePendingAuth } from "@/lib/pending-auth";
import { retryAfterSeconds, useCountdown } from "@/lib/use-countdown";
import { AuthScreen, FormMessage, OtpControls, SubmitButton, TextField, toneColors, useOtpFlow } from "@/components/auth/kit";

/** One OTP screen, two purposes -- and the copy says which:
 *  - purpose=signup:   "Verify your new account" (finishes signup and signs the user in)
 *  - purpose=reverify: "Verify your phone" (365 days passed, or signup was never finished; proves
 *                      the phone, then retries the password login with the password just typed) */
export default function VerifyScreen() {
  const { phone = "", purpose: rawPurpose, role: rawRole, pending } = useLocalSearchParams<{ phone?: string; purpose?: string; role?: string; pending?: string }>();
  const purpose = rawPurpose === "reverify" ? "reverify" : "signup";
  const isPending = pending === "1"; // arrived because a signup was already in progress (item E)
  const tone = purpose === "signup" && rawRole === "owner" ? "owner" : "player";
  const c = toneColors(tone);

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alreadyVerified, setAlreadyVerified] = useState(false); // QA #2
  const submitting = useRef(false); // QA #8: block a rapid double-tap
  const lock = useCountdown(); // QA #5

  const flow = useOtpFlow(
    purpose,
    phone,
    async () => (await api.auth.requestOtp({ phone })).expires_in,
    () => {
      setError(null); // QA #5: clear a stale banner after a successful resend
      lock.start(0);
    },
  );
  const ready = isValidOtp(code) && !flow.expired && !alreadyVerified && lock.seconds === 0;

  async function handleVerify() {
    if (submitting.current) return; // QA #8
    submitting.current = true;
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
      if (err instanceof ApiError && err.code === "ALREADY_VERIFIED") {
        setAlreadyVerified(true); // QA #2: offer Log in, not a dead-end expired error
        setError("This number is already verified — please log in.");
      } else if (
        err instanceof ApiError &&
        (err.code === "OTP_RATE_LIMITED" || err.code === "LOGIN_RATE_LIMITED" || err.code === "OTP_IP_RATE_LIMITED")
      ) {
        lock.start(retryAfterSeconds(err.details) || 60); // QA #5
      } else {
        setError(friendlyErrorMessage(err));
        if (err instanceof ApiError && ["INVALID_OTP", "OTP_EXPIRED", "OTP_SUPERSEDED"].includes(err.code)) setCode("");
      }
    } finally {
      submitting.current = false;
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
      {isPending ? (
        <FormMessage kind="info" tone={tone}>
          You already have a signup in progress for this number — check WhatsApp for your code, or tap Resend below. (Any details you just re-entered weren&apos;t saved.)
        </FormMessage>
      ) : null}
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

      {/* QA #8: reserve the banner's space so it never shifts the button below it. */}
      <View style={{ minHeight: 44, justifyContent: "center" }}>
        {lock.seconds > 0 ? (
          <FormMessage kind="error" tone={tone}>{`Too many attempts. Please try again in ${lock.seconds}s.`}</FormMessage>
        ) : error ? (
          <FormMessage kind="error" tone={tone}>{error}</FormMessage>
        ) : null}
      </View>

      {alreadyVerified ? (
        <SubmitButton
          tone={tone}
          ready
          busy={false}
          label="Log in"
          busyLabel=""
          onPress={() => router.replace({ pathname: "/(auth)/login", params: { phone, notice: "phone-verified" } })}
        />
      ) : (
        <SubmitButton
          tone={tone}
          ready={ready}
          busy={busy}
          label={lock.seconds > 0 ? `Try again in ${lock.seconds}s` : purpose === "signup" ? "Verify and continue" : "Verify"}
          busyLabel="Verifying…"
          onPress={handleVerify}
        />
      )}
    </AuthScreen>
  );
}
