import type { WaitlistEntry, WaitlistJoinInput, WaitlistJoinOut } from "@court-booking/types";
import type { ApiClient } from "./client";

export function createWaitlistApi(client: ApiClient) {
  return {
    join: (input: WaitlistJoinInput) =>
      client.request<WaitlistJoinOut>("/waitlist", {
        method: "POST",
        body: JSON.stringify(input),
      }),

    mine: () => client.request<WaitlistEntry[]>("/waitlist/mine"),

    leave: (entryId: string) =>
      client.request<WaitlistEntry>(`/waitlist/${entryId}`, { method: "DELETE" }),
  };
}
