import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react-native";
import { ApiError } from "@court-booking/api-client";
import { addDays, durationChoices, formatDuration, isValidPkMobile, minSlotsFor, walkinSlots } from "@court-booking/types";
import { palette, radius, space, type SlotChipState } from "@court-booking/ui-tokens";
import { ActionBar, Banner, Button, Checkbox, Chip, IconButton, Input, Screen, Skeleton, SlotChip, Text } from "@/components/ui";

import { courtLabel } from "@/components/court-label";
import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR, formatTime, formatTimeRange, pktDateString, pktDayTabs } from "@/lib/format";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { useMyPermissions } from "@/lib/use-my-permissions";
import { invalidateOwnerMoney } from "@/lib/owner-cache";
import { NoAccess } from "@/components/no-access";
import { BottomSheet } from "@/components/overview/ui";
import { ownerBack } from "./_fl";

/**
 * OWalkin frame 1 "Walk-in booking" (the "+" FAB). Section 32 Part 4c: a fixed 30-minute grid, and a booking is several
 * slots in a row. Tap the first slot, then a later slot (or "+ 30 min") to stretch it; the court's minimum booking time is
 * selected for you. The total comes from the server's quote, and Save creates ONE booking (POST /bookings/walkin). Name is
 * required; the phone is optional and links the booking to an existing account when it matches one.
 *
 * No walk-ins in the past: days start at TODAY (Pakistan calendar day) and, for today, slots that have already ended are not
 * offered (`walkinSlots`); the slot in progress still is. The server enforces the same rule (WALKIN_IN_PAST).
 * The board's "Kaise mila?" (cash / bank / JazzCash) is NOT sent: the walk-in endpoint has no payment-method field.
 */
export default function WalkInScreen() {
  const params = useLocalSearchParams<{ courtId?: string; startsAt?: string }>();
  const { activeVenue } = useOwnerVenues();
  const queryClient = useQueryClient();
  const perms = useMyPermissions();
  const courts = (activeVenue?.courts ?? []).filter((c) => c.is_active);

  const [courtId, setCourtId] = useState<string | undefined>(params.courtId);
  // the selection: the first slot's start and how many consecutive 30-minute slots
  const [startsAt, setStartsAt] = useState<string | undefined>(params.startsAt);
  const [slotCount, setSlotCount] = useState(1);
  const [playerName, setPlayerName] = useState("");
  const [playerPhone, setPlayerPhone] = useState("");
  const [phoneTouched, setPhoneTouched] = useState(false);
  // audit 2026-10-28 item 19: the owner confirms they told the player the receipt comes on WhatsApp (required)
  const [optIn, setOptIn] = useState(false);
  const [amount, setAmount] = useState("");
  const [amountTouched, setAmountTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [problem, setProblem] = useState<{ title: string; body: string } | null>(null);
  const [daySheet, setDaySheet] = useState(false);

  useEffect(() => {
    if (!courtId && courts.length > 0) setCourtId(courts[0].id);
  }, [courts, courtId]);

  // Section 29 Tier 2 Part 3: a phone booking for tomorrow is normal, so 15 Pakistan calendar days are offered.
  const nextDays = useMemo(() => pktDayTabs(15), []);
  const startDay = params.startsAt ? Math.max(0, nextDays.findIndex((d) => d.date === pktDateString(params.startsAt as string))) : 0;
  const [dateIdx, setDateIdx] = useState(startDay);
  const date = nextDays[dateIdx].date;
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
  // A start from Aaj's timeline may be written differently ("...Z" vs "+05:00"): match by instant.
  const startIndex = startsAt ? slots.findIndex((s) => Date.parse(s.starts_at) === Date.parse(startsAt)) : -1;
  const choices = startIndex >= 0 ? durationChoices(slots, startIndex, minSlots) : [];
  const selectedChoice = choices.find((c) => c.slotCount === slotCount);
  const inRange = (i: number) => startIndex >= 0 && selectedChoice !== undefined && i >= startIndex && i < startIndex + slotCount;
  const startIso = startIndex >= 0 ? slots[startIndex].starts_at : undefined;

  // arriving with a pre-picked slot (from Aaj): start with the court's minimum selected
  useEffect(() => {
    if (startIndex >= 0 && !selectedChoice && choices.length > 0) setSlotCount(choices[0].slotCount);
  }, [startIndex, selectedChoice, choices]);

  function reset() {
    setStartsAt(undefined);
    setSlotCount(1);
    setAmount("");
    setAmountTouched(false);
  }

  /** The first tap starts a booking (court minimum already selected); a later tap on a slot reachable without a gap or a
   * taken slot in between stretches the booking to it; anything else starts over at the tapped slot. */
  function handleTapSlot(index: number) {
    const slot = slots[index];
    if (slot.status !== "available") return;
    setProblem(null);
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
      setProblem({ title: "Itna waqt nahi", body: `Is court ki kam se kam booking ${formatDuration(minSlots * 30, "ru")} hai; is waqt se itne khaali slots lagatar nahi.` });
      return;
    }
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
    queryKey: ["booking-quote", courtId, startIso, slotCount],
    queryFn: () => api.availability.quote(courtId!, startIso!, slotCount),
    placeholderData: undefined,
    enabled: !!courtId && !!startIso && !!selectedChoice,
  });
  const quote = quoteQuery.data;

  // Prefill "amount collected" with the quoted total until the owner types their own figure.
  useEffect(() => {
    if (quote && !amountTouched) setAmount(String(Math.round(quote.price)));
  }, [quote, amountTouched]);

  // audit 2026-10-28 item 19: the player's mobile is required (the receipt goes there)
  const phoneOk = isValidPkMobile(playerPhone);
  const nameOk = playerName.trim().length > 0;
  const paid = amount === "" ? null : Number(amount);
  const isValid = !!courtId && !!startIso && !!selectedChoice && !!quote && nameOk && phoneOk && optIn && paid !== null && paid >= 0;
  const baqi = quote && paid !== null ? Math.max(0, Math.round(quote.price) - paid) : null;

  async function handleSubmit() {
    if (!isValid || !courtId || !startIso) {
      setProblem({ title: "Thora baqi hai", body: "Court, waqt, player ka naam aur sahi mobile number dalein, aur WhatsApp rasid wala tick lagayein." });
      return;
    }
    setSubmitting(true);
    setProblem(null);
    try {
      await api.bookings.walkin({
        court_id: courtId,
        starts_at: startIso,
        slot_count: slotCount,
        player_name: playerName.trim(),
        player_phone: playerPhone.trim(),
        whatsapp_opt_in: optIn,
        amount_paid: Number(amount),
      });
      // Aaj, ledger, history and badges all show the new booking at once (the old ["owner-today"] key was dead).
      await Promise.all([invalidateOwnerMoney(queryClient), queryClient.invalidateQueries({ queryKey: ["court-availability"] })]);
      ownerBack();
    } catch (e) {
      if (e instanceof ApiError && e.code === "SLOT_ALREADY_TAKEN") {
        setProblem({ title: "Ye waqt abhi abhi le liya gaya", body: "Is waqt ka kuch hissa abhi book ho gaya. Doosra waqt chunein." });
        reset();
        availabilityQuery.refetch();
      } else if (e instanceof ApiError && e.code === "WALKIN_IN_PAST") {
        setProblem({ title: "Ye waqt guzar gaya", body: e.message || friendlyErrorMessage(e) });
        reset();
        setNowMs(Date.now());
      } else {
        setProblem({ title: "Booking save nahi hui", body: friendlyErrorMessage(e) });
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (perms.settled && !perms.can("walkin")) return <NoAccess what="Walk-in booking" />;

  const dayLabel = (i: number) => (i === 0 ? "Aaj" : i === 1 ? "Kal" : `${nextDays[i].weekday} ${nextDays[i].day}`);
  const quickDays = [0, 1, 2];
  const chipState = (i: number): SlotChipState => {
    const s = slots[i];
    if (s.status === "booked") return "booked";
    if (s.status === "held" || s.status === "payment_submitted") return "held";
    if (s.status === "blocked") return "blocked";
    if (startIndex === i) return "selected";
    if (inRange(i)) return "inRange";
    if (startIndex < 0 && durationChoices(slots, i, minSlots).length === 0) return "noRoom";
    return "open";
  };

  return (
    <Screen
      keyboard
      floatingBar="bar"
      testID="walkin-screen"
      overlay={
        <ActionBar caption={selectedChoice && startIso ? `${court ? courtLabel(court.name, court.sport) : ""} · ${dayLabel(dateIdx)} ${formatTimeRange(startIso, selectedChoice.endsAt)}${baqi !== null ? ` · Baqi ${formatPKR(baqi)}` : ""}` : "Waqt chunein"} value={quote ? `PKR ${formatPKR(quote.price)}` : undefined}>
          <Button label="Booking save" size="md" onPress={handleSubmit} loading={submitting} disabled={!isValid} testID="walkin-save" />
        </ActionBar>
      }
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <IconButton icon={X} accessibilityLabel="Band karein" onPress={ownerBack} />
        <Text variant="h2" accessibilityRole="header" style={{ flex: 1 }}>
          Walk-in booking
        </Text>
      </View>

      <View style={{ backgroundColor: palette.white, borderRadius: radius.card, padding: space[4], gap: space[4] }}>
        <View style={{ gap: space[2] }}>
          <Text variant="bodyBold">Court</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
            {courts.map((c) => (
              <Chip
                key={c.id}
                shape="tile"
                label={courtLabel(c.name, c.sport)}
                selected={courtId === c.id}
                onPress={() => {
                  setCourtId(c.id);
                  reset();
                }}
                style={{ flexGrow: 1, flexBasis: 130 }}
              />
            ))}
          </View>
        </View>

        <View style={{ gap: space[2] }}>
          <Text variant="bodyBold">Din</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {quickDays.map((i) => (
              <Chip
                key={i}
                shape="tile"
                label={dayLabel(i)}
                selected={dateIdx === i}
                onPress={() => {
                  setDateIdx(i);
                  reset();
                }}
                style={{ flexGrow: 1, flexBasis: 70 }}
              />
            ))}
            <Chip shape="tile" label={dateIdx > 2 ? dayLabel(dateIdx) : "Tareekh"} selected={dateIdx > 2} onPress={() => setDaySheet(true)} style={{ flexGrow: 1, flexBasis: 70 }} />
          </View>
        </View>

        <View style={{ gap: space[2] }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: space[2] }}>
            <Text variant="bodyBold">Waqt (khaali)</Text>
            {selectedChoice && startIso ? (
              <Text variant="meta" tone="muted">{`${formatTimeRange(startIso, selectedChoice.endsAt)} chuna`}</Text>
            ) : null}
          </View>
          <Text variant="caption" tone="muted">
            {`Pehla slot dabayein, phir baad wala (ya + 30 min) lambi booking ke liye. Is court ki kam se kam booking: ${formatDuration(minSlots * 30, "ru")}.`}
          </Text>
          {availabilityQuery.isLoading ? (
            <Skeleton height={48} r={radius.md} />
          ) : slots.length === 0 ? (
            <Text variant="meta" tone="muted">
              Is din koi slot nahi (band hai ya sab guzar gaye).
            </Text>
          ) : (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {slots.map((slot, i) => (
                <SlotChip key={slot.starts_at} state={chipState(i)} label={formatTime(slot.starts_at)} reason={slot.reason} onPress={() => handleTapSlot(i)} style={{ flexGrow: 1, flexBasis: 92 }} />
              ))}
            </View>
          )}
          {selectedChoice && startIso ? (
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: space[3], borderRadius: radius.md, padding: space[3], backgroundColor: palette.tealTint }}>
              <View style={{ gap: 2 }}>
                <Text variant="bodyStrong">{formatTimeRange(startIso, selectedChoice.endsAt)}</Text>
                <Text variant="caption" tone="muted">{`${formatDuration(selectedChoice.minutes, "ru")} · ${slotCount} slot`}</Text>
              </View>
              <View style={{ flexDirection: "row", gap: space[2] }}>
                <Button label="− 30 min" variant="soft" size="sm" onPress={() => step(-1)} disabled={!choices.some((c) => c.slotCount === slotCount - 1)} />
                <Button label="+ 30 min" variant="soft" size="sm" onPress={() => step(1)} disabled={!choices.some((c) => c.slotCount === slotCount + 1)} />
              </View>
            </View>
          ) : null}
        </View>
      </View>

      <View style={{ backgroundColor: palette.white, borderRadius: radius.card, padding: space[4], gap: 14 }}>
        <Input label="Player ka naam" value={playerName} onChangeText={setPlayerName} placeholder="Usman Tariq" testID="walkin-name" />
        <Input
          label="Player ka mobile number"
          value={playerPhone}
          onChangeText={setPlayerPhone}
          onBlur={() => setPhoneTouched(true)}
          placeholder="0333 5119042"
          keyboardType="phone-pad"
          help="Zaroori: rasid is number par jayegi. Agar ye number Khelo par hai to booking us player ke account se jur jayegi."
          error={phoneTouched && !phoneOk ? "Sahi mobile number likhein, jaise 0333 5119042" : null}
          testID="walkin-phone"
        />
        <Checkbox checked={optIn} onChange={setOptIn} label="Player ko bata diya ke WhatsApp par rasid aayegi" testID="walkin-optin" />
        {!optIn ? (
          <Text variant="caption" tone="danger">
            Ye tick zaroori hai.
          </Text>
        ) : null}
        <Input
          label="Kitna mila (PKR)"
          value={amount}
          onChangeText={(v) => {
            setAmountTouched(true);
            setAmount(v.replace(/\D/g, ""));
          }}
          keyboardType="number-pad"
          placeholder="4000"
          help={quote ? `Total ${formatPKR(quote.price)} · Baqi ${formatPKR(baqi ?? Math.round(quote.price))}` : quoteQuery.isError ? undefined : "Waqt chunne par court ki qeemat yahan aa jayegi."}
          error={quoteQuery.isError ? friendlyErrorMessage(quoteQuery.error) : null}
          testID="walkin-amount"
        />
        <Text variant="caption" tone="muted">
          Abhi kuch nahi mila to 0 likhein; baqi venue par Paisa aur booking detail mein dikhega.
        </Text>
      </View>

      {problem ? <Banner tone="danger" title={problem.title} body={problem.body} testID="walkin-problem" /> : null}
      {/* the save bar wraps to two lines at 320 pt + large font: keep the last field clear of it */}
      <View style={{ height: space[8] * 2 }} />

      {daySheet ? (
        <BottomSheet title="Din chunein" subtitle="Aaj se 15 din tak" onClose={() => setDaySheet(false)}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
            {nextDays.map((d, i) => (
              <Chip
                key={d.date}
                shape="tile"
                label={dayLabel(i)}
                meta={`${d.day} ${d.month}`}
                selected={dateIdx === i}
                onPress={() => {
                  setDateIdx(i);
                  reset();
                  setDaySheet(false);
                }}
                style={{ flexGrow: 1, flexBasis: 88 }}
              />
            ))}
          </View>
        </BottomSheet>
      ) : null}
    </Screen>
  );
}

