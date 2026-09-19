import type {
  AdminBooking,
  AdminDashboard,
  AdminUser,
  Dispute,
  PlatformStats,
  Venue,
} from "@court-booking/types";
import type { ApiClient } from "./client";
import { toQuery } from "./util";

export function createAdminApi(client: ApiClient) {
  return {
    stats: () => client.request<PlatformStats>("/admin/stats"),

    dashboard: () => client.request<AdminDashboard>("/admin/dashboard"),

    pendingVenues: () => client.request<Venue[]>("/admin/venues/pending"),

    venues: () => client.request<Venue[]>("/admin/venues"),

    approveVenue: (venueId: string) =>
      client.request<Venue>(`/admin/venues/${venueId}/approve`, { method: "POST" }),

    requestVenueChanges: (venueId: string, reason: string) =>
      client.request<Venue>(`/admin/venues/${venueId}/request-changes`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),

    rejectVenue: (venueId: string, reason: string) =>
      client.request<Venue>(`/admin/venues/${venueId}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),

    bookings: (params: Record<string, unknown> = {}) =>
      client.request<AdminBooking[]>(`/admin/bookings${toQuery(params)}`),

    users: (params: { search?: string; flagged?: boolean } = {}) =>
      client.request<AdminUser[]>(`/admin/users${toQuery(params)}`),

    disputes: () => client.request<Dispute[]>("/admin/disputes"),

    suspendUser: (userId: string, reason: string) =>
      client.request<AdminUser>(`/admin/users/${userId}/suspend`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),

    unsuspendUser: (userId: string) =>
      client.request<AdminUser>(`/admin/users/${userId}/unsuspend`, { method: "POST" }),
  };
}
