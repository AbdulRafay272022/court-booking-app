import { create } from "zustand";

/**
 * Short-lived, IN-MEMORY hand-off between the auth screens (never persisted).
 *
 * `password`: when a login is refused with PHONE_REVERIFICATION_REQUIRED the user is sent
 * to the OTP screen; once they pass it, the login is retried with the password they already
 * typed instead of making them type it again. It lives only in this store, only until that
 * retry (or an error), and is wiped on a page reload -- if it's gone the user simply logs in
 * again.
 */
interface PendingAuthState {
  password: string | null;
  setPassword: (p: string | null) => void;
}

export const usePendingAuth = create<PendingAuthState>((set) => ({
  password: null,
  setPassword: (password) => set({ password }),
}));

/* ---- OTP expiry, kept in sessionStorage so the countdown survives a reload of the OTP page. */

const otpKey = (purpose: string, phone: string) => `maidan.otp_expires_at.${purpose}.${phone}`;

/** Remember when the code we just asked for stops working (from the backend's `expires_in`). */
export function rememberOtpExpiry(purpose: string, phone: string, expiresInSeconds: number): void {
  try {
    window.sessionStorage.setItem(otpKey(purpose, phone), String(Date.now() + expiresInSeconds * 1000));
  } catch {
    // sessionStorage unavailable: the page falls back to "no countdown" rather than a wrong one.
  }
}

/** Epoch ms when the current code expires, or null if unknown (e.g. storage cleared). */
export function recallOtpExpiry(purpose: string, phone: string): number | null {
  try {
    const raw = window.sessionStorage.getItem(otpKey(purpose, phone));
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}
