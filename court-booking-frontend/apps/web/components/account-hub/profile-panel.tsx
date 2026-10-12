"use client";

import { useId, useRef, useState } from "react";
import { CITY_OPTIONS, GENDER_OPTIONS, validateProfile, type City, type Gender } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useT } from "@/components/i18n/lang-provider";
import { FieldError, FormNotice, SmartButton, TextField } from "@/components/auth-v2/fields";
import { Avatar, Card } from "./parts";

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const AVATAR_ACCEPT = "image/jpeg,image/png,image/webp";

const SELECT =
  "khelo-input w-full rounded-[14px] border-[1.5px] bg-white px-[18px] py-[15px] text-[16px] text-khelo-ink";

/** Edit profile (both roles): photo, name, email, city, gender. Phone and password are deliberately NOT inputs here: phone has its
 * own OTP-verified flow (Settings > Sign-in details), and the password goes through forgot-password (one password-change path). */
export function ProfilePanel() {
  const t = useT();
  const user = useAuthStore((s) => s.user)!;
  const theme = user.role === "owner" || user.role === "admin" ? "owner" : "player";
  const cityId = useId();

  const [f, setF] = useState({ name: user.name ?? "", email: user.email ?? "", city: user.city ?? "", gender: user.gender ?? "" });
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailTaken, setEmailTaken] = useState(false);

  // Avatar upload (QA signup-venue round item 7). Preview is a local blob URL so the user sees the picked file before the upload
  // finishes; on success we swap to the real S3 URL the backend returns and revoke the blob. Any error sets avatarError.
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
      setAvatarError(t("account.avatar.badType"));
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setAvatarError(t("account.avatar.tooBig"));
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

  // The shared validator decides WHICH fields are wrong; the wording shown comes from the translated messages.
  const rawErrors = validateProfile(f);
  const errors = {
    name: rawErrors.name ? t("account.profile.err.name") : undefined,
    email: rawErrors.email ? t("account.profile.err.email") : undefined,
    city: rawErrors.city ? t("account.profile.err.city") : undefined,
    gender: rawErrors.gender ? t("account.profile.err.gender") : undefined,
  };
  const valid = Object.keys(rawErrors).length === 0;
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

  const cityInvalid = !!(touched.city && errors.city);
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <div className="flex items-center gap-5">
          <Avatar url={displayedAvatarUrl} name={user.name ?? user.phone} size={72} alt={t("account.avatar.alt")} />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={avatarUploading}
                className="khelo-btn inline-flex min-h-11 cursor-pointer items-center rounded-full border-[1.5px] border-khelo-ink px-5 text-[14px] font-bold text-khelo-ink disabled:opacity-60"
              >
                {avatarUploading ? t("account.avatar.uploading") : displayedAvatarUrl ? t("account.avatar.change") : t("account.avatar.add")}
              </button>
              <span className="text-[13px] text-khelo-muted">{t("account.avatar.hint")}</span>
            </div>
            <div aria-live="polite">{avatarError ? <FormNotice kind="error">{avatarError}</FormNotice> : null}</div>
          </div>
          <input ref={fileInputRef} type="file" accept={AVATAR_ACCEPT} onChange={handleAvatarPick} className="hidden" aria-label={t("account.avatar.add")} tabIndex={-1} />
        </div>
      </Card>

      <Card>
        <form onSubmit={handleSave} noValidate className="flex flex-col gap-5" aria-labelledby={`${cityId}-h`}>
          <h2 id={`${cityId}-h`} className="font-khelo-display text-[22px] font-extrabold tracking-tight">
            {t("account.profile.title")}
          </h2>
          <TextField
            label={t("account.profile.name")}
            value={f.name}
            onChange={(e) => set("name", e.target.value)}
            onBlur={() => touch("name")}
            error={errors.name}
            showError={!!touched.name}
            autoComplete="name"
          />
          <TextField
            label={t("account.profile.email")}
            type="email"
            inputMode="email"
            value={f.email}
            onChange={(e) => set("email", e.target.value)}
            onBlur={() => touch("email")}
            error={emailTaken ? t("account.profile.err.emailTaken") : errors.email}
            showError={emailTaken || !!touched.email}
            autoComplete="email"
          />
          <div className="flex flex-col gap-2">
            <label htmlFor={`${cityId}-city`} className="text-[14px] font-bold">
              {t("account.profile.city")}
            </label>
            <select
              id={`${cityId}-city`}
              value={f.city}
              onChange={(e) => {
                set("city", e.target.value);
                touch("city");
              }}
              onBlur={() => touch("city")}
              aria-invalid={cityInvalid}
              aria-describedby={cityInvalid ? `${cityId}-city-err` : undefined}
              className={`${SELECT} ${cityInvalid ? "border-khelo-danger" : "border-khelo-border"}`}
            >
              <option value="" disabled>
                {t("account.profile.cityPlaceholder")}
              </option>
              {CITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <FieldError id={`${cityId}-city-err`} message={cityInvalid ? errors.city : null} />
          </div>
          <div className="flex flex-col gap-2">
            <span id={`${cityId}-g`} className="text-[14px] font-bold">
              {t("account.profile.gender")}
            </span>
            <div role="radiogroup" aria-labelledby={`${cityId}-g`} className="flex flex-wrap gap-2">
              {GENDER_OPTIONS.map((o) => {
                const selected = f.gender === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => {
                      set("gender", o.value);
                      touch("gender");
                    }}
                    className={`khelo-btn inline-flex min-h-11 cursor-pointer items-center rounded-full border-[1.5px] px-5 text-[15px] font-bold ${
                      selected ? "border-khelo-ink bg-khelo-ink text-white" : "border-khelo-border bg-white text-khelo-ink"
                    }`}
                  >
                    {t(`account.gender.${o.value}`)}
                  </button>
                );
              })}
            </div>
            <FieldError id={`${cityId}-g-err`} message={touched.gender ? errors.gender : null} />
          </div>

          <div aria-live="polite" className="flex flex-col gap-3">
            {error ? <FormNotice kind="error">{error}</FormNotice> : null}
            {saved ? <FormNotice kind="success">{t("account.profile.saved")}</FormNotice> : null}
          </div>

          <SmartButton ready={valid && dirty} busy={busy} busyLabel={t("account.profile.saving")} theme={theme}>
            {t("account.profile.save")}
          </SmartButton>
        </form>
      </Card>
    </div>
  );
}
