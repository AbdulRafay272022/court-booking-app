import type { NotificationLogEntry, User } from "@court-booking/types";
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

    // Same shape as venues.uploadPhoto: native passes a `uri` string, web passes a real
    // File/Blob. Backend expects the field name `file` (multipart), 5 MB max, JPEG/PNG/WebP.
    // Returns the updated User (with the new avatar_url), so the auth store can be updated
    // in place without a second /auth/me round-trip.
    uploadAvatar: (file: string | Blob, fileName = "avatar.jpg", mimeType = "image/jpeg") => {
      const formData = new FormData();
      if (typeof file === "string") {
        formData.append("file", { uri: file, name: fileName, type: mimeType } as unknown as Blob);
      } else {
        formData.append("file", file, fileName);
      }
      return client.request<User>("/users/me/avatar", { method: "POST", body: formData });
    },
  };
}
