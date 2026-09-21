"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ApiError } from "@court-booking/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR, formatSlotTimes, pktDayTabs } from "@/lib/format";
import { pollInterval } from "@/lib/polling";
import { formatDuration, type Court, type Slot } from "@court-booking/types";
import { DurationSheet } from "@/components/booking/duration-sheet";

// What a slot somebody ELSE holds says (never tappable for booking). Times outside a court's opening hours are simply
// not in the list, so "closed" is never shown as bookable.
const OTHER_STATUS_LABEL: Record<string, string> = {
  held: "Payment pending",
  payment_submitted: "Payment pending",
  booked: "Booked",
  blocked: "Unavailable",
};

export function VenueScheduleClient({ venueId, venueName }: { venueId: string; venueName: string; courts: Court[] }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const status = useAuthStore((s) => s.status);
  // Pakistan calendar days. These used to come from `new Date()` + `toISOString().slice(0, 10)` (the UTC
  // date), so between midnight and 5 AM the tab labelled "Wed 23" queried Tuesday the 22nd.
  const days = useMemo(() => pktDayTabs(6), []);
  const [dateIdx, setDateIdx] = useState(0);
  const [isFocused, setIsFocused] = useState(true);
  const date = days[dateIdx].date;

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

  // Wait until the saved session has been loaded before asking, and re-ask when signing in/out: the answer
  // depends on WHO is asking (`is_mine`). Without this the first request on a fresh page load went out with no
  // token, so the player's own booking showed "Notify me" until the next 15-second poll.
  const authReady = status !== "hydrating";
  const availabilityQuery = useQuery({
    queryKey: ["venue-availability", venueId, date, status === "signedIn"],
    queryFn: () => api.availability.forVenueOnDate(venueId, date),
    enabled: authReady,
    refetchInterval: (query) => (isFocused ? pollInterval(query, 15_000) : false),
  });

  const courtAvailability = availabilityQuery.data?.courts ?? [];

  // The open slot the player tapped: the duration sheet asks how long, shows the total, then hands off to the chat.
  const [picking, setPicking] = useState<{ courtId: string; courtName: string; slotMinutes: number; slots: Slot[]; index: number } | null>(null);

  function handleTapSlot(courtId: string, courtName: string, slotMinutes: number, slots: Slot[], index: number) {
    if (slots[index].status !== "available") return;
    if (status !== "signedIn") {
      router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    setPicking({ courtId, courtName, slotMinutes, slots, index });
  }

  function handleContinue(choice: { slotCount: number; minutes: number; price: number }) {
    if (!picking) return;
    const params = new URLSearchParams({
      venueId,
      venueName,
      courtId: picking.courtId,
      courtName: picking.courtName,
      startsAt: picking.slots[picking.index].starts_at,
      price: String(choice.price),
      slotCount: String(choice.slotCount),
      minutes: String(choice.minutes),
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
              {i === 0 ? "Today" : i === 1 ? "Tomorrow" : d.weekday}
            </span>
            <span className="text-[13px] font-bold whitespace-nowrap" style={{ color: dateIdx === i ? "#FFFFFF" : "#141A1D" }}>
              {d.day} {d.month}
            </span>
          </button>
        ))}
      </div>

      {availabilityQuery.isLoading || !authReady ? (
        <p className="text-center py-10 text-player-ink-faint">Loading…</p>
      ) : availabilityQuery.isError && !availabilityQuery.data ? (
        <div className="text-center py-10">
          <p className="text-player-ink-faint text-sm mb-3">{friendlyErrorMessage(availabilityQuery.error)}</p>
          <button onClick={() => availabilityQuery.refetch()} className="px-4 py-2 rounded-lg bg-player-accent text-white font-semibold text-[13px]">
            Try again
          </button>
        </div>
      ) : (
        // One list per court, because each court has its own slot length (a 90-minute padel court and a 60-minute
        // futsal court do not share rows). Only the court's open hours are listed.
        <div className={`grid gap-4 ${courtAvailability.length > 1 ? "md:grid-cols-2" : ""}`}>
          {courtAvailability.map((court) => (
            <section key={court.court_id} className="bg-player-surface border border-player-border-light rounded-2xl overflow-hidden" data-testid={`court-list-${court.court_name}`}>
              <header className="flex items-baseline justify-between gap-3 px-4 py-3 bg-player-bg border-b border-player-border-light">
                <h3 className="text-[12px] font-bold tracking-wider text-player-ink-fainter">{court.court_name.toUpperCase()}</h3>
                <span className="text-[12px] font-medium text-player-ink-faint">{formatDuration(court.slot_minutes)} slots</span>
              </header>
              {court.slots.length === 0 ? (
                <p className="px-4 py-8 text-center text-[13.5px] text-player-ink-faint">Closed this day.</p>
              ) : (
                <ul>
                  {court.slots.map((s, index) => {
                    const isOpen = s.status === "available";
                    const isBooked = s.status === "booked";
                    // A slot after midnight belongs to the day that opened but is on the next calendar day: "Fri 1:00 AM to 2:00 AM",
                    // under a small divider before the first one.
                    const dividerBefore = s.after_midnight && !court.slots[index - 1]?.after_midnight;
                    const divider = dividerBefore ? (
                      <span className="basis-full -mt-0.5 text-[10.5px] font-bold tracking-[0.14em] text-player-ink-fainter">AFTER MIDNIGHT</span>
                    ) : null;
                    const timeCell = <span className="font-mono text-[13.5px] font-semibold">{formatSlotTimes(s)}</span>;
                    // My own booking / hold: show MY status, never "Notify me" (that is for a slot somebody
                    // ELSE has). A real production slot showed "On waitlist" for the player who had booked it.
                    if (s.is_mine && s.booking_id && (isBooked || s.status === "held" || s.status === "payment_submitted")) {
                      const pending = !isBooked;
                      return (
                        <li key={s.starts_at} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2 border-b border-player-border-light last:border-0">
                          {divider}
                          {timeCell}
                          <button
                            onClick={() => router.push(`/booking/${s.booking_id}/${pending ? "pay" : "done"}`)}
                            className="h-10 min-w-[128px] rounded-lg flex items-center justify-center text-[12px] font-bold px-2"
                            style={{
                              background: pending ? "#FFF6E5" : "#EAF5EF",
                              border: pending ? "1px solid #F3DDAE" : "1px solid #BFE0CE",
                              color: pending ? "#9A6208" : "#1F7A52",
                            }}
                          >
                            {pending ? "Payment pending" : "Your booking"}
                          </button>
                        </li>
                      );
                    }
                    const waitlistKey = `${court.court_id}|${s.starts_at}`;
                    const onWaitlist = joinedKeys.has(waitlistKey);
                    const joining = joiningKey === waitlistKey;
                    return (
                      <li key={s.starts_at} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2 border-b border-player-border-light last:border-0">
                        {divider}
                        {timeCell}
                        <div className="flex items-center gap-2">
                          {isBooked ? (
                            <button
                              onClick={() => !onWaitlist && handleJoinWaitlist(court.court_id, s.starts_at)}
                              disabled={onWaitlist || joining}
                              className="h-9 px-3 rounded-lg text-[12px] font-semibold"
                              style={{
                                background: onWaitlist ? "#EEF4F2" : "#FFF3EE",
                                color: onWaitlist ? "#1F7A52" : "#C8431C",
                                cursor: onWaitlist ? "default" : "pointer",
                              }}
                            >
                              {joining ? "…" : onWaitlist ? "On waitlist" : "Notify me"}
                            </button>
                          ) : null}
                          <button
                            onClick={() => handleTapSlot(court.court_id, court.court_name, court.slot_minutes, court.slots, index)}
                            disabled={!isOpen}
                            title={s.status === "blocked" && s.reason ? s.reason : undefined}
                            className="h-10 min-w-[104px] rounded-lg flex items-center justify-center font-mono text-[13px] font-semibold px-2"
                            style={{
                              background: isOpen ? "#FFF3EE" : "#F4F1EE",
                              border: isOpen ? "1px solid #F6DCD1" : "none",
                              color: isOpen ? "#C8431C" : "#8A8279",
                              cursor: isOpen ? "pointer" : "default",
                            }}
                          >
                            {isOpen ? formatPKR(s.price) : OTHER_STATUS_LABEL[s.status] ?? s.status}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}

      {picking ? (
        <DurationSheet
          courtId={picking.courtId}
          courtName={picking.courtName}
          slotMinutes={picking.slotMinutes}
          slots={picking.slots}
          index={picking.index}
          onClose={() => setPicking(null)}
          onContinue={handleContinue}
        />
      ) : null}
    </div>
  );
}
