import { useState } from "react";
import { Alert, Image, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import {
  CITY_OPTIONS,
  GENDER_OPTIONS,
  isValidOtp,
  isValidPkMobile,
  pkNationalDigits,
  toE164,
  validatePhoneChange,
  validateProfile,
  type City,
  type Gender,
} from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { usePendingAuth } from "@/lib/pending-auth";
import {
  ChoicePills,
  FormMessage,
  OtpControls,
  fontFor,
  PasswordField,
  SelectField,
  SubmitButton,
  TextField,
  toneColors,
  useOtpFlow,
  type Tone,
} from "@/components/auth/kit";

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const AVATAR_MIME_ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

/** QA signup-venue round item 7: avatar picker on the profile screen. Uses the same
 * expo-image-picker + api.users.uploadAvatar path as the payment-proof upload's picker, and the
 * same 5 MB / JPEG-PNG-WebP contract as the backend enforces. Shows a live blob preview while
 * uploading, falls back to a first-letter tile when the user has no avatar yet. */
function AvatarPicker({ tone }: { tone: Tone }) {
  const user = useAuthStore((s) => s.user)!;
  const c = toneColors(tone);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  async function pick() {
    setError(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== "granted") {
      Alert.alert("Permission needed", "Allow access so you can pick a profile photo.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const mime = asset.mimeType ?? "image/jpeg";
    if (!AVATAR_MIME_ALLOWED.has(mime)) {
      setError("Pick a JPEG, PNG or WebP image.");
      return;
    }
    if (typeof asset.fileSize === "number" && asset.fileSize > AVATAR_MAX_BYTES) {
      setError("That image is over 5 MB.");
      return;
    }
    setPreview(asset.uri);
    setUploading(true);
    try {
      const updated = await api.users.uploadAvatar(asset.uri, asset.fileName ?? "avatar.jpg", mime);
      useAuthStore.getState().setUser(updated, useAuthStore.getState().session ?? undefined);
    } catch (e) {
      setError(friendlyErrorMessage(e));
      setPreview(null);
    } finally {
      setUploading(false);
    }
  }

  const uri = preview ?? user.avatar_url ?? null;
  const initial = (user.name ?? user.phone ?? "?").trim().charAt(0).toUpperCase();
  return (
    <View style={{ gap: 12, flexDirection: "row", alignItems: "center" }}>
      {uri ? (
        <Image
          source={{ uri }}
          accessibilityLabel="Your avatar"
          style={{ width: 72, height: 72, borderRadius: 36, borderWidth: 1, borderColor: c.border }}
        />
      ) : (
        <View
          accessibilityElementsHidden
          style={{
            width: 72,
            height: 72,
            borderRadius: 36,
            borderWidth: 1,
            borderColor: c.border,
            backgroundColor: c.accentSoft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontSize: 26, fontWeight: "800", color: c.accent }}>{initial}</Text>
        </View>
      )}
      <View style={{ flex: 1, gap: 6 }}>
        <Pressable
          accessibilityRole="button"
          onPress={pick}
          disabled={uploading}
          style={{
            alignSelf: "flex-start",
            height: 40,
            paddingHorizontal: 16,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: c.border,
            backgroundColor: c.surface,
            justifyContent: "center",
            opacity: uploading ? 0.6 : 1,
          }}
        >
          <Text className={fontFor(tone, "bold")} style={{ fontSize: 13.5, color: c.ink }}>
            {uploading ? "Uploading…" : uri ? "Change photo" : "Add a photo"}
          </Text>
        </Pressable>
        <Text className={fontFor(tone, "medium")} style={{ fontSize: 12, color: c.inkFainter }}>
          JPEG, PNG or WebP · up to 5 MB
        </Text>
        {error ? <FormMessage kind="error" tone={tone}>{error}</FormMessage> : null}
      </View>
    </View>
  );
}


/** After a DELIBERATE sign-out that must land on a specific login screen (phone change, password
 * change): sign out, then -- once the root layout has swapped to the auth group -- replace onto login
 * with the notice/phone. (A plain signOut() would land on a bare login screen.) */
function signOutThenLogin(params: { phone?: string; notice: string }) {
  void useAuthStore.getState().signOut();
  setTimeout(() => router.replace({ pathname: "/(auth)/login", params }), 60);
}

/** Edit profile (both roles): name, email, city, gender. Phone and password are deliberately NOT inputs
 * here: phone has its own OTP-verified flow, and the password goes through forgot-password (one
 * password-change path, not a second one that asks for the old password). */
export function ProfileForm({ tone, changePhoneRoute }: { tone: Tone; changePhoneRoute: "/(player)/change-phone" | "/(owner)/change-phone" }) {
  const user = useAuthStore((s) => s.user)!;
  const c = toneColors(tone);
  const [f, setF] = useState({ name: user.name ?? "", email: user.email ?? "", city: user.city ?? "", gender: user.gender ?? "" });
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailTaken, setEmailTaken] = useState(false);
  const [confirmingPassword, setConfirmingPassword] = useState(false);

  const errors = validateProfile(f);
  const valid = Object.keys(errors).length === 0;
  const dirty =
    f.name.trim() !== (user.name ?? "") ||
    f.email.trim().toLowerCase() !== (user.email ?? "").toLowerCase() ||
    f.city !== (user.city ?? "") ||
    f.gender !== (user.gender ?? "");

  const set = (key: keyof typeof f, value: string) => {
    setF((p) => ({ ...p, [key]: value }));
    setSaved(false);
    if (key === "email") setEmailTaken(false);
  };
  const touch = (key: string) => setTouched((p) => ({ ...p, [key]: true }));

  async function handleSave() {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.auth.updateMe({
        name: f.name.trim(),
        email: f.email.trim(),
        city: f.city as City,
        gender: f.gender as Gender,
      });
      useAuthStore.getState().setUser(updated, useAuthStore.getState().session ?? undefined);
      setF({ name: updated.name ?? "", email: updated.email ?? "", city: updated.city ?? "", gender: updated.gender ?? "" });
      setSaved(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === "EMAIL_ALREADY_IN_USE") setEmailTaken(true);
      else setError(friendlyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const rowStyle = { backgroundColor: c.surface, borderWidth: 1, borderColor: c.border, borderRadius: 16, padding: 16, gap: 10 } as const;
  const smallBtn = { minHeight: 44, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: c.border, alignItems: "center", justifyContent: "center" } as const;

  return (
    <View style={{ gap: 22 }}>
      <View style={{ gap: 12 }}>
        <Text className={fontFor(tone, "bold")} style={{ fontSize: 11, letterSpacing: 1.2, color: c.inkFainter }}>
          PROFILE PHOTO
        </Text>
        <AvatarPicker tone={tone} />
      </View>

      <View style={{ gap: 18 }}>
        <Text className={fontFor(tone, "bold")} style={{ fontSize: 11, letterSpacing: 1.2, color: c.inkFainter }}>
          EDIT PROFILE
        </Text>
        <TextField label="Full name" tone={tone} value={f.name} onChangeText={(v) => set("name", v)} onBlur={() => touch("name")} error={errors.name} showError={!!touched.name} autoCapitalize="words" />
        <TextField
          label="Email address"
          tone={tone}
          value={f.email}
          onChangeText={(v) => set("email", v)}
          onBlur={() => touch("email")}
          error={emailTaken ? "That email address is already in use." : errors.email}
          showError={emailTaken || !!touched.email}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <SelectField
          label="City"
          tone={tone}
          value={f.city}
          onChange={(v) => {
            set("city", v);
            touch("city");
          }}
          error={errors.city}
          showError={!!touched.city}
          placeholder="Select your city"
          options={CITY_OPTIONS}
        />
        <ChoicePills
          label="Gender"
          tone={tone}
          value={f.gender}
          onChange={(v) => {
            set("gender", v);
            touch("gender");
          }}
          options={GENDER_OPTIONS}
          error={errors.gender}
          showError={!!touched.gender}
        />
        {error ? <FormMessage kind="error" tone={tone}>{error}</FormMessage> : null}
        {saved ? <FormMessage kind="success" tone={tone}>Profile saved.</FormMessage> : null}
        <SubmitButton tone={tone} ready={valid && dirty} busy={busy} label="Save changes" busyLabel="Saving…" onPress={handleSave} />
      </View>

      <View style={{ gap: 10 }}>
        <Text className={fontFor(tone, "bold")} style={{ fontSize: 11, letterSpacing: 1.2, color: c.inkFainter }}>
          SIGN-IN DETAILS
        </Text>
        <View style={rowStyle}>
          <Text className={fontFor(tone, "semibold")} style={{ fontSize: 12.5, color: c.inkFainter }}>
            Phone number
          </Text>
          <Text className="font-mono-semibold" accessibilityLabel="Current phone number" style={{ fontSize: 15, color: c.ink }}>
            {user.phone}
          </Text>
          <Text className={fontFor(tone, "medium")} style={{ fontSize: 12, color: c.inkMuted }}>
            Changing it needs your password and a code sent to the new number.
          </Text>
          <Pressable accessibilityRole="button" onPress={() => router.push(changePhoneRoute)} style={smallBtn}>
            <Text className={fontFor(tone, "bold")} style={{ fontSize: 13.5, color: c.accent }}>
              Change phone number
            </Text>
          </Pressable>
        </View>
        <View style={rowStyle}>
          <Text className={fontFor(tone, "semibold")} style={{ fontSize: 12.5, color: c.inkFainter }}>
            Password
          </Text>
          {confirmingPassword ? (
            <>
              <Text className={fontFor(tone, "medium")} style={{ fontSize: 13, lineHeight: 19, color: c.inkMuted }}>
                We'll log you out and send a code on WhatsApp so you can choose a new password. It logs you out on every device.
              </Text>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Pressable accessibilityRole="button" onPress={() => setConfirmingPassword(false)} style={[smallBtn, { flex: 1 }]}>
                  <Text className={fontFor(tone, "semibold")} style={{ fontSize: 13.5, color: c.inkMuted }}>
                    Cancel
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    void useAuthStore.getState().signOut();
                    // Signed out first (the auth group is only reachable while signed out), then straight into
                    // the reset flow with the number prefilled.
                    setTimeout(() => router.replace({ pathname: "/(auth)/forgot-password", params: { phone: user.phone } }), 60);
                  }}
                  style={[smallBtn, { flex: 1, backgroundColor: c.accent, borderColor: c.accent }]}
                >
                  <Text className={fontFor(tone, "bold")} style={{ fontSize: 13.5, color: "#FFFFFF" }}>
                    Continue
                  </Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <Text className={fontFor(tone, "medium")} style={{ fontSize: 12, color: c.inkMuted }}>
                Uses the same WhatsApp reset as "Forgot password".
              </Text>
              <Pressable accessibilityRole="button" onPress={() => setConfirmingPassword(true)} style={smallBtn}>
                <Text className={fontFor(tone, "bold")} style={{ fontSize: 13.5, color: c.accent }}>
                  Change password
                </Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </View>
  );
}

/** Phone-number change (both roles): new number + CURRENT password -> code to the NEW number -> code.
 * Only when the code succeeds does the number change, and then every session ends (this one too), so we
 * sign out and land on login with the new number prefilled and a notice. Abandoning changes nothing. */
export function ChangePhoneForm({ tone }: { tone: Tone }) {
  const user = useAuthStore((s) => s.user)!;
  const [step, setStep] = useState<1 | 2>(1);
  const [newPhone, setNewPhone] = useState("");
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState({ newPhone: false, password: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phoneTaken, setPhoneTaken] = useState(false);
  const c = toneColors(tone);

  const e164 = isValidPkMobile(newPhone) ? toE164(newPhone) : "";
  const errors = validatePhoneChange({ newPhone, password });
  const ready = Object.keys(errors).length === 0 && e164 !== user.phone;

  async function handleRequest() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.auth.requestPhoneChange({ new_phone: e164, password });
      usePendingAuth.getState().rememberOtpExpiry("phone_change", e164, res.expires_in);
      setStep(2);
    } catch (err) {
      if (err instanceof ApiError && err.code === "PHONE_ALREADY_REGISTERED") setPhoneTaken(true);
      else if (err instanceof ApiError && err.code === "INVALID_CREDENTIALS") setError("Incorrect password.");
      else setError(friendlyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (step === 2) return <CodeStep e164={e164} password={password} tone={tone} onBack={() => setStep(1)} />;

  return (
    <View style={{ gap: 18 }}>
      <Text className={fontFor(tone, "medium")} style={{ fontSize: 14.5, lineHeight: 21, color: c.inkMuted }}>
        Your current number is <Text className="font-mono-semibold" style={{ color: c.ink }}>{user.phone}</Text>. After the change you'll be logged out
        everywhere and sign in again with the new number and your existing password.
      </Text>
      <TextField
        label="New mobile number"
        tone={tone}
        mono
        keyboardType="number-pad"
        autoFocus
        value={newPhone}
        onChangeText={(v) => {
          setNewPhone(pkNationalDigits(v).slice(0, 10));
          setPhoneTaken(false);
        }}
        onBlur={() => setTouched((p) => ({ ...p, newPhone: true }))}
        error={phoneTaken ? "An account with this number already exists." : e164 === user.phone && newPhone ? "That is already your number." : errors.newPhone}
        showError={phoneTaken || touched.newPhone}
        placeholder="300 4408817"
        prefix={
          <Text className="font-mono-semibold" style={{ fontSize: 15, color: c.inkMuted }}>
            +92
          </Text>
        }
      />
      <PasswordField
        label="Current password"
        tone={tone}
        value={password}
        onChangeText={setPassword}
        onBlur={() => setTouched((p) => ({ ...p, password: true }))}
        error={errors.password}
        showError={touched.password}
        placeholder="Confirms it's really you"
      />
      {error ? <FormMessage kind="error" tone={tone}>{error}</FormMessage> : null}
      <SubmitButton tone={tone} ready={ready} busy={busy} label="Send code to new number" busyLabel="Sending code…" onPress={handleRequest} />
    </View>
  );
}

function CodeStep({ e164, password, tone, onBack }: { e164: string; password: string; tone: Tone; onBack: () => void }) {
  const c = toneColors(tone);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flow = useOtpFlow("phone_change", e164, async () => (await api.auth.requestPhoneChange({ new_phone: e164, password })).expires_in);
  const ready = isValidOtp(code) && !flow.expired;

  async function handleVerify() {
    setBusy(true);
    setError(null);
    try {
      await api.auth.verifyPhoneChange({ new_phone: e164, otp: code });
      // Every session just ended (this one included): sign out and land on login with the new number.
      signOutThenLogin({ phone: e164, notice: "phone-changed" });
    } catch (err) {
      setError(friendlyErrorMessage(err));
      if (err instanceof ApiError && (err.code === "INVALID_OTP" || err.code === "OTP_EXPIRED")) setCode("");
      if (err instanceof ApiError && err.code === "PHONE_ALREADY_REGISTERED") onBack();
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: 18 }}>
      <Text className={fontFor(tone, "medium")} style={{ fontSize: 14.5, lineHeight: 21, color: c.inkMuted }}>
        We sent a 6-digit code on WhatsApp to <Text className="font-mono-semibold" style={{ color: c.ink }}>{e164}</Text>.
      </Text>
      <TextField
        label="Verification code"
        tone={tone}
        mono
        keyboardType="number-pad"
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
      <SubmitButton tone={tone} ready={ready} busy={busy} label="Verify and change number" busyLabel="Verifying…" onPress={handleVerify} />
      <Pressable onPress={onBack} style={{ alignItems: "center", minHeight: 40, justifyContent: "center" }}>
        <Text className={fontFor(tone, "semibold")} style={{ fontSize: 13.5, color: c.inkMuted, textDecorationLine: "underline" }}>
          Use a different number
        </Text>
      </Pressable>
    </View>
  );
}
