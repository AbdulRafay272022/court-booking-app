export type ChatActionType = "confirm_booking" | "decline";

export interface ChatAction {
  type: ChatActionType;
  label: string;
  data: Record<string, unknown>;
}

/** The text on an action button. The Yes button names the exact slot the assistant proposed ("Yes, book 7:00 PM to 8:00 PM,
 * Wed 23 Sep"), so a player never confirms a time they have not seen. */
export function chatActionLabel(action: ChatAction): string {
  const slot = action.data?.label;
  return action.type === "confirm_booking" && typeof slot === "string" && slot ? `Yes, book ${slot}` : action.label;
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
