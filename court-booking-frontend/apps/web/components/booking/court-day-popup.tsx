"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, pktDateString, weekOf } from "@court-booking/types";

import { api } from "@/lib/api";
import { ApiError } from "@court-booking/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatDateString, formatPKR, formatSlotTimes } from "@/lib/format";
import { DurationSheet } from "./duration-sheet";
import { CourtMonthCalendar } from "./court-month-calendar";

const OTHER_STATUS_LABEL: Record<string, string> = {
  held: "Payment pending",
  payment_submitted: "Payment pending",
  booked: "Booked",
  blocked: "Unavailable",
};

/**
 * The popup a tapped calendar date opens (Section 32 Part 4b UPDATE), scoped to ONE court: a centered dialog on
 * desktop (>=768px), a bottom sheet on narrower screens. A Monday-first week strip for quick day switching, that
 * day's slot list below it, and a back arrow that returns to a month view (without closing the popup).
 */
export function CourtDayPopup({
  courtId,
  courtName,
  slotMinutes,
  venueId,
  venueName,
  initialDate,
  onClose,
}: {
  courtId: string;
  courtName: string;
  slotMinutes: number;
  venueId: string;
  venueName: string;
  initialDate: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const status = useAuthStore((s) => s.status);
  const [view, setView] = useState<"day" | "month">("day");
  const [date, setDate] = useState(initialDate);
  const [pickingIndex, setPickingIndex] = useState<number | null>(null);
  const [joiningKey, setJoiningKey] = useState<string | null>(null);

  const today = pktDateString();
  const tomorrow = addDays(today, 1);
  const week = useMemo(() => weekOf(date), [date]);

  function tabLabel(d: string) {
    if (d === today) return "Today";
    if (d === tomorrow) return "Tmrw";
    return formatDateString(d).split(",")[0];
  }

  const waitlistQuery = useQuery({ queryKey: ["waitlist-mine"], queryFn: () => api.waitlist.mine(), enabled: status === "signedIn" });
  const joinedKeys = new Set(
    (waitlistQuery.data ?? []).filter((e) => e.is_active).map((e) => `${e.court_id}|${e.slot_starts_at}`),
  );

  const dayQuery = useQuery({
    queryKey: ["court-availability", courtId, date, status === "signedIn"],
    queryFn: () => api.availability.forCourtOnDate(courtId, date),
  });
  const slots = dayQuery.data?.slots ?? [];

  async function handleJoinWaitlist(slotStartsAt: string) {
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

  function handleTapSlot(index: number, mineBookingId: string | null) {
    const slot = slots[index];
    if (mineBookingId) {
      onClose();
      router.push(`/booking/${mineBookingId}/${slot.status === "booked" ? "done" : "pay"}`);
      return;
    }
    if (slot.status !== "available") return;
    if (status !== "signedIn") {
      router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    setPickingIndex(index);
  }

  function handleContinue(choice: { slotCount: number; minutes: number; price: number }) {
    if (pickingIndex === null) return;
    const startsAt = slots[pickingIndex].starts_at;
    setPickingIndex(null);
    onClose();
    const params = new URLSearchParams({
      venueId,
      venueName,
      courtId,
      courtName,
      startsAt,
      price: String(choice.price),
      slotCount: String(choice.slotCount),
      minutes: String(choice.minutes),
    });
    router.push(`/booking/new/chat?${params.toString()}`);
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
        <div
          className="bg-player-surface w-full md:w-[420px] rounded-t-3xl md:rounded-2xl px-5 pt-5 pb-8 md:pb-6 flex flex-col gap-4"
          style={{ maxHeight: "86vh" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between">
            {view === "day" ? (
              <button
                type="button"
                onClick={() => setView("month")}
                aria-label="Back to month view"
                className="w-10 h-10 rounded-xl flex items-center justify-center font-bold"
                style={{ background: "#F4EFEC" }}
              >
                ‹
              </button>
            ) : (
              <span className="w-10" />
            )}
            <span className="font-bold text-[15px] text-player-ink">{courtName}</span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="w-10 h-10 rounded-xl flex items-center justify-center font-bold"
              style={{ background: "#F4EFEC" }}
            >
              ✕
            </button>
          </div>

          {view === "month" ? (
            <div className="overflow-y-auto">
              <CourtMonthCalendar
                courtId={courtId}
                onSelectDate={(d) => {
                  setDate(d);
                  setView("day");
                }}
              />
            </div>
          ) : (
            <>
              <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                {week.map((d) => {
                  const isPast = d < today;
                  const selected = d === date;
                  const isToday = d === today;
                  return (
                    <button
                      key={d}
                      type="button"
                      disabled={isPast}
                      onClick={() => setDate(d)}
                      aria-pressed={selected}
                      className="shrink-0 px-3.5 py-2.5 rounded-2xl flex flex-col items-center gap-0.5 min-w-[60px] transition-colors"
                      style={{
                        background: selected ? "#EF5A2C" : "#F4EFEC",
                        border: !selected && isToday ? "1.5px solid #EF5A2C" : "1.5px solid transparent",
                        opacity: isPast ? 0.4 : 1,
                        cursor: isPast ? "default" : "pointer",
                      }}
                    >
                      <span className="text-[10px] font-bold tracking-wider uppercase" style={{ color: selected ? "rgba(255,255,255,0.85)" : "#8A8079" }}>
                        {tabLabel(d)}
                      </span>
                      <span className="font-mono text-[15px] font-semibold" style={{ color: selected ? "#FFFFFF" : "#141A1D" }}>
                        {String(Number(d.slice(8))).padStart(2, "0")}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="overflow-y-auto flex flex-col gap-2 pr-1 -mr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[#E0D9D4] [&::-webkit-scrollbar-track]:bg-transparent">
                {dayQuery.isLoading ? (
                  <p className="text-center py-10 text-player-ink-faint">Loading…</p>
                ) : slots.length === 0 ? (
                  <p className="text-center py-8 text-[13.5px] text-player-ink-faint">Closed this day.</p>
                ) : (
                  slots.map((slot, index) => {
                    const isOpen = slot.status === "available";
                    const isBooked = slot.status === "booked";
                    const dividerBefore = slot.after_midnight && !slots[index - 1]?.after_midnight;
                    const divider = dividerBefore ? (
                      <span className="text-[10.5px] font-bold tracking-[0.14em] text-player-ink-fainter">AFTER MIDNIGHT</span>
                    ) : null;
                    if (slot.is_mine && slot.booking_id && (isBooked || slot.status === "held" || slot.status === "payment_submitted")) {
                      const pending = !isBooked;
                      return (
                        <div key={slot.starts_at} className="flex flex-col gap-1">
                          {divider}
                          <button
                            onClick={() => handleTapSlot(index, slot.booking_id)}
                            className="flex items-center justify-between px-4 py-3 rounded-xl text-left"
                            style={{ background: pending ? "#FFF6E5" : "#EAF5EF", border: pending ? "1px solid #F3DDAE" : "1px solid #BFE0CE" }}
                          >
                            <span className="font-mono text-[13.5px] font-semibold">{formatSlotTimes(slot)}</span>
                            <span className="text-[11px] font-bold" style={{ color: pending ? "#9A6208" : "#1F7A52" }}>
                              {pending ? "PAYMENT PENDING" : "YOUR BOOKING"}
                            </span>
                          </button>
                        </div>
                      );
                    }
                    const waitlistKey = `${courtId}|${slot.starts_at}`;
                    const onWaitlist = joinedKeys.has(waitlistKey);
                    const joining = joiningKey === waitlistKey;
                    return (
                      <div key={slot.starts_at} className="flex flex-col gap-1">
                        {divider}
                        <button
                          onClick={() => handleTapSlot(index, null)}
                          disabled={!isOpen}
                          title={slot.status === "blocked" && slot.reason ? slot.reason : undefined}
                          className="flex items-center justify-between px-4 py-3 rounded-xl text-left"
                          style={{
                            background: isOpen ? "#FFFFFF" : "#F4EFEC",
                            border: isOpen ? "1.5px solid #E5DED8" : "1.5px solid transparent",
                            opacity: slot.status === "blocked" ? 0.6 : 1,
                            cursor: isOpen ? "pointer" : "default",
                          }}
                        >
                          <span className="font-mono text-[13.5px] font-semibold text-player-ink">{formatSlotTimes(slot)}</span>
                          <span className="flex items-center gap-2.5">
                            {isBooked ? (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!onWaitlist) handleJoinWaitlist(slot.starts_at);
                                }}
                                disabled={onWaitlist || joining}
                                className="h-8 px-3 rounded-full text-[11px] font-bold"
                                style={{ background: onWaitlist ? "#F4EFEC" : "#FFF3EE", color: onWaitlist ? "#7A7068" : "#C8431C" }}
                              >
                                {joining ? "…" : onWaitlist ? "On waitlist" : "Notify me"}
                              </button>
                            ) : null}
                            <span className="text-[13px] font-bold" style={{ color: isOpen ? "#141A1D" : "#7A7068" }}>
                              {isOpen ? `PKR ${formatPKR(slot.price)}` : OTHER_STATUS_LABEL[slot.status] ?? slot.status}
                            </span>
                          </span>
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {pickingIndex !== null ? (
        <DurationSheet
          courtId={courtId}
          courtName={courtName}
          slotMinutes={slotMinutes}
          slots={slots}
          index={pickingIndex}
          onClose={() => setPickingIndex(null)}
          onContinue={handleContinue}
        />
      ) : null}
    </>
  );
}
