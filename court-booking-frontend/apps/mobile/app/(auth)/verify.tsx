import { useRef, useState } from "react";
import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { MessageCircle } from "lucide-react-native";
import { isValidOtp } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";
import { palette, radius, space } from "@court-booking/ui-tokens";

import { Banner, Button, OtpInput, Text, useCopy } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { getDeviceName, getOrCreateDeviceId, getPlatform } from "@/lib/device";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { usePendingAuth } from "@/lib/pending-auth";
import { retryAfterSeconds, useCountdown } from "@/lib/use-countdown";
import { useOtpFlow } from "@/components/auth/kit";
import { AuthShell, OtpStatus, TextLink } from "./_fl";

/** PAuth board frame 3 (WhatsApp code). One screen, two purposes:
 *  - purpose=signup:   finishes signup and signs the user in
 *  - purpose=reverify: proves the phone again, then retries the password login with the password just typed */
export default function VerifyScreen() {
  const copy = useCopy();
  const { phone = "", purpose: rawPurpose, pending } = useLocalSearchParams<{ phone?: string; purpose?: string; role?: string; pending?: string }>();
  const purpose = rawPurpose === "reverify" ? "reverify" : "signup";
  const isPending = pending === "1"; // arrived because a signup was already in progress

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alreadyVerified, setAlreadyVerified] = useState(false);
  const submitting = useRef(false); // block a rapid double-tap
  const lock = useCountdown();

  const flow = useOtpFlow(
    purpose,
    phone,
    async () => (await api.auth.requestOtp({ phone })).expires_in,
    () => {
      setError(null);
      lock.start(0);
    },
  );
  const ready = isValidOtp(code) && !flow.expired && !alreadyVerified && lock.seconds === 0;

  async function handleVerify() {
    if (submitting.current || !ready) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const device = { device_id: await getOrCreateDeviceId(), device_name: getDeviceName(), platform: getPlatform() };
      if (purpose === "signup") {
        const res = await api.auth.verifySignupOtp({ phone, otp: code, ...device });
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
        setAlreadyVerified(true);
        setError(copy("Ye number pehle se verify hai. Login karein.", "This number is already verified. Please log in."));
      } else if (err instanceof ApiError && (err.code === "OTP_RATE_LIMITED" || err.code === "LOGIN_RATE_LIMITED" || err.code === "OTP_IP_RATE_LIMITED")) {
        lock.start(retryAfterSeconds(err.details) || 60);
      } else {
        setError(err instanceof ApiError && err.code === "INVALID_OTP" ? copy("Code galat hai. WhatsApp dekh kar dobara likhein.", "That code isn't right. Check WhatsApp and try again.") : friendlyErrorMessage(err));
        if (err instanceof ApiError && ["INVALID_OTP", "OTP_EXPIRED", "OTP_SUPERSEDED"].includes(err.code)) setCode("");
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <AuthShell
      testID="verify-screen"
      title={purpose === "signup" ? copy("WhatsApp par code bheja", "We sent a code on WhatsApp") : copy("Apna number verify karein", "Verify your phone")}
      subtitle={
        purpose === "signup"
          ? copy(`${phone} par 6 hindson ka code aaya hoga.`, `A 6-digit code was sent to ${phone}.`)
          : copy(`Hifazat ke liye number dobara verify karna hai. ${phone} par 6 hindson ka code bheja.`, `For your security we need to confirm this number again. We sent a 6-digit code to ${phone}.`)
      }
      onBack={() => (purpose === "signup" ? router.replace("/(auth)/signup") : router.replace("/(auth)/login"))}
      footer={
        <TextLink
          label={purpose === "signup" ? copy("Number badlein", "Use a different number") : copy("Login par wapas", "Back to log in")}
          onPress={() => (purpose === "signup" ? router.replace("/(auth)/signup") : router.replace("/(auth)/login"))}
        />
      }
    >
      <View style={{ width: 64, height: 64, borderRadius: radius.tile, backgroundColor: palette.openTint, alignItems: "center", justifyContent: "center" }} accessibilityElementsHidden importantForAccessibility="no">
        <MessageCircle size={30} color={palette.open} />
      </View>
      {isPending ? (
        <Banner
          tone="info"
          body={copy(
            "Is number ka signup pehle se chal raha hai. WhatsApp mein code dekhein ya neeche dobara bhejein. (Abhi daali gayi details save nahi huin.)",
            "A signup is already in progress for this number. Check WhatsApp for your code, or resend below. (The details you just entered weren't saved.)",
          )}
        />
      ) : null}
      <OtpInput value={code} onChange={setCode} error={!!error && !alreadyVerified} disabled={flow.expired} autoFocus />
      <OtpStatus flow={flow} />
      {lock.seconds > 0 ? (
        <Banner tone="danger" body={copy(`Bohat zyada koshishein. ${lock.seconds}s baad dobara.`, `Too many attempts. Try again in ${lock.seconds}s.`)} />
      ) : error ? (
        <Banner tone={alreadyVerified ? "info" : "danger"} body={error} testID="verify-error" />
      ) : null}
      {alreadyVerified ? (
        <Button label={copy("Login karein", "Log in")} block onPress={() => router.replace({ pathname: "/(auth)/login", params: { phone, notice: "phone-verified" } })} />
      ) : (
        <Button
          label={lock.seconds > 0 ? copy(`${lock.seconds}s baad`, `Try again in ${lock.seconds}s`) : copy("Verify karein", "Verify")}
          block
          loading={busy}
          disabled={!ready}
          onPress={handleVerify}
          testID="verify-submit"
        />
      )}
      <Text variant="caption" tone="muted" align="center">
        {copy("Code sirf WhatsApp par aata hai. Kisi ko na batayein.", "The code only comes on WhatsApp. Never share it.")}
      </Text>
    </AuthShell>
  );
}
