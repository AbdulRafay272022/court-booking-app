import { useState } from "react";
import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { CITY_OPTIONS, GENDER_OPTIONS, pkNationalDigits, toE164, validateSignup, type City, type Gender, type SignupFields, type SignupRole } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";
import { palette, radius, size, space } from "@court-booking/ui-tokens";

import { Banner, Button, Checkbox, Chip, Input, Text, useCopy, useRoleTheme } from "@/components/ui";
import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { usePendingAuth } from "@/lib/pending-auth";
import { openPrivacy, openTerms } from "@/lib/web-links";
import { AuthShell, SelectSheetField, TextLink } from "./_fl";

const EMPTY: SignupFields = { name: "", email: "", phone: "", city: "", gender: "", password: "", confirmPassword: "" };

/** PAuth board frame 2: ONE signup form for both roles (the Player / Owner toggle only changes the role sent). */
export default function SignupScreen() {
  const copy = useCopy();
  const t = useRoleTheme();
  const [role, setRole] = useState<SignupRole>("player");
  const [f, setF] = useState<SignupFields>(EMPTY);
  const [touched, setTouched] = useState<Partial<Record<keyof SignupFields, boolean>>>({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [phoneTaken, setPhoneTaken] = useState(false);
  const [emailTaken, setEmailTaken] = useState(false);
  // Real gate + server-recorded acceptance.
  const [termsAccepted, setTermsAccepted] = useState(false);

  const errors = validateSignup(f);
  const valid = Object.keys(errors).length === 0 && termsAccepted;
  const set = <K extends keyof SignupFields>(key: K, value: SignupFields[K]) => {
    setF((p) => ({ ...p, [key]: value }));
    if (key === "phone") setPhoneTaken(false);
    if (key === "email") setEmailTaken(false);
  };
  const touch = (key: keyof SignupFields) => setTouched((p) => ({ ...p, [key]: true }));
  const err = (key: keyof SignupFields) => (touched[key] ? errors[key] : null);

  async function handleSubmit() {
    if (!valid) return;
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
    } catch (e) {
      if (e instanceof ApiError && e.code === "PHONE_ALREADY_REGISTERED") setPhoneTaken(true);
      else if (e instanceof ApiError && e.code === "EMAIL_ALREADY_IN_USE") setEmailTaken(true);
      else if (e instanceof ApiError && e.code === "SIGNUP_ALREADY_PENDING") {
        // A signup is already in progress: go to Verify for the ORIGINAL pending signup with an honest notice.
        router.push({ pathname: "/(auth)/verify", params: { purpose: "signup", phone: toE164(f.phone), role, pending: "1" } });
      } else setFormError(friendlyErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const roles: { value: SignupRole; title: string; sub: string }[] = [
    { value: "player", title: copy("Main khelta hoon", "I play"), sub: copy("Court book karna", "Book courts") },
    { value: "owner", title: copy("Mera venue hai", "I own a venue"), sub: copy("Court list karna", "List my courts") },
  ];

  return (
    <AuthShell
      testID="signup-screen"
      title={copy("Account banayein", "Create your account")}
      subtitle={copy("Number WhatsApp par verify hoga.", "We'll verify your number on WhatsApp.")}
      onBack={() => (router.canGoBack() ? router.back() : router.replace("/(auth)/login"))}
      footer={<TextLink before={copy("Pehle se account hai?", "Already have an account?")} label={copy("Login", "Log in")} onPress={() => router.replace("/(auth)/login")} />}
    >
      <View style={{ flexDirection: "row", gap: space[2], flexWrap: "wrap" }} accessibilityRole="radiogroup" accessibilityLabel={copy("Account kis liye", "Account type")}>
        {roles.map((r) => {
          const on = role === r.value;
          return (
            <Pressable
              key={r.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`${r.title}, ${r.sub}`}
              onPress={() => setRole(r.value)}
              testID={`signup-role-${r.value}`}
              style={{ flexGrow: 1, flexBasis: 130, minHeight: 64, borderRadius: radius.input, padding: space[3], backgroundColor: on ? t.selected.bg : palette.white, borderWidth: 2, borderColor: on ? t.selected.border : palette.line, gap: 2, justifyContent: "center" }}
            >
              <Text variant="bodyBold" weight="black" color={on ? t.selected.fg : palette.night}>
                {on ? "✓ " : ""}
                {r.title}
              </Text>
              <Text variant="caption" tone="muted">
                {r.sub}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Input label={copy("Poora naam", "Full name")} value={f.name} onChangeText={(v) => set("name", v)} onBlur={() => touch("name")} error={err("name")} placeholder="Bilal Ahmed" autoComplete="name" autoCapitalize="words" testID="signup-name" />
      <Input
        label={copy("Email", "Email address")}
        value={f.email}
        onChangeText={(v) => set("email", v)}
        onBlur={() => touch("email")}
        error={emailTaken ? copy("Ye email pehle se istemal mein hai.", "That email address is already in use.") : err("email")}
        placeholder="you@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        testID="signup-email"
      />
      <Input
        label={copy("Mobile number", "Mobile number")}
        prefix="+92"
        keyboardType="number-pad"
        value={f.phone}
        onChangeText={(v) => set("phone", pkNationalDigits(v).slice(0, 10))}
        onBlur={() => touch("phone")}
        error={phoneTaken ? copy("Is number ka account pehle se hai.", "This number already has an account.") : err("phone")}
        help={copy("Is par WhatsApp code aayega", "The WhatsApp code comes to this number")}
        placeholder="300 1234567"
        autoComplete="tel-national"
        testID="signup-phone"
      />
      {phoneTaken ? (
        <View style={{ flexDirection: "row", gap: space[2], flexWrap: "wrap" }}>
          <Button label={copy("Login karein", "Log in")} variant="soft" size="sm" onPress={() => router.replace("/(auth)/login")} />
          <Button label={copy("Password reset", "Reset password")} variant="soft" size="sm" onPress={() => router.push({ pathname: "/(auth)/forgot-password", params: { phone: toE164(f.phone) } })} />
        </View>
      ) : null}
      <SelectSheetField
        label={copy("Shehar", "City")}
        value={f.city as City | ""}
        options={CITY_OPTIONS}
        placeholder={copy("Shehar chunein", "Select your city")}
        error={err("city")}
        onChange={(v) => {
          set("city", v);
          touch("city");
        }}
        testID="signup-city"
      />
      <View style={{ gap: space[2] }}>
        <Text variant="label">{copy("Gender", "Gender")}</Text>
        <View style={{ flexDirection: "row", gap: space[2], flexWrap: "wrap" }}>
          {GENDER_OPTIONS.map((g) => (
            <Chip
              key={g.value}
              label={g.label}
              selected={f.gender === g.value}
              onPress={() => {
                set("gender", g.value);
                touch("gender");
              }}
              testID={`signup-gender-${g.value}`}
            />
          ))}
        </View>
        {err("gender") ? (
          <Text variant="caption" weight="bold" tone="danger">
            {err("gender")}
          </Text>
        ) : null}
      </View>
      <Input label={copy("Password", "Password")} secureToggle value={f.password} onChangeText={(v) => set("password", v)} onBlur={() => touch("password")} error={err("password")} placeholder={copy("Kam se kam 8 huroof", "At least 8 characters")} autoComplete="new-password" testID="signup-password" />
      <Input label={copy("Password dobara", "Confirm password")} secureToggle value={f.confirmPassword} onChangeText={(v) => set("confirmPassword", v)} onBlur={() => touch("confirmPassword")} error={err("confirmPassword")} placeholder={copy("Wahi password", "Type it again")} autoComplete="new-password" testID="signup-confirm" />

      {formError ? <Banner tone="danger" body={formError} /> : null}

      <Checkbox checked={termsAccepted} onChange={setTermsAccepted} testID="signup-terms">
        <Text variant="body">
          {copy("Main ", "I agree to the ")}
          <Text variant="bodyBold" tone="link" onPress={openTerms} accessibilityRole="link">
            Terms
          </Text>
          {copy(" aur ", " and ")}
          <Text variant="bodyBold" tone="link" onPress={openPrivacy} accessibilityRole="link">
            Privacy
          </Text>
          {copy(" se mutafiq hoon", "")}
        </Text>
      </Checkbox>

      <Button label={copy("WhatsApp code bhejein", "Send WhatsApp code")} block loading={busy} disabled={!valid} onPress={handleSubmit} testID="signup-submit" />
      <View style={{ height: size.tap / 4 }} />
    </AuthShell>
  );
}
