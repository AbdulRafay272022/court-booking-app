"use client";

import { useQuery } from "@tanstack/react-query";
import { countByGroup, isActiveBooking, nextBooking, statusGroup, type Booking } from "@court-booking/types";
import { api } from "@/lib/api";

// The API caps a page at 100; a player's newest bookings come first on "past", so only the oldest could ever drop off.
export const BOOKINGS_PAGE = 100;

/**
 * The signed-in user's bookings, shared by /bookings and the Account hub so both use the same queries (same keys, same cache)
 * and the same dashboard helpers. Both lists load up front: the stat tiles and the "next up" card need upcoming even while Past is selected.
 */
export function useMyBookings(enabled: boolean) {
  const upcomingQ = useQuery({ queryKey: ["bookings-mine", "upcoming"], queryFn: () => api.bookings.mine("upcoming", 1, BOOKINGS_PAGE), enabled });
  const pastQ = useQuery({ queryKey: ["bookings-mine", "past"], queryFn: () => api.bookings.mine("past", 1, BOOKINGS_PAGE), enabled });
  // The player's own reviews, to show "Rate your game" vs the stars + Edit on each completed booking.
  const reviewsQ = useQuery({ queryKey: ["my-reviews"], queryFn: () => api.reviews.mine(), enabled });
  const reviewByBooking = new Map((reviewsQ.data ?? []).map((r) => [r.booking_id, r]));
  const refetchAll = () => {
    upcomingQ.refetch();
    pastQ.refetch();
    reviewsQ.refetch();
  };

  const upcoming: Booking[] = upcomingQ.data ?? [];
  const past: Booking[] = pastQ.data ?? [];
  const activeUpcoming = upcoming.filter((b) => isActiveBooking(b));
  return {
    upcomingQ,
    pastQ,
    reviewsQ,
    reviewByBooking,
    refetchAll,
    upcoming,
    past,
    next: nextBooking(upcoming),
    activeUpcoming,
    pendingCount: activeUpcoming.filter((b) => statusGroup(b.status) === "pending").length,
    played: countByGroup(past).completed,
  };
}
