import { create } from "zustand";

/**
 * Short-lived, IN-MEMORY hand-off between the auth screens (never persisted).
 *
 * `password`: when a login is refused with PHONE_REVERIFICATION_REQUIRED the user is sent to
 * the OTP screen; once they pass it, the login is retried with the password they already typed
 * instead of making them type it again. Held only until that retry (or an error) and wiped if
 * the app restarts -- then the user simply logs in again.
 *
 * `otpExpiry`: when each requested code stops working (epoch ms, from the backend's
 * `expires_in`), keyed by purpose+phone, so the OTP screens' countdown starts from the real
 * value rather than a hardcoded 300.
 */
interface PendingAuthState {
  password: string | null;
  otpExpiry: Record<string, number>;
  setPassword: (p: string | null) => void;
  rememberOtpExpiry: (purpose: string, phone: string, expiresInSeconds: number) => void;
}

export const usePendingAuth = create<PendingAuthState>((set, get) => ({
  password: null,
  otpExpiry: {},
  setPassword: (password) => set({ password }),
  rememberOtpExpiry: (purpose, phone, expiresInSeconds) =>
    set({ otpExpiry: { ...get().otpExpiry, [`${purpose}.${phone}`]: Date.now() + expiresInSeconds * 1000 } }),
}));

export function recallOtpExpiry(purpose: string, phone: string): number | null {
  return usePendingAuth.getState().otpExpiry[`${purpose}.${phone}`] ?? null;
}
