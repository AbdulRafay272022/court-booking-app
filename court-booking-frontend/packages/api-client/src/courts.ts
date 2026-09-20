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

/** Section 29 Part C: plain-language rendering of a court's cancellation policy, shared by
 * both apps so the pre-booking disclosure (pay screen) and the My Bookings cancel button use
 * identical wording for the same three states. */
export function cancellationPolicyText(
  court: Pick<Court, "cancellation_allowed" | "cancellation_cutoff_hours"> | null | undefined,
): string {
  if (!court) return "";
  if (!court.cancellation_allowed) {
    return "This venue does not allow cancellations once booked.";
  }
  if (court.cancellation_cutoff_hours != null) {
    return `Free cancellation up to ${court.cancellation_cutoff_hours}h before your booking.`;
  }
  return "You can cancel any time before your booking starts.";
}
