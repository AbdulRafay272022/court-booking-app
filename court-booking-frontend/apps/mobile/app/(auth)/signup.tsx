import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import {
  CITY_OPTIONS,
  GENDER_OPTIONS,
  pkNationalDigits,
  toE164,
  validateSignup,
  type City,
  type Gender,
  type SignupFields,
  type SignupRole,
} from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { usePendingAuth } from "@/lib/pending-auth";
import { openPrivacy, openTerms } from "@/lib/web-links";
import {
  AuthScreen,
  ChoicePills,
  FormMessage,
  PasswordField,
  SelectField,
  SubmitButton,
  TextField,
  toneColors,
} from "@/components/auth/kit";

const ROLE_OPTIONS = [
  { value: "player", label: "Player" },
  { value: "owner", label: "Venue owner" },
];

const EMPTY: SignupFields = { name: "", email: "", phone: "", city: "", gender: "", password: "", confirmPassword: "" };

/** Player and owner signup are ONE form; the toggle only changes the role sent (and the palette). */
export default function SignupScreen() {
  const [role, setRole] = useState<SignupRole>("player");
  const [f, setF] = useState<SignupFields>(EMPTY);
  const [touched, setTouched] = useState<Partial<Record<keyof SignupFields, boolean>>>({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [phoneTaken, setPhoneTaken] = useState(false);
  const [emailTaken, setEmailTaken] = useState(false);
  // QA signup-venue round item 9: real gate + server-recorded acceptance.
  const [termsAccepted, setTermsAccepted] = useState(false);

  const tone = role === "owner" ? "owner" : "player";
  const c = toneColors(tone);
  const errors = validateSignup(f);
  const valid = Object.keys(errors).length === 0 && termsAccepted;

  const set = <K extends keyof SignupFields>(key: K, value: SignupFields[K]) => {
    setF((p) => ({ ...p, [key]: value }));
    if (key === "phone") setPhoneTaken(false);
    if (key === "email") setEmailTaken(false);
  };
  const touch = (key: keyof SignupFields) => setTouched((p) => ({ ...p, [key]: true }));
  const show = (key: keyof SignupFields) => !!touched[key];
  const font = tone === "owner" ? "font-plex-medium" : "font-figtree-medium";
  const fontBold = tone === "owner" ? "font-plex-bold" : "font-figtree-bold";

  async function handleSubmit() {
    setBusy(true);
    setFormError(null);
    try {
      const phone = toE164(f.phone);
      const res = await api.auth.signup({
        name: f.name.trim(),
        email: f.email.trim(),
        phone,
        city: f.city as City,
        gender: f.gender as Gender,
        password: f.password,
        confirm_password: f.confirmPassword,
        role,
        terms_accepted: termsAccepted,
      });
      usePendingAuth.getState().rememberOtpExpiry("signup", phone, res.expires_in);
      router.push({ pathname: "/(auth)/verify", params: { purpose: "signup", phone, role } });
    } catch (err) {
      if (err instanceof ApiError && err.code === "PHONE_ALREADY_REGISTERED") setPhoneTaken(true);
      else if (err instanceof ApiError && err.code === "EMAIL_ALREADY_IN_USE") setEmailTaken(true);
      else if (err instanceof ApiError && err.code === "SIGNUP_ALREADY_PENDING") {
        // Item E: a signup is already in progress for this number. Do NOT seed a countdown from
        // retry_after (that's the retention window, not a fresh code) and do NOT imply the re-entered
        // details were saved -- they weren't. Route to Verify for the ORIGINAL pending signup with an
        // honest notice; the Verify screen fetches the real code status via otp-status.
        const phone = toE164(f.phone);
        router.push({ pathname: "/(auth)/verify", params: { purpose: "signup", phone, role, pending: "1" } });
      } else setFormError(friendlyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthScreen
      tone={tone}
      title={role === "owner" ? "List your venue" : "Create your account"}
      subtitle={
        role === "owner"
          ? "Set up your account first — you'll add your courts, hours and prices right after."
          : "Book courts near you in a minute. We'll verify your number on WhatsApp."
      }
      footer={
        <Text className={font} style={{ fontSize: 14, color: c.inkMuted }}>
          Already have an account?{" "}
          <Text onPress={() => router.replace("/(auth)/login")} className={fontBold} style={{ color: c.accent, textDecorationLine: "underline" }}>
            Log in
          </Text>
        </Text>
      }
    >
      <ChoicePills label="Signing up as" tone={tone} value={role} onChange={(v) => setRole(v as SignupRole)} options={ROLE_OPTIONS} />

      <TextField
        label="Full name"
        tone={tone}
        value={f.name}
        onChangeText={(v) => set("name", v)}
        onBlur={() => touch("name")}
        error={errors.name}
        showError={show("name")}
        placeholder="Bilal Ahmed"
        autoComplete="name"
        autoCapitalize="words"
      />
      <TextField
        label="Email address"
        tone={tone}
        value={f.email}
        onChangeText={(v) => set("email", v)}
        onBlur={() => touch("email")}
        error={emailTaken ? "That email address is already in use." : errors.email}
        showError={emailTaken || show("email")}
        placeholder="you@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
      />
      <View style={{ gap: 6 }}>
        <TextField
          label="Mobile number"
          tone={tone}
          mono
          keyboardType="number-pad"
          value={f.phone}
          onChangeText={(v) => set("phone", pkNationalDigits(v).slice(0, 10))}
          onBlur={() => touch("phone")}
          error={phoneTaken ? "This number already has an account." : errors.phone}
          showError={phoneTaken || show("phone")}
          placeholder="300 4408817"
          autoComplete="tel-national"
          prefix={
            <Text className="font-mono-semibold" style={{ fontSize: 15, color: c.inkMuted }}>
              +92
            </Text>
          }
        />
        {phoneTaken ? (
          <Text className={font} style={{ fontSize: 13, color: c.inkMuted }}>
            <Text onPress={() => router.replace("/(auth)/login")} className={fontBold} style={{ color: c.accent, textDecorationLine: "underline" }}>
              Log in
            </Text>{" "}
            or{" "}
            <Text
              onPress={() => router.push({ pathname: "/(auth)/forgot-password", params: { phone: toE164(f.phone) } })}
              className={fontBold}
              style={{ color: c.accent, textDecorationLine: "underline" }}
            >
              reset your password
            </Text>
            .
          </Text>
        ) : null}
      </View>
      <SelectField
        label="City"
        tone={tone}
        value={f.city}
        onChange={(v) => {
          set("city", v);
          touch("city");
        }}
        error={errors.city}
        showError={show("city")}
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
        showError={show("gender")}
      />
      <PasswordField
        label="Password"
        tone={tone}
        value={f.password}
        onChangeText={(v) => set("password", v)}
        onBlur={() => touch("password")}
        error={errors.password}
        showError={show("password")}
        placeholder="At least 8 characters"
        autoComplete="new-password"
      />
      <PasswordField
        label="Confirm password"
        tone={tone}
        value={f.confirmPassword}
        onChangeText={(v) => set("confirmPassword", v)}
        onBlur={() => touch("confirmPassword")}
        error={errors.confirmPassword}
        showError={show("confirmPassword")}
        placeholder="Type it again"
        autoComplete="new-password"
      />

      {formError ? <FormMessage kind="error" tone={tone}>{formError}</FormMessage> : null}

      {/* QA signup-venue round item 9: real checkbox that gates submit and drives the server's
          terms_accepted field. Uses a Pressable-styled box because React Native has no native
          <input type="checkbox">. */}
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: termsAccepted }}
        onPress={() => setTermsAccepted((v) => !v)}
        style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}
      >
        <View
          style={{
            width: 20,
            height: 20,
            marginTop: 2,
            borderRadius: 4,
            borderWidth: 1.5,
            borderColor: termsAccepted ? c.accent : c.inkFainter,
            backgroundColor: termsAccepted ? c.accent : "transparent",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {termsAccepted ? (
            <Text style={{ color: "#fff", fontSize: 13, fontWeight: "800" }}>✓</Text>
          ) : null}
        </View>
        <Text className={font} style={{ fontSize: 13.5, lineHeight: 20, color: c.inkMuted, flex: 1 }}>
          I agree to the{" "}
          <Text onPress={openTerms} style={{ color: c.accent, fontWeight: "700", textDecorationLine: "underline" }}>
            Terms of Service
          </Text>{" "}
          and{" "}
          <Text onPress={openPrivacy} style={{ color: c.accent, fontWeight: "700", textDecorationLine: "underline" }}>
            Privacy Policy
          </Text>
          .
        </Text>
      </Pressable>

      <SubmitButton
        tone={tone}
        ready={valid}
        busy={busy}
        label={role === "owner" ? "Create owner account" : "Create account"}
        busyLabel="Creating account…"
        onPress={handleSubmit}
      />
    </AuthScreen>
  );
}
