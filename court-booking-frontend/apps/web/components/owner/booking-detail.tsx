"use client";

/** STUB owned by agent C (History + detail popup): the ONE booking detail popup used by Overview, History, Approvals and Refunds.
 * Props are the contract other agents code against; agent C replaces the body, never the props. */
export interface BookingDetailProps {
  /** Null = closed. */
  bookingId: string | null;
  onClose: () => void;
  /** Called after a successful change made inside the popup (completion) so the caller can refetch. */
  onChanged?: () => void;
}

export function BookingDetail({ bookingId, onClose }: BookingDetailProps) {
  if (!bookingId) return null;
  return (
    <div role="dialog" aria-modal="true">
      <button type="button" onClick={onClose}>x</button>
      {bookingId}
    </div>
  );
}
