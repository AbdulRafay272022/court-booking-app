"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, durationChoices, formatDuration, minSlotsFor, monthOf, pktDateString, upcomingSlots, weekOf } from "@court-booking/types";
import type { DaySummaryState } from "@court-booking/types";

import { api } from "@/lib/api";
import { ApiError } from "@court-booking/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { CourtLabel } from "@/components/court-label";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatDateString, formatPKR, formatSlotTimes } from "@/lib/format";
import { DurationSheet } from "./duration-sheet";
import { useT } from "@/components/i18n/lang-provider";
import type { MessageKey } from "@/lib/i18n";
import { CourtMonthCalendar } from "./court-month-calendar";

const OTHER_STATUS_LABEL: Record<string, MessageKey> = {
  held: "venue.pop.paymentPending",
  payment_submitted: "venue.pop.paymentPending",
  booked: "venue.pop.booked",
  blocked: "venue.pop.unavailable",
};

// Day-state dot colours for the week strip (the same tokens as the month calendar).
const DOW_DOT: Partial<Record<DaySummaryState, string>> = { open: "bg-khelo-success-text", few: "bg-khelo-warning-text", full: "bg-khelo-muted-3" };

/**
 * The popup a tapped calendar date opens (Section 32 Part 4b UPDATE), scoped to ONE court: a centered dialog on
 * desktop (>=768px), a bottom sheet on narrower screens. A Monday-first week strip for quick day switching, that
 * day's slot list below it, and a back arrow that returns to a month view (without closing the popup).
 */
export function CourtDayPopup({
  courtId,
  courtName,
  courtSport,
  slotMinutes,
  venueId,
  venueName,
  initialDate,
  onClose,
}: {
  courtId: string;
  courtName: string;
  courtSport?: string;
  /** The court's MINIMUM booking time (its slot_minutes setting); the slots themselves are always 30 minutes. */
  slotMinutes: number;
  venueId: string;
  venueName: string;
  initialDate: string;
  onClose: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const status = useAuthStore((s) => s.status);
  const [view, setView] = useState<"day" | "month">("day");
  const [date, setDate] = useState(initialDate);
  const [pickingIndex, setPickingIndex] = useState<number | null>(null);
  const [joiningKey, setJoiningKey] = useState<string | null>(null);

  const today = pktDateString();
  const tomorrow = addDays(today, 1);
  // Nothing before today is offered: the strip starts at today even when the tapped date's week began earlier.
  const week = useMemo(() => weekOf(date).filter((d) => d >= today), [date, today]);
  // The clock that decides which of today's slots have already gone; ticks so an open popup keeps up.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  function tabLabel(d: string) {
    if (d === today) return t("venue.pop.today");
    if (d === tomorrow) return t("venue.pop.tomorrow");
    return formatDateString(d).split(",")[0];
  }

  const waitlistQuery = useQuery({ queryKey: ["waitlist-mine"], queryFn: () => api.waitlist.mine(), enabled: status === "signedIn" });
  const joinedKeys = new Set(
    (waitlistQuery.data ?? []).filter((e) => e.is_active).map((e) => `${e.court_id}|${e.slot_starts_at}`),
  );

  // The app's query client keeps the PREVIOUS query's data while a new one loads (placeholderData). For a per-day
  // query that shows the OLD day's slots, tappable, under the new day's label -- so opt out: this day has no data until it loads.
  const dayQuery = useQuery({
    queryKey: ["court-availability", courtId, date, status === "signedIn"],
    queryFn: () => api.availability.forCourtOnDate(courtId, date),
    placeholderData: undefined,
  });
  const slots = useMemo(() => upcomingSlots(dayQuery.data?.slots ?? [], now), [dayQuery.data, now]);
  const minSlots = minSlotsFor(slotMinutes);

  // Drives the small availability dot on each week-strip pill. Shares the calendar's query key, so it's already
  // cached from the month view and adds no extra fetch in the common case.
  const monthSummaryQuery = useQuery({
    queryKey: ["court-month-summary", courtId, monthOf(date)],
    queryFn: () => api.availability.monthSummary(courtId, monthOf(date)),
  });
  const stateByDate = new Map((monthSummaryQuery.data?.days ?? []).map((d) => [d.date, d.state]));

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
      alert(t("venue.pop.waitlistJoined", { position }));
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        await queryClient.invalidateQueries({ queryKey: ["waitlist-mine"] });
      } else {
        alert(t("venue.pop.waitlistFailed", { error: friendlyErrorMessage(e) }));
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
    if (durationChoices(slots, index, minSlots).length === 0) return; // the minimum booking does not fit from here
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
      ...(courtSport ? { courtSport } : {}),
      startsAt,
      price: String(choice.price),
      slotCount: String(choice.slotCount),
      minutes: String(choice.minutes),
    });
    router.push(`/booking/new/chat?${params.toString()}`);
  }

  return (
    <>
      <div className="khelo fixed inset-0 z-50 flex items-end md:items-center justify-center bg-khelo-ink/50 font-[family-name:var(--font-khelo-body-x)] text-khelo-ink" onClick={onClose}>
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("venue.pop.availability", { court: courtName })}
          className="bg-khelo-surface w-full md:w-[440px] rounded-t-3xl md:rounded-3xl px-5 pt-5 pb-8 md:pb-6 flex flex-col gap-4"
          style={{ maxHeight: "86vh" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between">
            {view === "day" ? (
              <button
                type="button"
                onClick={() => setView("month")}
                aria-label={t("venue.pop.backToMonth")}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-khelo-page text-lg font-bold text-khelo-ink"
              >
                ‹
              </button>
            ) : (
              <span className="w-11" />
            )}
            <span className="font-khelo-display text-[16px] font-extrabold text-khelo-ink"><CourtLabel name={courtName} sport={courtSport} /></span>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("venue.common.close")}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-khelo-page text-lg font-bold text-khelo-ink"
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
              <div className="grid gap-1 shrink-0" style={{ gridTemplateColumns: `repeat(${week.length}, minmax(0, 1fr))` }}>
                {week.map((d) => {
                  const isPast = d < today;
                  const selected = d === date;
                  const dot = DOW_DOT[stateByDate.get(d) ?? "closed"];
                  return (
                    <button
                      key={d}
                      type="button"
                      disabled={isPast}
                      onClick={() => setDate(d)}
                      aria-pressed={selected}
                      className={`min-w-0 flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-2xl border-[1.5px] py-2.5 transition-colors ${
                        selected ? "border-khelo-orange bg-khelo-orange text-khelo-ink" : "border-khelo-border bg-khelo-surface text-khelo-ink"
                      } ${isPast ? "opacity-40" : "cursor-pointer"}`}
                    >
                      <span className={`text-[11px] font-bold leading-none whitespace-nowrap ${selected ? "text-khelo-ink" : "text-khelo-muted"}`}>
                        {tabLabel(d)}
                      </span>
                      <span className="font-mono text-[15px] font-extrabold">
                        {String(Number(d.slice(8))).padStart(2, "0")}
                      </span>
                      <span className={`h-[5px] w-[5px] rounded-full ${selected ? (dot ? "bg-khelo-ink" : "bg-transparent") : (dot ?? "bg-transparent")}`} aria-hidden />
                    </button>
                  );
                })}
              </div>

              <div className="overflow-y-auto flex flex-col gap-2 pr-1 -mr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-khelo-border [&::-webkit-scrollbar-track]:bg-transparent">
                {dayQuery.isLoading ? (
                  <p className="text-center py-10 text-khelo-muted-2">{t("venue.cal.loading")}</p>
                ) : slots.length === 0 ? (
                  <p className="text-center py-8 text-[13.5px] text-khelo-muted-2">{(dayQuery.data?.slots.length ?? 0) > 0 ? t("venue.pop.noMoreToday") : t("venue.pop.closedDay")}</p>
                ) : (
                  slots.map((slot, index) => {
                    // on the 30-minute grid a free slot is only a place a booking can START when the court's minimum
                    // (e.g. 2 slots for 60 minutes) fits from here; the first choice also carries that minimum's price
                    const startChoices = slot.status === "available" ? durationChoices(slots, index, minSlots) : [];
                    const isOpen = startChoices.length > 0;
                    const tooShort = slot.status === "available" && !isOpen;
                    const isBooked = slot.status === "booked";
                    const dividerBefore = slot.after_midnight && !slots[index - 1]?.after_midnight;
                    const divider = dividerBefore ? (
                      <span className="text-[11px] font-extrabold tracking-[0.14em] text-khelo-muted-2">{t("venue.pop.afterMidnight")}</span>
                    ) : null;
                    if (slot.is_mine && slot.booking_id && (isBooked || slot.status === "held" || slot.status === "payment_submitted")) {
                      const pending = !isBooked;
                      return (
                        <div key={slot.starts_at} className="flex flex-col gap-1">
                          {divider}
                          <button
                            onClick={() => handleTapSlot(index, slot.booking_id)}
                            className={`flex min-h-12 items-center justify-between rounded-2xl border-[1.5px] px-3.5 py-3 text-left ${
                              pending ? "border-khelo-warning bg-khelo-warning-bg" : "border-khelo-success bg-khelo-success-bg"
                            }`}
                          >
                            <span className="font-mono text-[13px] font-semibold text-khelo-ink">{formatSlotTimes(slot)}</span>
                            <span className={`rounded-full px-2.5 py-1 text-[10.5px] font-extrabold ${pending ? "bg-khelo-warning text-khelo-ink" : "bg-khelo-success-text text-white"}`}>
                              {pending ? t("venue.pop.paymentPendingCaps") : t("venue.pop.yourBooking")}
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
                          title={slot.status === "blocked" && slot.reason ? slot.reason : tooShort ? t("venue.pop.needsAtLeast", { duration: formatDuration(slotMinutes) }) : undefined}
                          data-testid={isOpen ? "slot-open" : undefined}
                          className={`flex min-h-12 items-center justify-between rounded-2xl border-[1.5px] px-3.5 py-3 text-left ${
                            isOpen
                              ? "cursor-pointer border-khelo-teal/30 bg-khelo-mint hover:border-khelo-orange"
                              : tooShort
                                ? "cursor-default border-khelo-border bg-khelo-page"
                                : "cursor-default border-transparent bg-khelo-booked-bg"
                          }`}
                        >
                          <span className={`font-mono text-[13px] font-semibold ${isOpen ? "text-khelo-ink" : "text-khelo-muted"} ${isBooked ? "line-through" : ""}`}>
                            {formatSlotTimes(slot)}
                          </span>
                          <span className="flex items-center gap-2">
                            {isBooked ? (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!onWaitlist) handleJoinWaitlist(slot.starts_at);
                                }}
                                disabled={onWaitlist || joining}
                                className={`h-11 rounded-full px-3 text-[11.5px] font-extrabold ${onWaitlist ? "bg-khelo-page text-khelo-muted" : "bg-khelo-warm-2 text-khelo-orange-label"}`}
                              >
                                {joining ? "\u2026" : onWaitlist ? t("venue.pop.onWaitlist") : t("venue.pop.notifyMe")}
                              </button>
                            ) : null}
                            {isOpen ? (
                              <>
                                <span className="font-mono text-[12px] font-semibold text-khelo-muted">
                                  PKR {formatPKR(startChoices[0].price)}{minSlots > 1 ? ` · ${formatDuration(startChoices[0].minutes)}` : ""}
                                </span>
                                <span className="rounded-full bg-khelo-surface px-2.5 py-1 text-[10.5px] font-extrabold text-khelo-success-text">{t("venue.pop.open")}</span>
                              </>
                            ) : (
                              <span className="text-[11.5px] font-bold text-khelo-muted">
                                {tooShort ? t("venue.pop.tooShort") : OTHER_STATUS_LABEL[slot.status] ? t(OTHER_STATUS_LABEL[slot.status]) : slot.status}
                              </span>
                            )}
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
          courtSport={courtSport}
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
