"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { selfCheckinWindow } from "@court-booking/types";
import { useRequireAuth } from "@/lib/use-require-auth";
import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatTime, formatWhen } from "@/lib/format";

/** Section 32 Part 9: show this booking's own QR (its plain booking id) for the OWNER to scan, and
 * a manual venue-code field as the web equivalent of "scan the venue's QR" (no camera on web -- see
 * the owner check-in hub for the same scope decision), gated to the same ~15-minute window as
 * mobile via packages/types' selfCheckinWindow. */
function CheckinPageInner({ params }: PageProps<"/booking/[id]/checkin">) {
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const bookingQuery = useQuery({ queryKey: ["booking", id], queryFn: () => api.bookings.get(id) });
  const [manualToken, setManualToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const booking = bookingQuery.data;

  if (!booking) {
    return (
      <main className="min-h-screen flex items-center justify-center text-player-ink-faint">
        {bookingQuery.isError ? friendlyErrorMessage(bookingQuery.error) : "Loading…"}
      </main>
    );
  }

  async function submitSelfCheckin() {
    if (!manualToken.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.bookings.checkinSelf(id, manualToken.trim());
      queryClient.invalidateQueries({ queryKey: ["booking", id] });
      queryClient.invalidateQueries({ queryKey: ["bookings-mine"] });
    } catch (e) {
      setError(friendlyErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  }

  if (booking.checked_in_at) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4 px-8 text-center">
        <div className="w-16 h-16 rounded-full flex items-center justify-center text-3xl text-white" style={{ background: "#1F7A52" }}>
          ✓
        </div>
        <h1 className="font-extrabold text-lg">You're checked in</h1>
        <p className="text-player-ink-faint text-[13.5px]">{formatWhen(booking.checked_in_at)}</p>
        <button onClick={() => router.push("/bookings")} className="px-4 py-2.5 rounded-xl font-semibold text-[13.5px]" style={{ background: "#F4EFEC" }}>
          Back to your bookings
        </button>
      </main>
    );
  }

  const window = selfCheckinWindow(booking.starts_at);

  return (
    <main className="max-w-md mx-auto px-6 py-10 flex flex-col gap-8">
      <h1 className="text-2xl font-extrabold tracking-tight">Check in</h1>

      <div className="bg-player-surface border border-player-border-light rounded-2xl p-6 flex flex-col items-center gap-4">
        <p className="font-bold text-[15px]">Show this to venue staff</p>
        <div className="p-4 bg-white rounded-xl border border-player-border-light">
          <QRCodeSVG value={booking.id} size={180} />
        </div>
        <p className="text-player-ink-faint text-[12.5px] text-center">
          {formatTime(booking.starts_at)} today -- the owner can scan this to check you in.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <p className="font-bold text-[15px]">Or enter the venue's code</p>
        {!window.isOpen ? (
          <div className="rounded-xl p-3.5" style={{ background: "#F4EFEC" }}>
            <p className="text-player-ink-faint text-[13px] text-center">{window.message}</p>
          </div>
        ) : null}
        <input
          value={manualToken}
          onChange={(e) => setManualToken(e.target.value)}
          placeholder="Code posted at the venue"
          disabled={!window.isOpen}
          className="border border-player-border-light rounded-xl px-4 py-3 font-mono text-sm disabled:opacity-50"
        />
        {error ? <p className="text-[13px] font-semibold" style={{ color: "#A8432C" }}>{error}</p> : null}
        <button
          onClick={submitSelfCheckin}
          disabled={!window.isOpen || !manualToken.trim() || submitting}
          className="px-4 py-3 rounded-xl font-bold text-white text-[14.5px] disabled:opacity-50"
          style={{ background: "#EF5A2C" }}
        >
          {submitting ? "Checking in…" : "Check in"}
        </button>
      </div>
    </main>
  );
}

export default function CheckinPage(props: PageProps<"/booking/[id]/checkin">) {
  const { ready } = useRequireAuth();
  if (!ready) return null;
  return <CheckinPageInner {...props} />;
}
