"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CITY_OPTIONS,
  GENDER_OPTIONS,
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
import { rememberOtpExpiry } from "@/lib/pending-auth";
import { retryAfterSeconds } from "@/lib/use-countdown";
import { useRedirectIfSignedIn } from "@/lib/use-auth-helpers";
import { AuthShell } from "@/components/auth/auth-shell";
import { ChoicePills, FormMessage, PasswordField, SelectField, TextField } from "@/components/auth/fields";
import { SubmitButton } from "@/components/auth/submit-button";
import { TONES } from "@/components/auth/tone";

const ROLE_OPTIONS = [
  { value: "player", label: "Player" },
  { value: "owner", label: "Venue owner" },
];

const EMPTY: SignupFields = { name: "", email: "", phone: "", city: "", gender: "", password: "", confirmPassword: "" };

function SignupForm() {
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get("next");
  const signedIn = useRedirectIfSignedIn();

  const [role, setRole] = useState<SignupRole>(search.get("role") === "owner" ? "owner" : "player");
  const [f, setF] = useState<SignupFields>(EMPTY);
  const [touched, setTouched] = useState<Partial<Record<keyof SignupFields, boolean>>>({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [phoneTaken, setPhoneTaken] = useState(false);
  const [emailTaken, setEmailTaken] = useState(false);

  // Owner signup uses the same form; only the palette changes (teal, owner system).
  const tone = role === "owner" ? "owner" : "player";
  const t = TONES[tone];

  const errors = validateSignup(f);
  const valid = Object.keys(errors).length === 0;

  const set = <K extends keyof SignupFields>(key: K, value: SignupFields[K]) => {
    setF((prev) => ({ ...prev, [key]: value }));
    if (key === "phone") setPhoneTaken(false);
    if (key === "email") setEmailTaken(false);
  };
  const touch = (key: keyof SignupFields) => setTouched((prev) => ({ ...prev, [key]: true }));
  const show = (key: keyof SignupFields) => !!touched[key];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
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
      });
      rememberOtpExpiry("signup", phone, res.expires_in);
      const qs = new URLSearchParams({ purpose: "signup", phone, role });
      if (next) qs.set("next", next);
      router.push(`/verify?${qs.toString()}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === "PHONE_ALREADY_REGISTERED") setPhoneTaken(true);
      else if (err instanceof ApiError && err.code === "EMAIL_ALREADY_IN_USE") setEmailTaken(true);
      else if (err instanceof ApiError && err.code === "SIGNUP_ALREADY_PENDING") {
        // QA #1: a verification is already in progress for this number. Don't overwrite it -- send
        // the user to the code screen (they can enter the code already sent, or resend). Seed the
        // countdown from the live code's remaining life (retry_after_seconds).
        const phone = toE164(f.phone);
        const remaining = retryAfterSeconds(err.details);
        if (remaining) rememberOtpExpiry("signup", phone, remaining);
        const qs = new URLSearchParams({ purpose: "signup", phone, role });
        if (next) qs.set("next", next);
        router.push(`/verify?${qs.toString()}`);
      } else setFormError(friendlyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (signedIn) return null;

  return (
    <AuthShell
      tone={tone}
      title={role === "owner" ? "List your venue" : "Create your account"}
      subtitle={
        role === "owner"
          ? "Set up your account first — you'll add your courts, hours and prices right after."
          : "Book courts near you in a minute. We'll verify your number on WhatsApp."
      }
      footer={
        <>
          Already have an account?{" "}
          <Link href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"} className="font-bold underline" style={{ color: t.accent }}>
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
        <ChoicePills label="Signing up as" tone={tone} value={role} onChange={(v) => setRole(v as SignupRole)} options={ROLE_OPTIONS} />

        <TextField
          label="Full name"
          tone={tone}
          value={f.name}
          onChange={(e) => set("name", e.target.value)}
          onBlur={() => touch("name")}
          error={errors.name}
          showError={show("name")}
          autoComplete="name"
          placeholder="Bilal Ahmed"
        />
        <TextField
          label="Email address"
          tone={tone}
          type="email"
          inputMode="email"
          value={f.email}
          onChange={(e) => set("email", e.target.value)}
          onBlur={() => touch("email")}
          error={emailTaken ? "That email address is already in use." : errors.email}
          showError={emailTaken || show("email")}
          autoComplete="email"
          placeholder="you@example.com"
        />
        <div className="flex flex-col gap-2">
          <TextField
            label="Mobile number"
            tone={tone}
            mono
            inputMode="numeric"
            value={f.phone}
            onChange={(e) => set("phone", e.target.value.replace(/\D/g, ""))}
            onBlur={() => touch("phone")}
            error={phoneTaken ? "This number already has an account." : errors.phone}
            showError={phoneTaken || show("phone")}
            autoComplete="tel-national"
            placeholder="300 4408817"
            prefix={
              <span className="font-[family-name:var(--font-mono-x)] text-[15px] font-semibold" style={{ color: t.muted }}>
                +92
              </span>
            }
          />
          {phoneTaken ? (
            <p className="text-[13px] font-medium" style={{ color: t.muted }}>
              <Link href="/login" className="font-bold underline" style={{ color: t.accent }}>
                Log in
              </Link>{" "}
              or{" "}
              <Link href="/forgot-password" className="font-bold underline" style={{ color: t.accent }}>
                reset your password
              </Link>
              .
            </p>
          ) : null}
        </div>
        <SelectField
          label="City"
          tone={tone}
          value={f.city}
          onChange={(v) => {
            set("city", v);
            touch("city");
          }}
          onBlur={() => touch("city")}
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
          onChange={(e) => set("password", e.target.value)}
          onBlur={() => touch("password")}
          error={errors.password}
          showError={show("password")}
          autoComplete="new-password"
          placeholder="At least 8 characters"
        />
        <PasswordField
          label="Confirm password"
          tone={tone}
          value={f.confirmPassword}
          onChange={(e) => set("confirmPassword", e.target.value)}
          onBlur={() => touch("confirmPassword")}
          error={errors.confirmPassword}
          showError={show("confirmPassword")}
          autoComplete="new-password"
          placeholder="Type it again"
        />

        {formError ? <FormMessage kind="error" tone={tone}>{formError}</FormMessage> : null}

        <SubmitButton tone={tone} ready={valid} busy={busy} busyLabel="Creating account…">
          {role === "owner" ? "Create owner account" : "Create account"}
        </SubmitButton>

        <p className="text-[12.5px] font-medium leading-relaxed text-center" style={{ color: t.faint }}>
          By continuing you agree to our{" "}
          <Link href="/terms" target="_blank" className="underline font-semibold" style={{ color: t.accent }}>
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" target="_blank" className="underline font-semibold" style={{ color: t.accent }}>
            Privacy Policy
          </Link>
          .
        </p>
      </form>
    </AuthShell>
  );
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}
