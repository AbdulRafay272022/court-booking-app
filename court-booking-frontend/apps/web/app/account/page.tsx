"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CITY_OPTIONS, GENDER_OPTIONS, validateProfile, type City, type Gender } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatShortDate, formatTime } from "@/lib/format";
import { ChoicePills, FormMessage, SelectField, TextField } from "@/components/auth/fields";
import { SubmitButton } from "@/components/auth/submit-button";
import { TONES } from "@/components/auth/tone";

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const AVATAR_ACCEPT = "image/jpeg,image/png,image/webp";

/** Edit profile (both roles): name, email, city, gender. Phone and password are deliberately NOT
 * inputs here -- phone has its own OTP-verified flow, and the password goes through forgot-password
 * (one password-change path, not a second one asking for the old password). */
export default function AccountPage() {
  const user = useAuthStore((s) => s.user)!;
  const tone = user.role === "owner" || user.role === "admin" ? "owner" : "player";
  const t = TONES[tone];
  const queryClient = useQueryClient();

  // Section 29 Tier 2 Part 4: mobile's player profile tab has had a "My Waitlist" section for a
  // while -- web had no waitlist UI anywhere. Player-only (owners don't join waitlists).
  const waitlistQuery = useQuery({
    queryKey: ["waitlist-mine"],
    queryFn: () => api.waitlist.mine(),
    enabled: user.role === "player",
  });
  const activeEntries = (waitlistQuery.data ?? []).filter((e) => e.is_active);

  async function leaveWaitlist(entryId: string) {
    try {
      await api.waitlist.leave(entryId);
      await queryClient.invalidateQueries({ queryKey: ["waitlist-mine"] });
    } catch (e) {
      alert(`Couldn't leave the waitlist: ${friendlyErrorMessage(e)}`);
    }
  }

  const [f, setF] = useState({ name: user.name ?? "", email: user.email ?? "", city: user.city ?? "", gender: user.gender ?? "" });
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailTaken, setEmailTaken] = useState(false);

  // Avatar upload (QA signup-venue round item 7). Preview is a local blob URL so the user
  // sees the picked file before the upload finishes; on success we swap to the real S3 URL
  // the backend returns and revoke the blob. Any error during pick or upload sets avatarError.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  async function handleAvatarPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be re-picked after an error
    if (!file) return;
    setAvatarError(null);
    if (!AVATAR_ACCEPT.split(",").includes(file.type)) {
      setAvatarError("Pick a JPEG, PNG or WebP image.");
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setAvatarError("That image is over 5 MB.");
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setAvatarPreview(objectUrl);
    setAvatarUploading(true);
    try {
      const updated = await api.users.uploadAvatar(file, file.name, file.type);
      useAuthStore.getState().setUser(updated, useAuthStore.getState().session ?? undefined);
    } catch (err) {
      setAvatarError(friendlyErrorMessage(err));
      setAvatarPreview(null); // fall back to whatever avatar_url was
    } finally {
      URL.revokeObjectURL(objectUrl);
      setAvatarUploading(false);
    }
  }

  const displayedAvatarUrl = avatarPreview ?? user.avatar_url ?? null;
  const avatarInitial = (user.name ?? user.phone ?? "?").trim().charAt(0).toUpperCase();

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

      {user.role === "player" && activeEntries.length > 0 ? (
        <section className="flex flex-col gap-3" aria-label="My Waitlist">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.11em]" style={{ color: t.faint }}>
            My waitlist
          </h2>
          {activeEntries.map((entry) => (
            <div key={entry.id} className={row} style={{ background: t.surface, border: `1px solid ${t.border}` }}>
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-[14.5px] font-semibold">{entry.venue_name} · {entry.court_name}</span>
                <span className="text-[12px] font-medium" style={{ color: t.muted }}>
                  {formatShortDate(entry.slot_starts_at)} · {formatTime(entry.slot_starts_at)} · #{entry.position} in line
                </span>
              </div>
              <button onClick={() => leaveWaitlist(entry.id)} className="shrink-0 text-[13px] font-bold text-player-danger">
                Leave
              </button>
            </div>
          ))}
        </section>
      ) : null}

      <section
        className="flex items-center gap-5 rounded-3xl p-6"
        style={{ background: t.surface, border: `1px solid ${t.border}` }}
      >
        {/* Avatar circle: shows the current avatar_url (or preview during an in-flight upload),
            falls back to the first letter of the user's name on a tinted circle. */}
        {displayedAvatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={displayedAvatarUrl}
            alt="Your avatar"
            width={72}
            height={72}
            className="w-[72px] h-[72px] rounded-full object-cover"
            style={{ border: `1px solid ${t.border}` }}
          />
        ) : (
          <div
            aria-hidden
            className="w-[72px] h-[72px] rounded-full flex items-center justify-center text-[26px] font-extrabold"
            style={{ background: t.accentSoft, color: t.accent, border: `1px solid ${t.border}` }}
          >
            {avatarInitial}
          </div>
        )}
        <div className="flex flex-col gap-1.5 flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={avatarUploading}
              className="h-10 px-4 rounded-full text-[13.5px] font-bold border transition-colors disabled:opacity-60"
              style={{ background: t.surface, borderColor: t.border, color: t.ink }}
            >
              {avatarUploading ? "Uploading…" : displayedAvatarUrl ? "Change photo" : "Add a photo"}
            </button>
            <span className="text-[12px] font-medium" style={{ color: t.faint }}>
              JPEG, PNG or WebP · up to 5 MB
            </span>
          </div>
          {avatarError ? (
            <FormMessage kind="error" tone={tone}>
              {avatarError}
            </FormMessage>
          ) : null}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={AVATAR_ACCEPT}
          onChange={handleAvatarPick}
          className="hidden"
        />
      </section>

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
