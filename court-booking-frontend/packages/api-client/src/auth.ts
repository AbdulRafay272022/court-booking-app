import type { MeOut, RefreshResponse, TokenResponse, User } from "@court-booking/types";
import type { ApiClient } from "./client";

export interface RequestOtpInput {
  phone: string;
}

export interface RequestOtpOut {
  message: string;
  expires_in: number;
}

export interface VerifyOtpInput {
  phone: string;
  otp: string;
  device_id?: string;
  device_name?: string;
  platform?: "android" | "ios" | "web";
}

export function createAuthApi(client: ApiClient) {
  return {
    requestOtp: (input: RequestOtpInput) =>
      client.request<RequestOtpOut>("/auth/request-otp", {
        method: "POST",
        body: JSON.stringify(input),
      }),

    verifyOtp: (input: VerifyOtpInput) =>
      client.request<TokenResponse>("/auth/verify-otp", {
        method: "POST",
        body: JSON.stringify(input),
      }),

    refresh: () => client.request<RefreshResponse>("/auth/refresh", { method: "POST" }),

    logout: () => client.request<{ message: string }>("/auth/logout", { method: "POST" }),

    me: () => client.request<MeOut>("/auth/me"),

    updateMe: (input: { name?: string; avatar_url?: string }) =>
      client.request<User>("/auth/me", {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
  };
}
