import type { ChatHistoryItem, ChatMessageInput, ChatMessageOut } from "@court-booking/types";
import type { ApiClient } from "./client";

export function createChatApi(client: ApiClient) {
  return {
    send: (input: ChatMessageInput) =>
      client.request<ChatMessageOut>("/chat/message", {
        method: "POST",
        body: JSON.stringify(input),
      }),

    history: (params: { venue_id?: string; booking_id?: string; page?: number; page_size?: number } = {}) => {
      const usp = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined) usp.set(k, String(v));
      }
      const qs = usp.toString();
      return client.request<ChatHistoryItem[]>(`/chat/history${qs ? `?${qs}` : ""}`);
    },
  };
}
