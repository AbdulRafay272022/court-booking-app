import type {
  Blackout,
  Court,
  CreateCourtInput,
  PricingRule,
  PricingRuleInput,
  ScheduleTemplate,
  ScheduleTemplateInput,
} from "@court-booking/types";
import type { ApiClient } from "./client";

export function createCourtsApi(client: ApiClient) {
  return {
    create: (venueId: string, input: CreateCourtInput) =>
      client.request<{ court: Court }>(`/venues/${venueId}/courts`, {
        method: "POST",
        body: JSON.stringify(input),
      }),

    listForVenue: (venueId: string) => client.request<Court[]>(`/venues/${venueId}/courts`),

    get: (courtId: string) => client.request<Court>(`/courts/${courtId}`),

    update: (courtId: string, input: Partial<CreateCourtInput>) =>
      client.request<Court>(`/courts/${courtId}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),

    deactivate: (courtId: string) => client.request<void>(`/courts/${courtId}`, { method: "DELETE" }),

    setSchedule: (courtId: string, schedules: ScheduleTemplateInput[]) =>
      client.request<ScheduleTemplate[]>(`/courts/${courtId}/schedule`, {
        method: "POST",
        body: JSON.stringify({ schedules }),
      }),

    setPricing: (courtId: string, rules: PricingRuleInput[]) =>
      client.request<PricingRule[]>(`/courts/${courtId}/pricing`, {
        method: "POST",
        body: JSON.stringify({ rules }),
      }),

    addBlackout: (
      courtId: string,
      input: { title?: string; starts_at: string; ends_at: string; reason?: string },
    ) =>
      client.request<Blackout>(`/courts/${courtId}/blackouts`, {
        method: "POST",
        body: JSON.stringify(input),
      }),

    listBlackouts: (courtId: string) => client.request<Blackout[]>(`/courts/${courtId}/blackouts`),
  };
}

/** The cancellation policy is per VENUE now (Section 32 Part 4); this stays exported here so existing screens keep
 * importing it. A Court still carries a read-only mirror of its venue's policy, so either works. */
export { cancellationPolicyText } from "@court-booking/types";
