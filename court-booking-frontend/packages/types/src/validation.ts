import { PASSWORD_MIN_LENGTH } from "./user";

/**
 * Client-side form validation shared by web and mobile, so the "smart submit button"
 * (disabled until every field is actually VALID, not just non-empty) means the same
 * thing on both. The backend re-validates everything; this only decides what the UI
 * lets a user try.
 */

/** Reduces whatever the user typed (`0300 1234567`, `+92 300 1234567`, `3001234567`) to the
 * 10 national digits after +92. May return fewer/more digits if the input is incomplete. */
export function pkNationalDigits(input: string): string {
  let d = input.replace(/\D/g, "");
  if (d.startsWith("92") && d.length > 10) d = d.slice(2);
  if (d.startsWith("0")) d = d.slice(1);
  return d;
}

/** Pakistani mobile numbers: 10 digits after +92, starting with 3 (e.g. 3004408817). */
export function isValidPkMobile(input: string): boolean {
  const d = pkNationalDigits(input);
  return d.length === 10 && d.startsWith("3");
}

export function toE164(input: string): string {
  return `+92${pkNationalDigits(input)}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function isValidEmail(v: string): boolean {
  return EMAIL_RE.test(v.trim());
}

export function isValidOtp(v: string): boolean {
  return /^\d{6}$/.test(v);
}

export function isValidName(v: string): boolean {
  return v.trim().replace(/\s+/g, " ").length >= 2;
}

/** Returns an error message for an invalid password, or null. Length only, on purpose: no
 * complexity rules until the project owner decides on them (see Section 26 notes). */
export function passwordError(v: string): string | null {
  return v.length >= PASSWORD_MIN_LENGTH ? null : `Use at least ${PASSWORD_MIN_LENGTH} characters`;
}

export interface SignupFields {
  name: string;
  email: string;
  phone: string;
  city: string;
  gender: string;
  password: string;
  confirmPassword: string;
}

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

/** Every problem with the signup form right now (empty object = valid). `touched` lets the
 * UI show an error under a field only after the user has been there; the button gate
 * (`Object.keys(errors).length === 0`) doesn't care about touched. */
export function validateSignup(f: SignupFields): FieldErrors<keyof SignupFields> {
  const e: FieldErrors<keyof SignupFields> = {};
  if (!isValidName(f.name)) e.name = "Enter your full name";
  if (!isValidEmail(f.email)) e.email = "Enter a valid email address";
  if (!isValidPkMobile(f.phone)) e.phone = "Enter a valid mobile number, e.g. 300 1234567";
  if (!f.city) e.city = "Choose your city";
  if (!f.gender) e.gender = "Choose an option";
  const pw = passwordError(f.password);
  if (pw) e.password = pw;
  if (!f.confirmPassword) e.confirmPassword = "Confirm your password";
  else if (f.confirmPassword !== f.password) e.confirmPassword = "Passwords don't match";
  return e;
}

export function validateLogin(f: { phone: string; password: string }): FieldErrors<"phone" | "password"> {
  const e: FieldErrors<"phone" | "password"> = {};
  if (!isValidPkMobile(f.phone)) e.phone = "Enter a valid mobile number, e.g. 300 1234567";
  if (!f.password) e.password = "Enter your password";
  return e;
}

export function validateNewPassword(f: {
  password: string;
  confirmPassword: string;
}): FieldErrors<"password" | "confirmPassword"> {
  const e: FieldErrors<"password" | "confirmPassword"> = {};
  const pw = passwordError(f.password);
  if (pw) e.password = pw;
  if (!f.confirmPassword) e.confirmPassword = "Confirm your password";
  else if (f.confirmPassword !== f.password) e.confirmPassword = "Passwords don't match";
  return e;
}

/** `MM:SS` for a countdown; clamps below zero. */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export interface ProfileFields {
  name: string;
  email: string;
  city: string;
  gender: string;
}

/** Edit-profile validation (name/email/city/gender). Phone and password are not fields here. */
export function validateProfile(f: ProfileFields): FieldErrors<keyof ProfileFields> {
  const e: FieldErrors<keyof ProfileFields> = {};
  if (!isValidName(f.name)) e.name = "Enter your full name";
  if (!isValidEmail(f.email)) e.email = "Enter a valid email address";
  if (!f.city) e.city = "Choose your city";
  if (!f.gender) e.gender = "Choose an option";
  return e;
}

/** Phone-change form: the new number plus the CURRENT password (re-authentication). */
export function validatePhoneChange(f: { newPhone: string; password: string }): FieldErrors<"newPhone" | "password"> {
  const e: FieldErrors<"newPhone" | "password"> = {};
  if (!isValidPkMobile(f.newPhone)) e.newPhone = "Enter a valid mobile number, e.g. 300 1234567";
  if (!f.password) e.password = "Enter your current password";
  return e;
}
