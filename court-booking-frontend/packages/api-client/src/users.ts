import type { NotificationLogEntry } from "@court-booking/types";
import type { ApiClient } from "./client";

export function createUsersApi(client: ApiClient) {
  return {
    registerFcmToken: (token: string, platform: "android" | "ios" | "web") =>
      client.request<void>("/users/me/fcm-token", {
        method: "POST",
        body: JSON.stringify({ token, platform }),
      }),

    deleteFcmToken: (token: string) =>
      client.request<void>(`/users/me/fcm-token/${token}`, { method: "DELETE" }),

    notifications: (page = 1, pageSize = 20) =>
      client.request<NotificationLogEntry[]>(`/users/me/notifications?page=${page}&page_size=${pageSize}`),
  };
}
