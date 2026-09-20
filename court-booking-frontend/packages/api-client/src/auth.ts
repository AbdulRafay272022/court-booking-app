import type {
  City,
  Gender,
  MeOut,
  RefreshResponse,
  SignupRole,
  TokenResponse,
  User,
} from "@court-booking/types";
import type { ApiClient } from "./client";

export interface RequestOtpOut {
  message: string;
  expires_in: number;
}

export interface SignupInput {
  name: string;
  email: string;
  phone: string;
  city: City;
  gender: Gender;
  password: string;
  confirm_password: string;
  role: SignupRole;
}

export interface SignupOut {
  message: string;
  phone: string;
  expires_in: number;
}

export interface DeviceInfo {
  device_id?: string;
  device_name?: string;
  platform?: "android" | "ios" | "web";
}

export interface VerifySignupOtpInput extends DeviceInfo {
  phone: string;
  otp: string;
}

export interface LoginInput extends DeviceInfo {
  phone: string;
  password: string;
}

export interface UpdateProfileInput {
  name?: string;
  email?: string;
  city?: City;
  gender?: Gender;
  avatar_url?: string;
}

export interface PhoneChangeOut {
  message: string;
  phone: string;
  /** Always true: the backend ended every session, this one included. */
  sign_in_again: boolean;
}

export interface PasswordResetInput {
  phone: string;
  otp: string;
  new_password: string;
  confirm_password: string;
}

/** The unauthenticated auth endpoints never send a stored token and never trigger a
 * refresh/sign-out on a 401 (`skipAuth`): a wrong password is a normal 401, not an
 * expired session. */
const PUBLIC = { skipAuth: true } as const;

function post<T>(client: ApiClient, path: string, body: unknown) {
  return client.request<T>(path, { method: "POST", body: JSON.stringify(body) }, PUBLIC);
}

export function createAuthApi(client: ApiClient) {
  return {
    /** Creates an unverified account and sends the verification OTP. */
    signup: (input: SignupInput) => post<SignupOut>(client, "/auth/signup", input),

    /** Completes a pending signup: proves phone ownership and returns the first session. */
    verifySignupOtp: (input: VerifySignupOtpInput) =>
      post<TokenResponse>(client, "/auth/verify-signup-otp", input),

    /** Password login. Errors worth handling specially: PHONE_REVERIFICATION_REQUIRED
     * (route to OTP), PASSWORD_NOT_SET (route to the reset flow), LOGIN_RATE_LIMITED. */
    login: (input: LoginInput) => post<TokenResponse>(client, "/auth/login", input),

    /** Sends a re-verification OTP; also "resend code" for an unfinished signup.
     * Answers 200 whether or not the phone has an account. */
    requestOtp: (input: { phone: string }) => post<RequestOtpOut>(client, "/auth/request-otp", input),

    /** Proves phone possession again. Does NOT log in -- follow with `login`. */
    reverifyPhone: (input: { phone: string; otp: string }) =>
      post<{ message: string }>(client, "/auth/reverify-phone", input),

    requestPasswordReset: (input: { phone: string }) =>
      post<RequestOtpOut>(client, "/auth/request-password-reset", input),

    /** Sets the new password and ends every session for the account. Does NOT log in. */
    verifyPasswordReset: (input: PasswordResetInput) =>
      post<{ message: string }>(client, "/auth/verify-password-reset", input),

    /** Rotates the session into a fresh 8h window. Prefer `client.refreshSession()`. */
    refresh: () => client.request<RefreshResponse>("/auth/refresh", { method: "POST" }),

    logout: () => client.request<{ message: string }>("/auth/logout", { method: "POST" }),

    me: () => client.request<MeOut>("/auth/me"),

    /** name / email (unique) / city / gender. NOT phone or password -- see the two calls below. */
    updateMe: (input: UpdateProfileInput) =>
      client.request<User>("/auth/me", {
        method: "PATCH",
        body: JSON.stringify(input),
      }),

    /** Step 1 of a phone change (authenticated): re-authenticates with the CURRENT password and
     * sends a code to the NEW number. Nothing changes until `verifyPhoneChange` succeeds. A wrong
     * password is a 403 INVALID_CREDENTIALS (not 401), so it doesn't look like an expired session. */
    requestPhoneChange: (input: { new_phone: string; password: string }) =>
      client.request<RequestOtpOut>("/auth/request-phone-change", {
        method: "POST",
        body: JSON.stringify(input),
      }),

    /** Step 2: moves the account to the new number and ENDS EVERY SESSION (this one too) -- the
     * caller must sign out locally and send the user to log in with the new number. */
    verifyPhoneChange: (input: { new_phone: string; otp: string }) =>
      client.request<PhoneChangeOut>("/auth/verify-phone-change", {
        method: "POST",
        body: JSON.stringify(input),
      }),
  };
}
