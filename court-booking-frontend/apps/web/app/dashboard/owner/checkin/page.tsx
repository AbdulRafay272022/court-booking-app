"use client";

import Link from "next/link";

/** Section 32 Part 9: a hub for the two check-in paths that aren't the direct Check-in button on
 * Today's own booked rows. Live camera scanning is mobile-only (a phone at the entrance is the
 * realistic device for it) -- the web side gets the venue QR to print/display, and a manual
 * booking-code entry as the web equivalent of "scan a player's code". */
export default function OwnerCheckinHubPage() {
  return (
    <div className="p-8 flex flex-col gap-4 max-w-xl">
      <h1 className="text-2xl font-bold">Check-in tools</h1>

      <Link
        href="/dashboard/owner/checkin/qr"
        className="bg-owner-surface border border-owner-border rounded-xl p-4 flex items-center gap-3.5 hover:border-owner-accent"
      >
        <div className="flex-1">
          <p className="font-semibold text-[15px]">Show venue QR code</p>
          <p className="text-owner-ink-faint text-[13px]">
            Print or display this at your entrance -- players scan it to check themselves in.
          </p>
        </div>
        <span className="text-owner-ink-faint">&rarr;</span>
      </Link>

      <Link
        href="/dashboard/owner/checkin/manual"
        className="bg-owner-surface border border-owner-border rounded-xl p-4 flex items-center gap-3.5 hover:border-owner-accent"
      >
        <div className="flex-1">
          <p className="font-semibold text-[15px]">Check in with a booking code</p>
          <p className="text-owner-ink-faint text-[13px]">
            Enter the booking code a player shows you -- the same as tapping Check in on Today.
          </p>
        </div>
        <span className="text-owner-ink-faint">&rarr;</span>
      </Link>

      <p className="text-owner-ink-faint text-[12.5px] px-1">
        Most check-ins are faster from Today: click Check in on a player's row directly. Live
        camera scanning is available on the Maidan mobile app.
      </p>
    </div>
  );
}
