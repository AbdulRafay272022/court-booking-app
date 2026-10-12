"use client";

import { useEffect, useId, useRef, useState } from "react";
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
import { useT } from "@/components/i18n/lang-provider";
import { translateErrors } from "@/lib/validation-text";
import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { rememberOtpExpiry } from "@/lib/pending-auth";
import { useRedirectIfSignedIn } from "@/lib/use-auth-helpers";
import { AuthFrame } from "./frame";
import { CountryPrefix, FieldError, FormNotice, PasswordField, SmartButton, TextField } from "./fields";

const EMPTY: SignupFields = { name: "", email: "", phone: "", city: "", gender: "", password: "", confirmPassword: "" };

/** Cities shown as chips, in this order; every other city is reached through "Aur shehar". */
const TOP_CITIES = ["karachi", "lahore", "islamabad"] as const;
const CHIP_LABEL: Record<string, string> = { karachi: "Karachi", lahore: "Lahore", islamabad: "Islamabad" };

const CHIP = "min-h-11 cursor-pointer rounded-full border-[1.5px] px-[18px] py-3 text-[14px] font-bold";

function Chip({ selected, onClick, expanded, children }: { selected: boolean; onClick: () => void; expanded?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-expanded={expanded}
      onClick={onClick}
      className={`${CHIP} ${selected ? "border-khelo-ink bg-khelo-ink text-white" : "border-khelo-border bg-white text-khelo-ink"}`}
    >
      {children}
    </button>
  );
}

/**
 * Signup screen (Khelo design): two steps (number + password, then details), Player / Venue owner toggle where the owner
 * role turns the panel, progress bar and button teal. Same request body, validation, error codes and redirects as the
 * previous page; the only removed input is "Confirm password" (the body still carries confirm_password = password).
 */
export function SignupForm() {
  const t = useT();
  const router = useRouter();
  const search = useSearchParams();
  const next = search.get("next");
  const signedIn = useRedirectIfSignedIn();

  const [role, setRole] = useState<SignupRole>(search.get("role") === "owner" ? "owner" : "player");
  const [step, setStep] = useState<1 | 2>(1);
  const [f, setF] = useState<SignupFields>(EMPTY);
  const [touched, setTouched] = useState<Partial<Record<keyof SignupFields, boolean>>>({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [phoneTaken, setPhoneTaken] = useState(false);
  const [emailTaken, setEmailTaken] = useState(false);
  // QA signup-venue round item 9: acceptance is a real gate, not just a static footer.
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [moreCities, setMoreCities] = useState(false);

  const stepRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);
  const citySelectRef = useRef<HTMLSelectElement>(null);
  const cityId = useId();
  const termsId = useId();

  const owner = role === "owner";
  const theme = owner ? "owner" : "player";

  // The password comparison is no longer user-facing, so confirm mirrors password (the API still receives both).
  const full: SignupFields = { ...f, confirmPassword: f.password };
  const rawErrors = validateSignup(full);
  const errors = translateErrors(t, rawErrors);
  const step1Valid = !rawErrors.phone && !rawErrors.password;
  const step2Valid = !rawErrors.name && !rawErrors.email && !rawErrors.city && !rawErrors.gender && termsAccepted;
  const valid = Object.keys(rawErrors).length === 0 && termsAccepted;

  // Move focus to the first control of the new step (not on the first paint).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    stepRef.current?.querySelector<HTMLElement>("input, button")?.focus();
  }, [step]);

  const set = <K extends keyof SignupFields>(key: K, value: SignupFields[K]) => {
    setF((prev) => ({ ...prev, [key]: value }));
    if (key === "phone") setPhoneTaken(false);
    if (key === "email") setEmailTaken(false);
  };
  const touch = (key: keyof SignupFields) => setTouched((prev) => ({ ...prev, [key]: true }));
  const show = (key: keyof SignupFields) => !!touched[key];

  async function submit() {
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
        confirm_password: f.password,
        role,
        terms_accepted: termsAccepted,
      });
      rememberOtpExpiry("signup", phone, res.expires_in);
      const qs = new URLSearchParams({ purpose: "signup", phone, role });
      if (next) qs.set("next", next);
      router.push(`/verify?${qs.toString()}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === "PHONE_ALREADY_REGISTERED") {
        setPhoneTaken(true);
        setStep(1); // the number lives on step 1
      } else if (err instanceof ApiError && err.code === "EMAIL_ALREADY_IN_USE") setEmailTaken(true);
      else if (err instanceof ApiError && err.code === "SIGNUP_ALREADY_PENDING") {
        // Item E: a signup is already in progress for this number. Do NOT seed a countdown from
        // retry_after and do NOT imply the re-entered details were saved. Route to Verify for the
        // ORIGINAL pending signup with an honest notice.
        const phone = toE164(f.phone);
        const qs = new URLSearchParams({ purpose: "signup", phone, role, pending: "1" });
        if (next) qs.set("next", next);
        router.push(`/verify?${qs.toString()}`);
      } else setFormError(friendlyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function goNext() {
    setTouched((p) => ({ ...p, phone: true, password: true }));
    if (step1Valid) setStep(2);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (step === 1) goNext();
    else void submit();
  }

  if (signedIn) return null;

  const cityIsTop = (TOP_CITIES as readonly string[]).includes(f.city);
  const showCitySelect = moreCities || (f.city !== "" && !cityIsTop);
  const accentBar = owner ? "bg-khelo-teal" : "bg-khelo-orange";
  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : "/login";

  return (
    <AuthFrame
      brandBg={owner ? "teal" : "ink"}
      brandWidth={42}
      brandTitleSize="signup"
      brandTitle={
        owner ? (
          <>
            {t("auth.signup.brand.owner.l1")}
            <br />
            {t("auth.signup.brand.owner.l2")}
          </>
        ) : (
          <>
            {t("auth.signup.brand.player.l1")}
            <br />
            {t("auth.signup.brand.player.l2")}
          </>
        )
      }
      brandText={
        owner
          ? t("auth.signup.brand.owner.text")
          : t("auth.signup.brand.player.text")
      }
    >
      <div className="w-full max-w-[460px]">
        <div role="group" aria-label={t("auth.signup.roleGroup")} className="flex gap-2.5 rounded-full border-[1.5px] border-khelo-divider bg-white p-1.5">
          <button
            type="button"
            aria-pressed={!owner}
            onClick={() => setRole("player")}
            className={`min-h-11 flex-1 cursor-pointer rounded-full px-2.5 py-3.5 text-[15px] font-extrabold ${!owner ? "bg-khelo-ink text-white" : "bg-transparent text-khelo-ink"}`}
          >
            {t("auth.signup.rolePlayer")}
          </button>
          <button
            type="button"
            aria-pressed={owner}
            onClick={() => setRole("owner")}
            className={`min-h-11 flex-1 cursor-pointer rounded-full px-2.5 py-3.5 text-[15px] font-extrabold ${owner ? "bg-khelo-teal text-white" : "bg-transparent text-khelo-ink"}`}
          >
            {t("auth.signup.roleOwner")}
          </button>
        </div>

        <h1 className="m-0 mt-7 font-khelo-display text-[40px] font-extrabold leading-[1.05] tracking-[-1.2px]">
          {owner ? t("auth.signup.title.owner") : t("auth.signup.title.player")}
        </h1>
        <p className="mt-2.5 text-[16px] leading-[1.6] text-khelo-muted">{t("auth.signup.subtitle")}</p>

        <div className="mt-6">
          <div className="flex justify-between text-[13px] font-bold text-khelo-muted">
            <span aria-live="polite">{t("auth.signup.step", { step })}</span>
            <span>{step === 1 ? t("auth.signup.step1") : t("auth.signup.step2")}</span>
          </div>
          <div
            role="progressbar"
            aria-label={t("auth.signup.progress")}
            aria-valuemin={0}
            aria-valuemax={2}
            aria-valuenow={step}
            aria-valuetext={t("auth.signup.step", { step })}
            className="mt-2 h-2 overflow-hidden rounded-full bg-khelo-booked-bg"
          >
            <div className={`h-full rounded-full transition-[width] duration-300 ${accentBar}`} style={{ width: step === 1 ? "50%" : "100%" }} />
          </div>
        </div>

        <form onSubmit={handleSubmit} noValidate className="mt-7 flex flex-col gap-5">
          <div ref={stepRef} className="flex flex-col gap-5">
            {step === 1 ? (
              <>
                <div className="flex flex-col gap-2">
                  <TextField
                    label={t("auth.field.mobile")}
                    type="tel"
                    inputMode="numeric"
                    value={f.phone}
                    onChange={(e) => set("phone", e.target.value.replace(/\D/g, ""))}
                    onBlur={() => touch("phone")}
                    error={phoneTaken ? t("auth.signup.phoneTaken") : errors.phone}
                    showError={phoneTaken || show("phone")}
                    autoComplete="tel-national"
                    placeholder="300 1234567"
                    prefix={<CountryPrefix />}
                  />
                  {phoneTaken ? (
                    <p className="text-[13px] font-medium text-khelo-muted">
                      <Link href="/login" className="font-bold underline">
                        {t("auth.field.logIn")}
                      </Link>{" "}
                      {t("auth.signup.phoneTaken.or")}{" "}
                      <Link href="/forgot-password" className="font-bold underline">
                        {t("auth.signup.phoneTaken.reset")}
                      </Link>
                      .
                    </p>
                  ) : null}
                </div>
                <PasswordField
                  label={t("auth.field.password")}
                  value={f.password}
                  onChange={(e) => set("password", e.target.value)}
                  onBlur={() => touch("password")}
                  error={errors.password}
                  showError={show("password")}
                  autoComplete="new-password"
                  placeholder={t("auth.signup.passwordPlaceholder")}
                />
                <SmartButton type="submit" ready={step1Valid} theme={theme} className="mt-1">
                  {t("auth.signup.next")}
                </SmartButton>
              </>
            ) : (
              <>
                <TextField
                  label={t("auth.signup.name")}
                  value={f.name}
                  onChange={(e) => set("name", e.target.value)}
                  onBlur={() => touch("name")}
                  error={errors.name}
                  showError={show("name")}
                  autoComplete="name"
                  placeholder="Bilal Ahmed"
                />

                <div className="flex flex-col gap-2">
                  <span id={cityId} className="text-[14px] font-bold">
                    {t("auth.signup.city")}
                  </span>
                  <div role="group" aria-labelledby={cityId} className="flex flex-wrap gap-2">
                    {TOP_CITIES.map((c) => (
                      <Chip
                        key={c}
                        selected={f.city === c}
                        onClick={() => {
                          set("city", c);
                          touch("city");
                          setMoreCities(false);
                        }}
                      >
                        {CHIP_LABEL[c]}
                      </Chip>
                    ))}
                    <Chip
                      selected={!cityIsTop && f.city !== ""}
                      expanded={showCitySelect}
                      onClick={() => {
                        const open = !showCitySelect;
                        setMoreCities(open);
                        if (open) setTimeout(() => citySelectRef.current?.focus(), 0);
                      }}
                    >
                      {t("auth.signup.moreCities")}
                    </Chip>
                  </div>
                  {showCitySelect ? (
                    <select
                      ref={citySelectRef}
                      aria-label={t("auth.signup.allCities")}
                      aria-invalid={!!(show("city") && errors.city)}
                      aria-describedby={show("city") && errors.city ? `${cityId}-err` : undefined}
                      value={f.city}
                      onChange={(e) => {
                        set("city", e.target.value);
                        touch("city");
                      }}
                      onBlur={() => touch("city")}
                      className={`khelo-input w-full rounded-[14px] border-[1.5px] bg-white px-[18px] py-[15px] text-[16px] text-khelo-ink ${show("city") && errors.city ? "border-khelo-danger" : "border-khelo-border"}`}
                    >
                      <option value="" disabled>
                        {t("auth.signup.selectCity")}
                      </option>
                      {CITY_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  <FieldError id={`${cityId}-err`} message={show("city") ? errors.city : null} />
                </div>

                <TextField
                  label={t("auth.signup.email")}
                  type="email"
                  inputMode="email"
                  value={f.email}
                  onChange={(e) => set("email", e.target.value)}
                  onBlur={() => touch("email")}
                  error={emailTaken ? t("auth.signup.emailTaken") : errors.email}
                  showError={emailTaken || show("email")}
                  autoComplete="email"
                  placeholder={t("auth.signup.emailPlaceholder")}
                />

                <div className="flex flex-col gap-2">
                  <span id={`${cityId}-g`} className="text-[14px] font-bold">
                    {t("auth.signup.gender")}
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
                          className={`${CHIP} px-5 ${selected ? "border-khelo-ink bg-khelo-ink text-white" : "border-khelo-border bg-white text-khelo-ink"}`}
                        >
                          {o.label}
                        </button>
                      );
                    })}
                  </div>
                  <FieldError id={`${cityId}-g-err`} message={show("gender") ? errors.gender : null} />
                </div>

                {/* QA signup-venue round item 9: a real checkbox that gates the submit and drives terms_accepted. */}
                <label htmlFor={termsId} className="flex items-start gap-3 text-[14px] leading-[1.5] text-khelo-muted">
                  <input
                    id={termsId}
                    type="checkbox"
                    checked={termsAccepted}
                    onChange={(e) => setTermsAccepted(e.target.checked)}
                    className={`m-0 mt-px h-[22px] w-[22px] flex-none ${owner ? "accent-khelo-teal" : "accent-khelo-orange"}`}
                  />
                  <span>
                    {t("auth.signup.terms.pre")}
                    <Link href="/terms" target="_blank" className="font-bold text-khelo-ink underline">
                      {t("auth.signup.terms.terms")}
                    </Link>
                    {t("auth.signup.terms.mid")}
                    <Link href="/privacy" target="_blank" className="font-bold text-khelo-ink underline">
                      {t("auth.signup.terms.privacy")}
                    </Link>
                    {t("auth.signup.terms.post")}
                  </span>
                </label>

                {formError ? <FormNotice kind="error">{formError}</FormNotice> : null}

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="khelo-btn min-h-11 cursor-pointer rounded-[14px] border-[1.5px] border-khelo-ink bg-transparent px-[22px] py-[18px] text-[16px] font-extrabold"
                  >
                    {t("auth.signup.back")}
                  </button>
                  <SmartButton ready={step2Valid && valid} busy={busy} busyLabel={t("auth.signup.busy")} theme={theme} className="flex-1">
                    {t("auth.signup.submit")}
                  </SmartButton>
                </div>
              </>
            )}
          </div>
        </form>

        <p className="mt-[26px] text-center text-[14px] text-khelo-muted">
          {t("auth.signup.haveAccount")}{" "}
          <Link href={loginHref} className="font-extrabold text-khelo-ink underline">
            {t("auth.field.logIn")}
          </Link>
        </p>
      </div>
    </AuthFrame>
  );
}
