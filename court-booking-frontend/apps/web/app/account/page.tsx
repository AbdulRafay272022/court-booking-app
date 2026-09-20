"use client";

import { useState } from "react";
import Link from "next/link";
import { CITY_OPTIONS, GENDER_OPTIONS, validateProfile, type City, type Gender } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { ChoicePills, FormMessage, SelectField, TextField } from "@/components/auth/fields";
import { SubmitButton } from "@/components/auth/submit-button";
import { TONES } from "@/components/auth/tone";

/** Edit profile (both roles): name, email, city, gender. Phone and password are deliberately NOT
 * inputs here -- phone has its own OTP-verified flow, and the password goes through forgot-password
 * (one password-change path, not a second one asking for the old password). */
export default function AccountPage() {
  const user = useAuthStore((s) => s.user)!;
  const tone = user.role === "owner" || user.role === "admin" ? "owner" : "player";
  const t = TONES[tone];

  const [f, setF] = useState({ name: user.name ?? "", email: user.email ?? "", city: user.city ?? "", gender: user.gender ?? "" });
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailTaken, setEmailTaken] = useState(false);

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

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || !dirty || busy) return;
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

  const row = "flex items-center justify-between gap-4 rounded-2xl px-5 py-4";
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-[26px] font-extrabold tracking-[-0.03em]">Your account</h1>
        <p className="text-[14.5px] font-medium" style={{ color: t.muted }}>
          {user.role === "owner" ? "Venue owner" : user.role === "admin" ? "Admin" : "Player"}
        </p>
      </div>

      <form onSubmit={handleSave} noValidate className="flex flex-col gap-5 rounded-3xl p-6" style={{ background: t.surface, border: `1px solid ${t.border}` }}>
        <h2 className="text-[11px] font-bold uppercase tracking-[0.11em]" style={{ color: t.faint }}>
          Edit profile
        </h2>
        <TextField
          label="Full name"
          tone={tone}
          value={f.name}
          onChange={(e) => set("name", e.target.value)}
          onBlur={() => touch("name")}
          error={errors.name}
          showError={!!touched.name}
          autoComplete="name"
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
          showError={emailTaken || !!touched.email}
          autoComplete="email"
        />
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

        <SubmitButton tone={tone} ready={valid && dirty} busy={busy} busyLabel="Saving…">
          Save changes
        </SubmitButton>
      </form>

      <section className="flex flex-col gap-3" aria-label="Sign-in details">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.11em]" style={{ color: t.faint }}>
          Sign-in details
        </h2>
        <div className={row} style={{ background: t.surface, border: `1px solid ${t.border}` }}>
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[12.5px] font-semibold" style={{ color: t.faint }}>
              Phone number
            </span>
            <span className="font-[family-name:var(--font-mono-x)] text-[15px] font-semibold" data-testid="account-phone">
              {user.phone}
            </span>
            <span className="text-[12px] font-medium" style={{ color: t.muted }}>
              Changing it needs your password and a code sent to the new number.
            </span>
          </div>
          <Link href="/account/phone" className="shrink-0 px-4 py-2.5 rounded-xl text-[13.5px] font-bold" style={{ border: `1px solid ${t.border}`, color: t.accent }}>
            Change phone number
          </Link>
        </div>
        <div className={row} style={{ background: t.surface, border: `1px solid ${t.border}` }}>
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[12.5px] font-semibold" style={{ color: t.faint }}>
              Password
            </span>
            <span className="text-[12px] font-medium" style={{ color: t.muted }}>
              We&apos;ll send a code on WhatsApp. Choosing a new password logs you out everywhere.
            </span>
          </div>
          <Link
            href={`/forgot-password?phone=${encodeURIComponent(user.phone)}`}
            className="shrink-0 px-4 py-2.5 rounded-xl text-[13.5px] font-bold"
            style={{ border: `1px solid ${t.border}`, color: t.accent }}
          >
            Change password
          </Link>
        </div>
      </section>
    </>
  );
}
