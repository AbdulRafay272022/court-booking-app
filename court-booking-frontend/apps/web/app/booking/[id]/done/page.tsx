"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR, formatTimeRange } from "@/lib/format";

export default function DonePage({ params }: PageProps<"/booking/[id]/done">) {
  const { id } = use(params);
  const router = useRouter();
  const bookingQuery = useQuery({ queryKey: ["booking", id], queryFn: () => api.bookings.get(id) });
  const courtQuery = useQuery({
    queryKey: ["court", bookingQuery.data?.court_id],
    queryFn: () => api.courts.get(bookingQuery.data!.court_id),
    enabled: !!bookingQuery.data?.court_id,
  });
  const venueQuery = useQuery({
    queryKey: ["venue", courtQuery.data?.venue_id],
    queryFn: () => api.venues.get(courtQuery.data!.venue_id),
    enabled: !!courtQuery.data?.venue_id,
  });
  const booking = bookingQuery.data;

  if (!booking && bookingQuery.isError) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-3 px-8 text-center text-white" style={{ background: "#0F2D22" }}>
        <p className="font-bold">Couldn't load your booking</p>
        <p className="text-sm" style={{ color: "#9BC4B1" }}>{friendlyErrorMessage(bookingQuery.error)}</p>
        <button onClick={() => bookingQuery.refetch()} className="px-4 h-11 rounded-xl bg-white text-player-ink font-semibold text-[13.5px] mt-1">
          Try again
        </button>
      </main>
    );
  }

  if (!booking) {
    return (
      <main className="min-h-screen flex items-center justify-center text-white" style={{ background: "#0F2D22" }}>
        Loading…
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col items-center px-6 pt-16 gap-6" style={{ background: "#0F2D22" }}>
      <div className="w-16 h-16 rounded-full flex items-center justify-center text-3xl text-white" style={{ background: "#1F7A52" }}>
        ✓
      </div>
      <div className="flex flex-col items-center gap-1.5 text-center">
        <h1 className="text-3xl font-extrabold text-white tracking-tight">Court is yours</h1>
        <p className="text-[14.5px]" style={{ color: "#9BC4B1" }}>
          Confirmed by the venue
        </p>
      </div>

      <div className="w-full max-w-md bg-white rounded-3xl p-7 flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <span className="font-bold text-[19px]">
            {venueQuery.data?.name ?? "Venue"} · {courtQuery.data?.name ?? "Court"}
          </span>
          <span className="text-player-ink-faint text-sm">{venueQuery.data ? venueQuery.data.area ?? venueQuery.data.city : ""}</span>
        </div>
        <div className="grid grid-cols-3">
          <Stat label="TIME" value={formatTimeRange(booking.starts_at, booking.ends_at)} />
          <Stat label="PAID" value={formatPKR(booking.amount_paid)} />
          <Stat label="AT VENUE" value={formatPKR(booking.balance_due)} accent />
        </div>
      </div>

      <button onClick={() => router.push("/bookings")} className="w-full max-w-md h-13 rounded-2xl bg-white font-bold" style={{ height: 52 }}>
        Done
      </button>
    </main>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10.5px] font-bold tracking-widest text-player-ink-fainter">{label}</span>
      <span className="font-mono text-[15px] font-semibold" style={{ color: accent ? "#B5730B" : "#141A1D" }}>
        {value}
      </span>
    </div>
  );
}
