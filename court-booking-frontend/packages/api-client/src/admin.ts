import type {
  StaffActivity,
  AdminIdentityFull,
  AdminIdentityPage,
  AdminOwnerInvoice,
  BillingSummary,
  OwnerBillingDetail,
  OwnerBillingRow,
  AdminOwnerPayment,
  RecordablePaymentMethod,
  PremiumFeature,
  PremiumFeatureUpdate,
  AdminBooking,
  AdminOverview,
  AdminDashboard,
  AdminUser,
  Dispute,
  PlatformStats,
  Review,
  Venue,
} from "@court-booking/types";
import type { ApiClient } from "./client";
import { toQuery } from "./util";

export function createAdminApi(client: ApiClient) {
  return {
    /** Stage 2 CNIC review. The full view writes an audit row on every call. */
    ownerIdentities: (filter: "missing" | "duplicates" | "unverified" | "all" = "all", page = 1) =>
      client.request<AdminIdentityPage>(`/admin/owner-identities${toQuery({ filter, page })}`),
    ownerIdentity: (userId: string) => client.request<AdminIdentityFull>(`/admin/owner-identities/${userId}`),
    verifyOwnerIdentity: (userId: string) =>
      client.request<AdminIdentityFull>(`/admin/owner-identities/${userId}/verify`, { method: "POST" }),

    /** audit 2026-10-28 Phase 2 item 1: "Not approve" with a required reason (the owner is told and can upload again). */
    rejectOwnerIdentity: (userId: string, reason: string) =>
      client.request<AdminIdentityFull>(`/admin/owner-identities/${userId}/reject`, { method: "POST", body: JSON.stringify({ reason }) }),

    stats: () => client.request<PlatformStats>("/admin/stats"),

    overview: () => client.request<AdminOverview>("/admin/overview"),

    /** Audit 2026-10-28 item 16: the staff dashboard for any venue. */
    staffActivity: (venueId: string, dateFrom?: string, dateTo?: string) =>
      client.request<StaffActivity>(
        `/admin/staff-activity?${new URLSearchParams({ venue_id: venueId, ...(dateFrom ? { date_from: dateFrom } : {}), ...(dateTo ? { date_to: dateTo } : {}) }).toString()}`,
      ),

    /** Owner premium billing price list. */
    premiumFeatures: () => client.request<PremiumFeature[]>("/admin/premium-features"),
    /** Owner premium payments by status ("submitted" is the review queue) and invoices waiting for payment. */
    ownerPayments: (status: "submitted" | "approved" | "rejected" | "reversal" = "submitted") =>
      client.request<AdminOwnerPayment[]>(`/admin/owner-payments?status=${status}`),
    approveOwnerPayment: (id: string) => client.request<AdminOwnerPayment>(`/admin/owner-payments/${id}/approve`, { method: "POST" }),
    rejectOwnerPayment: (id: string, reason: string) =>
      client.request<AdminOwnerPayment>(`/admin/owner-payments/${id}/reject`, { method: "POST", body: JSON.stringify({ reason }) }),
    reverseOwnerPayment: (id: string, reason: string) =>
      client.request<AdminOwnerPayment>(`/admin/owner-payments/${id}/reverse`, { method: "POST", body: JSON.stringify({ reason }) }),
    ownerInvoices: (status: AdminOwnerInvoice["status"] = "issued") =>
      client.request<AdminOwnerInvoice[]>(`/admin/owner-invoices?status=${status}`),
    recordOwnerPayment: (invoiceId: string, method: RecordablePaymentMethod, note?: string) =>
      client.request<AdminOwnerPayment>(`/admin/owner-invoices/${invoiceId}/record-payment`, {
        method: "POST",
        body: JSON.stringify({ method, note: note || null }),
      }),
    /** Revenue dashboard and per-owner billing (read-only). */
    billingSummary: () => client.request<BillingSummary>("/admin/owner-billing/summary"),
    billingOwners: (search?: string) =>
      client.request<OwnerBillingRow[]>(`/admin/owner-billing/owners${search ? `?search=${encodeURIComponent(search)}` : ""}`),
    billingOwner: (ownerId: string) => client.request<OwnerBillingDetail>(`/admin/owner-billing/owners/${ownerId}`),
    updatePremiumFeature: (key: string, body: PremiumFeatureUpdate) =>
      client.request<PremiumFeature>(`/admin/premium-features/${key}`, { method: "PATCH", body: JSON.stringify(body) }),

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

    // Section 32 Part 6 -- admin moderation of reviews.
    hideReview: (reviewId: string) =>
      client.request<Review>(`/admin/reviews/${reviewId}/hide`, { method: "POST" }),

    unhideReview: (reviewId: string) =>
      client.request<Review>(`/admin/reviews/${reviewId}/unhide`, { method: "POST" }),
  };
}
