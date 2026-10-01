import { useEffect, useMemo, useState } from "react";
import { courtLabel } from "@/components/court-label";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { ApiError } from "@court-booking/api-client";
import { durationChoices, formatDuration, isValidPkMobile, minSlotsFor } from "@court-booking/types";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR, formatTime, formatTimeRange, pktDayTabs } from "@/lib/format";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { ChevronLeftIcon } from "@/components/icons";
import { Chip, FieldLabel, PrimaryButton, TextField } from "./venue-setup/_components";

/**
 * "Add a booking" (walk-in / phone / regular). Section 32 Part 4c: a fixed 30-minute grid, and a booking is several slots in
 * a row. Tap the first slot, then a later slot (or "+ 30 min") to stretch the booking to it; the court's minimum booking
 * time is selected for you and cannot be shortened below it. The total comes from the server's quote, and Save creates ONE
 * booking. The customer's name is required; the phone is optional and links the booking to an existing account when it
 * matches one (otherwise the name lives on the booking).
 */
export default function WalkInScreen() {
  const params = useLocalSearchParams<{ courtId?: string; startsAt?: string }>();
  const { activeVenue } = useOwnerVenues();
  const queryClient = useQueryClient();
  const courts = (activeVenue?.courts ?? []).filter((c) => c.is_active);

  const [courtId, setCourtId] = useState<string | undefined>(params.courtId);
  // the selection: the first slot's start and how many consecutive 30-minute slots
  const [startsAt, setStartsAt] = useState<string | undefined>(params.startsAt);
  const [slotCount, setSlotCount] = useState(1);
  const [playerName, setPlayerName] = useState("");
  const [playerPhone, setPlayerPhone] = useState("");
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [amount, setAmount] = useState("");
  const [amountTouched, setAmountTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!courtId && courts.length > 0) setCourtId(courts[0].id);
  }, [courts, courtId]);

  // Section 29 Tier 2 Part 3: a walk-in used to always book against today only -- an owner
  // taking a phone booking for tomorrow (a completely normal case) had no way to do it here.
  const next7Days = useMemo(
    () => pktDayTabs(7), // Pakistan calendar days, not the UTC date
    [],
  );
  const [dateIdx, setDateIdx] = useState(0);
  const date = next7Days[dateIdx].date;
  const availabilityQuery = useQuery({
    queryKey: ["court-availability", courtId, date],
    queryFn: () => api.availability.forCourtOnDate(courtId!, date),
    placeholderData: undefined,
    enabled: !!courtId,
  });

  const slots = availabilityQuery.data?.slots ?? [];
  const court = courts.find((c) => c.id === courtId);
  const minSlots = minSlotsFor(availabilityQuery.data?.min_booking_minutes ?? court?.slot_minutes ?? 60);
  const startIndex = startsAt ? slots.findIndex((s) => s.starts_at === startsAt) : -1;
  const choices = startIndex >= 0 ? durationChoices(slots, startIndex, minSlots) : [];
  const selectedChoice = choices.find((c) => c.slotCount === slotCount);
  const inRange = (i: number) => startIndex >= 0 && selectedChoice !== undefined && i >= startIndex && i < startIndex + slotCount;

  // arriving with a pre-picked slot (from Today): start with the court's minimum selected
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
      Alert.alert("Too short", `That start can't fit this court's minimum booking of ${formatDuration(minSlots * 30)} in a row.`);
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
    if (!isValid || !courtId || !startsAt) {
      Alert.alert("Almost there", "Pick a court, a time, and enter the customer's name (and a valid phone if you add one).");
      return;
    }
    setSubmitting(true);
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
      router.back();
    } catch (e) {
      if (e instanceof ApiError && e.code === "SLOT_ALREADY_TAKEN") {
        Alert.alert("Time just taken", "Part of that time was just booked. Pick another.");
        reset();
        availabilityQuery.refetch();
      } else {
        Alert.alert("Couldn't save booking", friendlyErrorMessage(e));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-owner-bg" edges={["top", "bottom"]}>
      <View className="px-4.5 py-5 bg-owner-surface border-b border-owner-border flex-row items-center gap-3">
        <Pressable onPress={() => router.back()} className="w-11 h-11 rounded-[10px] bg-owner-bg items-center justify-center">
          <ChevronLeftIcon />
        </Pressable>
        <View className="gap-0.5">
          <Text className="font-plex-bold text-owner-ink text-[16.5px] -tracking-[0.2px]">Add a booking</Text>
          <Text className="font-plex-medium text-owner-ink-faint text-[12.5px]">Walk-in, phone call or regular</Text>
        </View>
      </View>

      <ScrollView className="flex-1" contentContainerClassName="px-4.5 pt-4.5 pb-8 gap-5" keyboardShouldPersistTaps="handled">
        <View className="gap-2">
          <FieldLabel>Court</FieldLabel>
          <View className="flex-row flex-wrap gap-2">
            {courts.map((c) => (
              <Chip
                key={c.id}
                label={courtLabel(c.name, c.sport)}
                selected={courtId === c.id}
                onPress={() => {
                  setCourtId(c.id);
                  reset();
                }}
              />
            ))}
          </View>
        </View>

        <View className="gap-2">
          <FieldLabel>Date</FieldLabel>
          <View className="flex-row flex-wrap gap-2">
            {next7Days.map((d, i) => (
              <Pressable
                key={i}
                onPress={() => {
                  setDateIdx(i);
                  reset();
                }}
                className="px-3.5 rounded-[10px] items-center justify-center"
                style={{ minHeight: 46, backgroundColor: dateIdx === i ? "#0E6274" : "#FFFFFF", borderWidth: dateIdx === i ? 0 : 1, borderColor: "#DCE3E6" }}
              >
                <Text className="font-plex-semibold text-[13px]" style={{ color: dateIdx === i ? "#FFFFFF" : "#101C21" }}>
                  {i === 0 ? "Today" : i === 1 ? "Tomorrow" : `${d.weekday} ${d.day}`}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View className="gap-2">
          <FieldLabel>Time</FieldLabel>
          <Text className="font-plex-medium text-owner-ink-faint text-[12.5px]">
            Tap the first slot, then a later slot (or + 30 min) to book several in a row. Minimum for this court: {formatDuration(minSlots * 30)}.
          </Text>
          {availabilityQuery.isLoading ? (
            <ActivityIndicator color="#0E6274" />
          ) : (
            <View className="flex-row flex-wrap gap-2">
              {slots.map((slot, i) => {
                const takenOrPast = slot.status !== "available";
                const selected = inRange(i);
                const cannotStart = !takenOrPast && !selected && startIndex < 0 && durationChoices(slots, i, minSlots).length === 0;
                return (
                  <Pressable
                    key={slot.starts_at}
                    disabled={takenOrPast}
                    onPress={() => handleTapSlot(i)}
                    className="px-4 rounded-[10px] items-center justify-center"
                    style={{
                      minHeight: 46,
                      backgroundColor: selected ? "#0E6274" : takenOrPast ? "#EFF2F3" : "#FFFFFF",
                      borderWidth: selected ? 0 : 1,
                      borderColor: "#DCE3E6",
                    }}
                  >
                    <Text
                      className="font-mono-semibold text-[13.5px]"
                      style={{
                        color: selected ? "#FFFFFF" : takenOrPast ? "#A6B6BC" : cannotStart ? "#8FA1A8" : "#101C21",
                        textDecorationLine: takenOrPast ? "line-through" : "none",
                      }}
                    >
                      {formatTime(slot.starts_at)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
          {selectedChoice && startsAt ? (
            <View className="flex-row items-center justify-between gap-3 rounded-[10px] px-3.5 py-3" style={{ backgroundColor: "#E8F2F4" }}>
              <View>
                <Text className="font-mono-semibold text-owner-ink text-[14px]">{formatTimeRange(startsAt, selectedChoice.endsAt)}</Text>
                <Text className="font-plex-medium text-owner-ink-faint text-[12.5px]">
                  {formatDuration(selectedChoice.minutes)} · {slotCount} slot{slotCount === 1 ? "" : "s"}
                </Text>
              </View>
              <View className="flex-row gap-2">
                <Pressable
                  onPress={() => step(-1)}
                  disabled={!choices.some((c) => c.slotCount === slotCount - 1)}
                  className="px-3 rounded-[10px] items-center justify-center bg-white"
                  style={{ minHeight: 40, borderWidth: 1, borderColor: "#DCE3E6", opacity: choices.some((c) => c.slotCount === slotCount - 1) ? 1 : 0.4 }}
                >
                  <Text className="font-plex-bold text-owner-ink text-[13px]">− 30 min</Text>
                </Pressable>
                <Pressable
                  onPress={() => step(1)}
                  disabled={!choices.some((c) => c.slotCount === slotCount + 1)}
                  className="px-3 rounded-[10px] items-center justify-center bg-white"
                  style={{ minHeight: 40, borderWidth: 1, borderColor: "#DCE3E6", opacity: choices.some((c) => c.slotCount === slotCount + 1) ? 1 : 0.4 }}
                >
                  <Text className="font-plex-bold text-owner-ink text-[13px]">+ 30 min</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>

        <View className="gap-3">
          <FieldLabel>Who</FieldLabel>
          <TextField label="Customer name" value={playerName} onChangeText={setPlayerName} placeholder="Usman Tariq" />
          <TextField
            label="Customer phone (optional)"
            value={playerPhone}
            onChangeText={setPlayerPhone}
            onBlur={() => setPhoneTouched(true)}
            placeholder="0333 5119042"
            keyboardType="phone-pad"
            mono
            error={phoneTouched && !phoneOk ? "Enter a valid mobile number, e.g. 0333 5119042" : undefined}
          />
        </View>

        <TextField
          label="Amount collected (PKR)"
          value={amount}
          onChangeText={(v) => {
            setAmountTouched(true);
            setAmount(v.replace(/\D/g, ""));
          }}
          keyboardType="number-pad"
          placeholder="4000"
          mono
        />
        {quote ? (
          <Text className="-mt-3 font-plex-medium text-owner-ink-faint text-[12.5px]">
            Court price for {formatDuration(quote.duration_minutes)}: PKR {formatPKR(quote.price)}
          </Text>
        ) : quoteQuery.isError ? (
          <Text className="-mt-3 font-plex-semibold text-[12.5px]" style={{ color: "#C13525" }}>{friendlyErrorMessage(quoteQuery.error)}</Text>
        ) : null}
      </ScrollView>

      <View className="px-4.5 pt-3.5 pb-6 bg-owner-surface border-t border-owner-border">
        <PrimaryButton label="Save booking" onPress={handleSubmit} loading={submitting} disabled={!isValid} />
      </View>
    </SafeAreaView>
  );
}
