import { useState } from "react";
import { router } from "expo-router";
import { isValidOtp, isValidPkMobile, pkNationalDigits, toE164, validatePhoneChange } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";

import { Banner, Button, Header, Input, OtpInput, Screen, Text, useCopy } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { usePendingAuth } from "@/lib/pending-auth";
import { safeBack } from "@/lib/safe-back";
import { PLAYER_HOME_HREF } from "@/lib/safe-back-rules";
import { useOtpFlow } from "@/components/auth/kit";
import { OtpStatus } from "../(auth)/_fl";

/** Phone change (PAccount): new number + CURRENT password -> code to the NEW number -> code. Only a correct code changes the
 * number; every session then ends, so we sign out and land on login with the new number and a notice. */
export default function PlayerChangePhoneScreen() {
  const copy = useCopy();
  const user = useAuthStore((s) => s.user)!;
  const [step, setStep] = useState<1 | 2>(1);
  const [newPhone, setNewPhone] = useState("");
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState({ newPhone: false, password: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phoneTaken, setPhoneTaken] = useState(false);

  const e164 = isValidPkMobile(newPhone) ? toE164(newPhone) : "";
  const errors = validatePhoneChange({ newPhone, password });
  const ready = Object.keys(errors).length === 0 && e164 !== user.phone;

  async function request() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.auth.requestPhoneChange({ new_phone: e164, password });
      usePendingAuth.getState().rememberOtpExpiry("phone_change", e164, res.expires_in);
      setStep(2);
    } catch (err) {
      if (err instanceof ApiError && err.code === "PHONE_ALREADY_REGISTERED") setPhoneTaken(true);
      else if (err instanceof ApiError && err.code === "INVALID_CREDENTIALS") setError(copy("Password galat hai.", "Incorrect password."));
      else setError(friendlyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen keyboard>
      <Header title={copy("Mobile number badlein", "Change phone number")} onBack={() => (step === 2 ? setStep(1) : safeBack(PLAYER_HOME_HREF))} />
      {step === 1 ? (
        <>
          <Text variant="body" tone="muted">
            {copy(`Abhi ka number ${user.phone} hai. Badalne ke baad har jagah se logout ho jayenge aur naye number aur purane password se login karenge.`, `Your current number is ${user.phone}. After the change you'll be logged out everywhere and sign in with the new number and your existing password.`)}
          </Text>
          <Input
            label={copy("Naya mobile number", "New mobile number")}
            prefix="+92"
            keyboardType="number-pad"
            autoFocus
            value={newPhone}
            onChangeText={(v) => {
              setNewPhone(pkNationalDigits(v).slice(0, 10));
              setPhoneTaken(false);
            }}
            onBlur={() => setTouched((p) => ({ ...p, newPhone: true }))}
            error={phoneTaken ? copy("Is number ka account pehle se hai.", "An account with this number already exists.") : e164 === user.phone && newPhone ? copy("Ye pehle se aap ka number hai.", "That is already your number.") : touched.newPhone ? errors.newPhone : null}
            placeholder="300 1234567"
          />
          <Input label={copy("Abhi ka password", "Current password")} secureToggle value={password} onChangeText={setPassword} onBlur={() => setTouched((p) => ({ ...p, password: true }))} error={touched.password ? errors.password : null} />
          {error ? <Banner tone="danger" body={error} /> : null}
          <Button label={copy("Naye number par code bhejein", "Send code to new number")} block loading={busy} disabled={!ready} onPress={request} />
        </>
      ) : (
        <CodeStep e164={e164} password={password} onBack={() => setStep(1)} />
      )}
    </Screen>
  );
}

function CodeStep({ e164, password, onBack }: { e164: string; password: string; onBack: () => void }) {
  const copy = useCopy();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flow = useOtpFlow("phone_change", e164, async () => (await api.auth.requestPhoneChange({ new_phone: e164, password })).expires_in);
  const ready = isValidOtp(code) && !flow.expired;

  async function verify() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      await api.auth.verifyPhoneChange({ new_phone: e164, otp: code });
      // Every session just ended (this one included): sign out and land on login with the new number.
      void useAuthStore.getState().signOut();
      setTimeout(() => router.replace({ pathname: "/(auth)/login", params: { phone: e164, notice: "phone-changed" } }), 60);
    } catch (err) {
      setError(friendlyErrorMessage(err));
      if (err instanceof ApiError && (err.code === "INVALID_OTP" || err.code === "OTP_EXPIRED")) setCode("");
      if (err instanceof ApiError && err.code === "PHONE_ALREADY_REGISTERED") onBack();
      setBusy(false);
    }
  }

  return (
    <>
      <Text variant="body" tone="muted">
        {copy(`${e164} par WhatsApp se 6 hindson ka code bheja.`, `We sent a 6-digit code on WhatsApp to ${e164}.`)}
      </Text>
      <OtpInput value={code} onChange={setCode} error={!!error} disabled={flow.expired} autoFocus />
      <OtpStatus flow={flow} />
      {error ? <Banner tone="danger" body={error} /> : null}
      <Button label={copy("Verify karke number badlein", "Verify and change number")} block loading={busy} disabled={!ready} onPress={verify} />
      <Button label={copy("Doosra number", "Use a different number")} variant="soft" size="md" block onPress={onBack} />
    </>
  );
}
