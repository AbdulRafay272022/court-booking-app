"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ApiError } from "@court-booking/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR, formatTime, toDateInputValue } from "@/lib/format";
import { pollInterval } from "@/lib/polling";
import type { Court } from "@court-booking/types";

function nextDays(count: number): Date[] {
  const today = new Date();
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    return d;
  });
}

const STATUS_LABEL: Record<string, string> = {
  available: "OPEN",
  held: "Held",
  payment_submitted: "Review",
  booked: "Taken",
  blocked: "Closed",
};

export function VenueScheduleClient({ venueId, venueName, courts }: { venueId: string; venueName: string; courts: Court[] }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const status = useAuthStore((s) => s.status);
  const days = useMemo(() => nextDays(6), []);
  const [dateIdx, setDateIdx] = useState(0);
  const [isFocused, setIsFocused] = useState(true);
  const date = toDateInputValue(days[dateIdx]);

  // Section 29 Tier 2 Part 4: mobile has had "Notify me" on a taken slot for a while -- web had
  // no waitlist implementation at all (no join affordance, no api.waitlist call anywhere).
  // Copy deliberately says "we'll let you know", never "reserved"/"held" -- matches the earlier
  // waitlist redesign (notify everyone, reserve nothing; whoever holds first gets the slot).
  const waitlistQuery = useQuery({
    queryKey: ["waitlist-mine"],
    queryFn: () => api.waitlist.mine(),
    enabled: status === "signedIn",
  });
  const joinedKeys = new Set(
    (waitlistQuery.data ?? []).filter((e) => e.is_active).map((e) => `${e.court_id}|${e.slot_starts_at}`),
  );
  const [joiningKey, setJoiningKey] = useState<string | null>(null);

  async function handleJoinWaitlist(courtId: string, slotStartsAt: string) {
    if (status !== "signedIn") {
      router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    const key = `${courtId}|${slotStartsAt}`;
    setJoiningKey(key);
    try {
      const { position } = await api.waitlist.join({ court_id: courtId, slot_starts_at: slotStartsAt });
      await queryClient.invalidateQueries({ queryKey: ["waitlist-mine"] });
      alert(`You're on the list — we'll let you know if this slot opens up. You're #${position} in line.`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        await queryClient.invalidateQueries({ queryKey: ["waitlist-mine"] });
      } else {
        alert(`Couldn't join the waitlist: ${friendlyErrorMessage(e)}`);
      }
    } finally {
      setJoiningKey(null);
    }
  }

  useEffect(() => {
    function onVisibility() {
      setIsFocused(document.visibilityState === "visible");
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const availabilityQuery = useQuery({
    queryKey: ["venue-availability", venueId, date],
    queryFn: () => api.availability.forVenueOnDate(venueId, date),
    refetchInterval: (query) => (isFocused ? pollInterval(query, 15_000) : false),
  });

  const courtAvailability = availabilityQuery.data?.courts ?? [];

  function handleTapSlot(courtId: string, courtName: string, slotStatus: string, startsAt: string, price: number) {
    if (slotStatus !== "available") return;
    if (status !== "signedIn") {
      router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    const params = new URLSearchParams({
      venueId,
      venueName,
      courtId,
      courtName,
      startsAt,
      price: String(price),
    });
    router.push(`/booking/new/chat?${params.toString()}`);
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-bold tracking-tight">Availability</h2>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {days.map((d, i) => (
          <button
            key={i}
            onClick={() => setDateIdx(i)}
            className="shrink-0 px-4 py-2.5 rounded-xl flex flex-col items-center gap-0.5 min-w-[74px]"
            style={{ background: dateIdx === i ? "#141A1D" : "#FFFFFF", border: dateIdx === i ? "none" : "1px solid #EBE5E1" }}
          >
            <span className="text-[11px] font-semibold tracking-wider" style={{ color: dateIdx === i ? "rgba(255,255,255,0.75)" : "#7A7068" }}>
              {d.toLocaleDateString("en-GB", { weekday: "short" }).toUpperCase()} {d.getDate()}
            </span>
          </button>
        ))}
      </div>

      <div className="bg-player-surface border border-player-border-light rounded-2xl overflow-hidden overflow-x-auto">
        <table className="w-full border-collapse min-w-[480px]">
          <thead>
            <tr className="bg-player-bg border-b border-player-border-light">
              <th className="text-left px-4 py-3 text-[11.5px] font-bold tracking-wider text-player-ink-fainter">TIME</th>
              {courts.map((c) => (
                <th key={c.id} className="text-left px-4 py-3 text-[11.5px] font-bold tracking-wider text-player-ink-fainter">
                  {c.name.toUpperCase()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {availabilityQuery.isLoading ? (
              <tr>
                <td colSpan={courts.length + 1} className="text-center py-10 text-player-ink-faint">
                  Loading…
                </td>
              </tr>
            ) : availabilityQuery.isError && !availabilityQuery.data ? (
              <tr>
                <td colSpan={courts.length + 1} className="text-center py-10">
                  <p className="text-player-ink-faint text-sm mb-3">{friendlyErrorMessage(availabilityQuery.error)}</p>
                  <button
                    onClick={() => availabilityQuery.refetch()}
                    className="px-4 py-2 rounded-lg bg-player-accent text-white font-semibold text-[13px]"
                  >
                    Try again
                  </button>
                </td>
              </tr>
            ) : (
              (courtAvailability[0]?.slots ?? []).map((slot, rowIdx) => (
                <tr key={slot.starts_at} className="border-b border-player-border-light last:border-0">
                  <td className="px-4 py-2.5 font-mono text-sm font-semibold">{formatTime(slot.starts_at)}</td>
                  {courtAvailability.map((court) => {
                    const s = court.slots[rowIdx];
                    if (!s) return <td key={court.court_id} />;
                    const isOpen = s.status === "available";
                    const isBooked = s.status === "booked";
                    const waitlistKey = `${court.court_id}|${s.starts_at}`;
                    const onWaitlist = joinedKeys.has(waitlistKey);
                    const joining = joiningKey === waitlistKey;
                    if (isBooked) {
                      return (
                        <td key={court.court_id} className="px-3.5 py-2">
                          <button
                            onClick={() => !onWaitlist && handleJoinWaitlist(court.court_id, s.starts_at)}
                            disabled={onWaitlist || joining}
                            className="h-10 w-full rounded-lg flex items-center justify-center font-mono text-[12px] font-semibold px-1"
                            style={{
                              background: onWaitlist ? "#EEF4F2" : "#F4F1EE",
                              border: onWaitlist ? "1px solid #C9E0D8" : "none",
                              color: onWaitlist ? "#1F7A52" : "#A8A099",
                              cursor: onWaitlist ? "default" : "pointer",
                            }}
                          >
                            {joining ? "…" : onWaitlist ? "On waitlist" : "Notify me"}
                          </button>
                        </td>
                      );
                    }
                    return (
                      <td key={court.court_id} className="px-3.5 py-2">
                        <button
                          onClick={() => handleTapSlot(court.court_id, court.court_name, s.status, s.starts_at, s.price)}
                          disabled={!isOpen}
                          className="h-10 w-full rounded-lg flex items-center justify-center font-mono text-[13px] font-semibold"
                          style={{
                            background: isOpen ? "#FFF3EE" : "#F4F1EE",
                            border: isOpen ? "1px solid #F6DCD1" : "none",
                            color: isOpen ? "#C8431C" : "#A8A099",
                            cursor: isOpen ? "pointer" : "default",
                          }}
                        >
                          {isOpen ? formatPKR(s.price) : STATUS_LABEL[s.status] ?? s.status}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
