export type ChatActionType = "confirm_booking" | "decline";

export interface ChatAction {
  type: ChatActionType;
  label: string;
  data: Record<string, unknown>;
}

export interface ChatMessageInput {
  message: string;
  venue_id?: string;
  booking_id?: string;
  channel?: "app";
}

export interface ChatMessageOut {
  reply: string;
  actions: ChatAction[];
}

export interface ChatHistoryItem {
  id: string;
  sender_type: "player" | "ai";
  channel: string;
  content: string;
  created_at: string;
}
