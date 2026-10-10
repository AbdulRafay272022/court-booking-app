"use client";

import { courtLabel } from "@/components/court-label";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ApiError } from "@court-booking/api-client";
import { addDays, durationChoices, formatDuration, isValidPkMobile, minSlotsFor, walkinSlots } from "@court-booking/types";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR, formatTime, formatTimeRange, pktDayTabs } from "@/lib/format";
import { useOwnerVenues } from "@/lib/use-owner-venues";

/**
 * "Add a booking" -- the owner/staff records a booking for a customer (a walk-in, a phone call, a regular).
 *
 * Section 32 Part 4c: time is a fixed 30-minute grid and a booking is several slots in a row. Tap the first slot, then
 * tap a later slot (or use "+ 30 min") to stretch the booking to it; the court's minimum booking time is selected for
 * you and can't be shortened below it. The total comes from the server's quote (the same code that prices a player's
 * hold), and Save creates ONE booking for the whole range. The customer's name is required; the phone is optional and,
 * when it matches an existing account, links the booking to that account (otherwise the name lives on the booking).
 *
 * No walk-ins in the past: the date picker starts at TODAY (Pakistan calendar day) and, for today, slots that have already
 * ended are not offered (`walkinSlots`); the slot in progress still is. The server enforces the same rule (WALKIN_IN_PAST)
 * and its message is shown if a stale screen still gets it.
 */
export default function OwnerWalkinPage() {
  const { activeVenue } = useOwnerVenues();
  const queryClient = useQueryClient();
  const courts = (activeVenue?.courts ?? []).filter((c) => c.is_active);

  const [courtId, setCourtId] = useState<string | undefined>(undefined);
  // the selection: the first slot's start and how many consecutive 30-minute slots
  const [startsAt, setStartsAt] = useState<string | undefined>(undefined);
  const [slotCount, setSlotCount] = useState(1);
  const [playerName, setPlayerName] = useState("");
  const [playerPhone, setPlayerPhone] = useState("");
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [amount, setAmount] = useState("");
  const [amountTouched, setAmountTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!courtId && courts.length > 0) setCourtId(courts[0].id);
  }, [courts, courtId]);

  // Section 29 Tier 2 Part 3: a walk-in used to always book against today only -- an owner
  // taking a phone booking for tomorrow (a completely normal case) had no way to do it here.
  // Pakistan calendar days (not `new Date()` + the UTC date, which is yesterday until 5 AM in Karachi).
  const next7Days = useMemo(() => pktDayTabs(7), []);
  const [dateIdx, setDateIdx] = useState(0);
  const date = next7Days[dateIdx].date;
  // The app's query client keeps the PREVIOUS query's data while a new one loads (placeholderData). For a per-day
  // query that shows the OLD day's slots, tappable, under the new day's label -- so opt out: this day has no data until it loads.
  const availabilityQuery = useQuery({
    queryKey: ["court-availability", courtId, date],
    queryFn: () => api.availability.forCourtOnDate(courtId!, date),
    placeholderData: undefined,
    enabled: !!courtId,
  });

  // an overnight court at 1:10 AM is still on YESTERDAY's schedule: its after-midnight slots are today's earliest ones
  const tailQuery = useQuery({
    queryKey: ["court-availability", courtId, addDays(date, -1)],
    queryFn: () => api.availability.forCourtOnDate(courtId!, addDays(date, -1)),
    placeholderData: undefined,
    enabled: !!courtId && dateIdx === 0,
  });
  // "now" for the past-slot rule, refreshed every 30 s so a screen left open stops offering a slot once it has ended
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const slots = useMemo(
    () => walkinSlots(availabilityQuery.data?.slots ?? [], tailQuery.data?.slots, dateIdx === 0, nowMs),
    [availabilityQuery.data, tailQuery.data, dateIdx, nowMs],
  );
  const court = courts.find((c) => c.id === courtId);
  const minSlots = minSlotsFor(availabilityQuery.data?.min_booking_minutes ?? court?.slot_minutes ?? 60);
  const startIndex = startsAt ? slots.findIndex((s) => s.starts_at === startsAt) : -1;
  const choices = startIndex >= 0 ? durationChoices(slots, startIndex, minSlots) : [];
  const selectedChoice = choices.find((c) => c.slotCount === slotCount);
  const inRange = (i: number) => startIndex >= 0 && selectedChoice !== undefined && i >= startIndex && i < startIndex + slotCount;

  function reset() {
    setStartsAt(undefined);
    setSlotCount(1);
    setAmount("");
    setAmountTouched(false);
  }

  /** Tap a slot: the first tap starts a booking (with the court's minimum already selected); a later tap on a slot that
   * is reachable without a gap or a taken slot in between stretches the booking to it; anything else starts over there. */
  function handleTapSlot(index: number) {
    const slot = slots[index];
    if (slot.status !== "available") return;
    if (startIndex >= 0 && index > startIndex) {
      const count = index - startIndex + 1;
      const reachable = choices.find((c) => c.slotCount === Math.max(count, minSlots));
      if (reachable) {
        setSlotCount(reachable.slotCount);
        return;
      }
    }
    const fresh = durationChoices(slots, index, minSlots);
    if (fresh.length === 0) {
      setMessage(`That start can't fit the court's minimum booking of ${formatDuration(minSlots * 30)} in a row.`);
      return;
    }
    setMessage(null);
    setStartsAt(slot.starts_at);
    setSlotCount(fresh[0].slotCount);
    setAmount("");
    setAmountTouched(false);
  }

  function step(delta: number) {
    const next = choices.find((c) => c.slotCount === slotCount + delta);
    if (next) setSlotCount(next.slotCount);
  }

  // The total comes from the server's quote -- one source of truth for what a range costs.
  const quoteQuery = useQuery({
    queryKey: ["booking-quote", courtId, startsAt, slotCount],
    queryFn: () => api.availability.quote(courtId!, startsAt!, slotCount),
    placeholderData: undefined,
    enabled: !!courtId && !!startsAt && !!selectedChoice,
  });
  const quote = quoteQuery.data;

  // Prefill "amount collected" with the quoted total until the owner types their own figure.
  useEffect(() => {
    if (quote && !amountTouched) setAmount(String(Math.round(quote.price)));
  }, [quote, amountTouched]);

  const phoneOk = playerPhone.trim() === "" || isValidPkMobile(playerPhone);
  const nameOk = playerName.trim().length > 0;
  const isValid = !!courtId && !!startsAt && !!selectedChoice && !!quote && nameOk && phoneOk && amount !== "" && Number(amount) >= 0;

  async function handleSubmit() {
    if (!isValid || !courtId || !startsAt) return;
    setSubmitting(true);
    setMessage(null);
    try {
      await api.bookings.walkin({
        court_id: courtId,
        starts_at: startsAt,
        slot_count: slotCount,
        player_name: playerName.trim(),
        player_phone: playerPhone.trim() || undefined,
        amount_paid: Number(amount),
      });
      await queryClient.invalidateQueries({ queryKey: ["owner-today"] });
      await availabilityQuery.refetch();
      setPlayerName("");
      setPlayerPhone("");
      setPhoneTouched(false);
      reset();
      setMessage("Booking saved.");
    } catch (e) {
      if (e instanceof ApiError && e.code === "SLOT_ALREADY_TAKEN") {
        setMessage("Part of that time was just booked — pick another.");
        reset();
        availabilityQuery.refetch();
      } else if (e instanceof ApiError && e.code === "WALKIN_IN_PAST") {
        setMessage(e.message || friendlyErrorMessage(e)); // the server's own words: that slot has already ended
        reset();
        setNowMs(Date.now());
      } else {
        setMessage(friendlyErrorMessage(e));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-8 max-w-xl flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Add a booking</h1>

      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-bold tracking-wider text-owner-ink-faint">COURT</span>
        <div className="flex gap-2 flex-wrap">
          {courts.map((c) => (
            <button
              key={c.id}
              onClick={() => { setCourtId(c.id); reset(); }}
              className="px-4 py-2.5 rounded-lg text-sm font-semibold"
              style={{ background: courtId === c.id ? "#0E6274" : "#FFFFFF", color: courtId === c.id ? "#fff" : "#5B7079", border: courtId === c.id ? "none" : "1px solid #DCE3E6" }}
            >
              {courtLabel(c.name, c.sport)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-bold tracking-wider text-owner-ink-faint">DATE</span>
        <div className="flex gap-2 flex-wrap">
          {next7Days.map((d, i) => (
            <button
              key={i}
              onClick={() => { setDateIdx(i); reset(); }}
              className="px-3.5 py-2.5 rounded-lg text-[13px] font-semibold"
              style={{ background: dateIdx === i ? "#0E6274" : "#FFFFFF", color: dateIdx === i ? "#fff" : "#101C21", border: dateIdx === i ? "none" : "1px solid #DCE3E6" }}
            >
              {i === 0 ? "Today" : i === 1 ? "Tomorrow" : `${d.weekday} ${d.day}`}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-bold tracking-wider text-owner-ink-faint">TIME</span>
        <p className="text-owner-ink-faint text-[12.5px] -mt-1" data-testid="walkin-hint">
          Tap the first slot, then tap a later slot (or use + 30 min) to book several in a row. Minimum for this court:{" "}
          {formatDuration(minSlots * 30)}.
        </p>
        <div className="flex gap-2 flex-wrap" data-testid="walkin-slots">
          {slots.map((slot, i) => {
            const taken = slot.status !== "available";
            const selected = inRange(i);
            const cannotStart = !taken && !selected && startIndex < 0 && durationChoices(slots, i, minSlots).length === 0;
            return (
              <button
                key={slot.starts_at}
                disabled={taken}
                onClick={() => handleTapSlot(i)}
                aria-pressed={selected}
                data-testid={selected ? "walkin-slot-selected" : "walkin-slot"}
                title={cannotStart ? `Needs at least ${formatDuration(minSlots * 30)} free in a row` : undefined}
                className="px-4 py-2.5 rounded-lg font-mono text-sm font-semibold"
                style={{
                  background: selected ? "#0E6274" : taken ? "#EFF2F3" : "#FFFFFF",
                  color: selected ? "#fff" : taken ? "#A6B6BC" : cannotStart ? "#8FA1A8" : "#101C21",
                  border: selected ? "none" : "1px solid #DCE3E6",
                  textDecoration: taken ? "line-through" : "none",
                }}
              >
                {formatTime(slot.starts_at)}
              </button>
            );
          })}
        </div>
        {selectedChoice && startsAt ? (
          <div className="flex items-center justify-between gap-3 rounded-lg px-3.5 py-3" style={{ background: "#E8F2F4" }} data-testid="walkin-summary">
            <div className="flex flex-col">
              <span className="font-mono text-sm font-semibold">{formatTimeRange(startsAt, selectedChoice.endsAt)}</span>
              <span className="text-[12.5px] text-owner-ink-faint">
                {formatDuration(selectedChoice.minutes)} · {slotCount} slot{slotCount === 1 ? "" : "s"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => step(-1)}
                disabled={!choices.some((c) => c.slotCount === slotCount - 1)}
                className="h-9 px-3 rounded-lg text-[13px] font-bold bg-white border border-owner-border disabled:opacity-40"
                data-testid="walkin-shorter"
              >
                − 30 min
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                disabled={!choices.some((c) => c.slotCount === slotCount + 1)}
                className="h-9 px-3 rounded-lg text-[13px] font-bold bg-white border border-owner-border disabled:opacity-40"
                data-testid="walkin-longer"
              >
                + 30 min
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Customer name" value={playerName} onChange={setPlayerName} placeholder="Usman Tariq" testId="walkin-name" />
        <Field
          label="Customer phone (optional)"
          value={playerPhone}
          onChange={setPlayerPhone}
          onBlur={() => setPhoneTouched(true)}
          placeholder="0333 5119042"
          mono
          testId="walkin-phone"
          error={phoneTouched && !phoneOk ? "Enter a valid mobile number, e.g. 0333 5119042" : undefined}
        />
      </div>
      <Field
        label="Amount collected (PKR)"
        value={amount}
        onChange={(v) => { setAmountTouched(true); setAmount(v.replace(/\D/g, "")); }}
        placeholder="4000"
        mono
        testId="walkin-amount"
      />
      {quote ? (
        <p className="text-owner-ink-faint text-[12.5px] -mt-2" data-testid="walkin-total">
          Court price for {formatDuration(quote.duration_minutes)}: PKR {formatPKR(quote.price)}
        </p>
      ) : quoteQuery.isError ? (
        <p className="text-sm font-semibold -mt-2" style={{ color: "#8C3823" }}>{friendlyErrorMessage(quoteQuery.error)}</p>
      ) : null}

      {message ? <p className="text-sm font-semibold" style={{ color: message.includes("saved") ? "#1F7A52" : "#8C3823" }} data-testid="walkin-message">{message}</p> : null}

      <button
        onClick={handleSubmit}
        disabled={!isValid || submitting}
        className="h-13 rounded-xl bg-owner-accent text-white font-bold disabled:opacity-50"
        style={{ height: 52 }}
        data-testid="walkin-save"
      >
        {submitting ? "Saving…" : "Save booking"}
      </button>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  mono,
  testId,
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  mono?: boolean;
  testId?: string;
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-owner-ink-muted">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        data-testid={testId}
        className={`h-12 px-3.5 rounded-lg border outline-none text-sm ${mono ? "font-mono" : ""} ${error ? "border-red-400" : "border-owner-border"}`}
      />
      {error ? <span className="text-[12px] font-semibold" style={{ color: "#8C3823" }}>{error}</span> : null}
    </div>
  );
}
