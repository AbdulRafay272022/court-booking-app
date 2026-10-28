"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, durationChoices, minSlotsFor, mondayFirstWeekdayOf, monthOf, pktDateString, upcomingSlots, weekOf } from "@court-booking/types";
import type { DaySummaryState } from "@court-booking/types";

import { api } from "@/lib/api";
import { ApiError } from "@court-booking/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { CourtLabel } from "@/components/court-label";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR } from "@/lib/format";
import { useFmt } from "@/lib/use-fmt";
import { DurationSheet } from "./duration-sheet";
import { useT } from "@/components/i18n/lang-provider";
import { slotChipA11y, slotChipCue, type SlotChipState } from "@court-booking/ui-tokens";
import { Hourglass, Lock, UserCheck, useFlLang } from "@/components/fl";
import { slotRowSpec } from "@/lib/slot-row";
import { CourtMonthCalendar } from "./court-month-calendar";
import { useScrollLock } from "@/lib/scroll-lock";

/** Row look per slot state (Floodlight System board): never colour-only, the cue (icon / strike / dashed / outline) comes from slotChipCue. */
const ROW: Record<SlotChipState, string> = {
  open: "border-[1.5px] border-fl-line bg-fl-ground text-fl-night hover:border-fl-night",
  selected: "border-2 border-fl-role-slot-selected-border bg-fl-role-slot-selected text-fl-role-on-slot-selected",
  inRange: "border-2 border-fl-role-slot-range-border bg-fl-role-slot-range text-fl-role-on-slot-range",
  held: "border-[1.5px] border-dashed border-fl-waiting-border bg-fl-waiting-tint text-fl-waiting",
  booked: "border-[1.5px] border-transparent bg-fl-booked-bg text-fl-muted",
  noRoom: "border-[1.5px] border-dashed border-fl-line-strong bg-fl-white text-fl-muted",
  blocked: "border-[1.5px] border-dashed border-fl-line-strong bg-fl-mist text-fl-muted",
  mine: "border-2 border-fl-open bg-fl-open-tint text-fl-open",
};
const PILL: Record<SlotChipState, string> = {
  open: "bg-fl-white text-fl-open",
  selected: "bg-fl-white text-fl-night",
  inRange: "bg-fl-white text-fl-night",
  held: "bg-fl-white text-fl-waiting",
  booked: "bg-fl-white text-fl-muted",
  noRoom: "bg-fl-ground text-fl-muted",
  blocked: "bg-fl-white text-fl-muted",
  mine: "bg-fl-white text-fl-open",
};

// Day-state dot colours for the week strip (the same tokens as the month calendar).
const DOW_DOT: Partial<Record<DaySummaryState, string>> = { open: "bg-fl-open", few: "bg-fl-waiting", full: "bg-fl-muted2" };

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
  cancellation,
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
  cancellation?: { cancellation_allowed: boolean; cancellation_cutoff_hours: number | null } | null;
}) {
  const t = useT();
  const fmt = useFmt();
  const lang = useFlLang();
  const router = useRouter();
  const queryClient = useQueryClient();
  const status = useAuthStore((s) => s.status);
  const [view, setView] = useState<"day" | "month">("day");
  const [date, setDate] = useState(initialDate);
  // The picked START (an instant), not a list position: the 30 s clock removes started slots from the top of the list, and a
  // stored index would then point at the NEXT slot while the duration sheet is open (audit 2026-10-28 item 5).
  const [pickingStart, setPickingStart] = useState<string | null>(null);
  // The venue page behind this popup must not scroll while it is open (audit 2026-10-28 item 5).
  useScrollLock(true);
  const [joiningKey, setJoiningKey] = useState<string | null>(null);

  const today = pktDateString();
  const tomorrow = addDays(today, 1);
  // Nothing before today is offered: the strip starts at today even when the tapped date's week began earlier.
  const week = useMemo(() => weekOf(date).filter((d) => d >= today), [date, today]);
  // The clock that decides which of today's slots have already gone; ticks so an open popup keeps up.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  function tabLabel(d: string) {
    if (d === today) return t("venue.pop.today");
    if (d === tomorrow) return t("venue.pop.tomorrow");
    return fmt.weekday(mondayFirstWeekdayOf(d), "short");
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
  const pickingIndex = pickingStart === null ? null : slots.findIndex((x) => x.starts_at === pickingStart);
  // the picked slot started (or got taken) while the sheet was open: close the sheet rather than offer another slot
  useEffect(() => {
    if (pickingStart !== null && pickingIndex === -1) setPickingStart(null);
  }, [pickingStart, pickingIndex]);

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
    setPickingStart(slot.starts_at);
  }

  function handleContinue(choice: { slotCount: number; minutes: number; price: number }) {
    if (pickingIndex === null || pickingIndex < 0) return;
    const startsAt = slots[pickingIndex].starts_at;
    setPickingStart(null);
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
      <div className="khelo fixed inset-0 z-50 flex items-end md:items-center justify-center overscroll-contain bg-fl-night/50 font-[family-name:var(--font-khelo-body-x)] text-fl-night" onClick={onClose}>
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("venue.pop.availability", { court: courtName })}
          className="bg-fl-white w-full md:w-[440px] rounded-t-3xl md:rounded-3xl px-5 pt-5 pb-8 md:pb-6 flex flex-col gap-4 overscroll-contain"
          style={{ maxHeight: "86vh" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between">
            {view === "day" ? (
              <button
                type="button"
                onClick={() => setView("month")}
                aria-label={t("venue.pop.backToMonth")}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-fl-ground text-lg font-bold text-fl-night"
              >
                ‹
              </button>
            ) : (
              <span className="w-11" />
            )}
            <span className="font-khelo-display text-[16px] font-extrabold text-fl-night"><CourtLabel name={courtName} sport={courtSport} /></span>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("venue.common.close")}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-fl-ground text-lg font-bold text-fl-night"
            >
              ✕
            </button>
          </div>

          {view === "month" ? (
            <div className="overflow-y-auto overscroll-contain">
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
                        selected ? "border-2 border-fl-role-selected-border bg-fl-role-selected text-fl-role-on-selected" : "border-fl-line-strong bg-fl-white text-fl-night"
                      } ${isPast ? "opacity-40" : "cursor-pointer"}`}
                    >
                      <span className={`text-[11px] font-bold leading-none whitespace-nowrap ${selected ? "text-fl-night" : "text-fl-muted"}`}>
                        {tabLabel(d)}
                      </span>
                      <span className="text-[15px] font-extrabold tabular-nums">
                        {String(Number(d.slice(8))).padStart(2, "0")}
                      </span>
                      <span className={`h-[5px] w-[5px] rounded-full ${selected ? (dot ? "bg-fl-night" : "bg-transparent") : (dot ?? "bg-transparent")}`} aria-hidden />
                    </button>
                  );
                })}
              </div>

              <div className="overflow-y-auto overscroll-contain min-h-[220px] flex flex-col gap-2 pr-1 -mr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-fl-line-strong [&::-webkit-scrollbar-track]:bg-transparent">
                {dayQuery.isLoading ? (
                  <p className="text-center py-10 text-fl-muted2">{t("venue.cal.loading")}</p>
                ) : slots.length === 0 ? (
                  <p className="text-center py-8 text-[13.5px] text-fl-muted2">{(dayQuery.data?.slots.length ?? 0) > 0 ? t("venue.pop.noMoreToday") : t("venue.pop.closedDay")}</p>
                ) : (
                  slots.map((slot, index) => {
                    // on the 30-minute grid a free slot is only a place a booking can START when the court's minimum
                    // (e.g. 2 slots for 60 minutes) fits from here; the first choice also carries that minimum's price
                    const startChoices = slot.status === "available" ? durationChoices(slots, index, minSlots) : [];
                    const spec = slotRowSpec(slot, { now, fits: startChoices.length > 0 }, lang);
                    if (!spec) return null;
                    const cue = slotChipCue(spec.state);
                    const Icon = cue.icon === "lock" ? Lock : cue.icon === "hourglass" ? Hourglass : cue.icon === "user" ? UserCheck : null;
                    const time = fmt.slotTimes(slot);
                    const label = spec.statusLabel ?? (spec.labelKey ? t(spec.labelKey) : "");
                    const dividerBefore = slot.after_midnight && !slots[index - 1]?.after_midnight;
                    const waitlistKey = `${courtId}|${slot.starts_at}`;
                    const onWaitlist = joinedKeys.has(waitlistKey);
                    const joining = joiningKey === waitlistKey;
                    return (
                      <div key={slot.starts_at} className="flex flex-col gap-1">
                        {dividerBefore ? <span className="text-[11px] font-extrabold tracking-[0.14em] text-fl-muted2">{t("venue.pop.afterMidnight")}</span> : null}
                        <div className={`flex min-h-12 items-stretch gap-2 rounded-fl-md ${ROW[spec.state]}`} data-state={spec.state}>
                          <button
                            type="button"
                            onClick={() => (spec.state === "mine" ? handleTapSlot(index, slot.booking_id) : handleTapSlot(index, null))}
                            disabled={!spec.pressable}
                            aria-label={`${slotChipA11y(spec.state, time, lang, slot.reason)}${spec.statusLabel ? `, ${spec.statusLabel}` : ""}${spec.state === "open" ? `, PKR ${formatPKR(startChoices[0].price)}` : ""}`}
                            title={spec.state === "blocked" && slot.reason ? slot.reason : spec.state === "noRoom" ? t("venue.pop.needsAtLeast", { duration: fmt.duration(slotMinutes) }) : undefined}
                            data-testid={spec.state === "open" ? "slot-open" : `slot-${spec.state}`}
                            className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-fl-md px-3.5 py-3 text-left enabled:cursor-pointer disabled:cursor-default focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fl-night"
                          >
                            <span className={`flex items-center gap-1.5 text-[14px] font-extrabold tabular-nums ${cue.strike ? "line-through" : ""}`}>
                              {Icon ? <Icon size={14} strokeWidth={2.4} /> : null}
                              {time}
                            </span>
                            <span className="flex flex-wrap items-center justify-end gap-2">
                              {spec.state === "open" ? (
                                <span className="text-[13px] font-bold tabular-nums text-fl-muted">
                                  PKR {formatPKR(startChoices[0].price)}
                                  {minSlots > 1 ? ` · ${fmt.duration(startChoices[0].minutes)}` : ""}
                                </span>
                              ) : null}
                              <span className={`rounded-full px-2.5 py-1 text-[12px] font-extrabold ${PILL[spec.state]}`}>{label}</span>
                            </span>
                          </button>
                          {spec.waitlist ? (
                            <button
                              type="button"
                              onClick={() => {
                                if (!onWaitlist) handleJoinWaitlist(slot.starts_at);
                              }}
                              disabled={onWaitlist || joining}
                              className={`my-auto mr-1.5 h-11 shrink-0 rounded-full px-3 text-[12px] font-extrabold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fl-night ${onWaitlist ? "bg-fl-white text-fl-muted" : "bg-fl-orange-tint text-fl-orange-deep"}`}
                            >
                              {joining ? "…" : onWaitlist ? t("venue.pop.onWaitlist") : t("venue.pop.notifyMe")}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {pickingIndex !== null && pickingIndex >= 0 ? (
        <DurationSheet
          courtId={courtId}
          courtName={courtName}
          courtSport={courtSport}
          slotMinutes={slotMinutes}
          slots={slots}
          index={pickingIndex}
          onClose={() => setPickingStart(null)}
          onContinue={handleContinue}
          cancellation={cancellation}
        />
      ) : null}
    </>
  );
}
