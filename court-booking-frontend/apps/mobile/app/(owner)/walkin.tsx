import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { ApiError } from "@court-booking/api-client";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR, formatTime, pktDayTabs } from "@/lib/format";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { ChevronLeftIcon } from "@/components/icons";
import { Chip, FieldLabel, PrimaryButton, TextField } from "./venue-setup/_components";

export default function WalkInScreen() {
  const params = useLocalSearchParams<{ courtId?: string; startsAt?: string }>();
  const { activeVenue } = useOwnerVenues();
  const queryClient = useQueryClient();
  const courts = (activeVenue?.courts ?? []).filter((c) => c.is_active);

  const [courtId, setCourtId] = useState<string | undefined>(params.courtId);
  const [startsAt, setStartsAt] = useState<string | undefined>(params.startsAt);
  const [playerName, setPlayerName] = useState("");
  const [playerPhone, setPlayerPhone] = useState("");
  const [amount, setAmount] = useState("");
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
    enabled: !!courtId,
  });

  const slots = availabilityQuery.data?.slots ?? [];
  const selectedSlot = slots.find((s) => s.starts_at === startsAt);

  useEffect(() => {
    if (selectedSlot) setAmount((prev) => (prev ? prev : String(Math.round(selectedSlot.price))));
  }, [selectedSlot]);

  const isValid = !!courtId && !!startsAt && playerName.trim().length > 0 && Number(amount) >= 0;

  async function handleSubmit() {
    if (!isValid || !courtId || !startsAt) {
      Alert.alert("Almost there", "Pick a court, a time, and enter the player's name.");
      return;
    }
    setSubmitting(true);
    try {
      await api.bookings.walkin({
        court_id: courtId,
        starts_at: startsAt,
        player_name: playerName.trim(),
        player_phone: playerPhone.trim() || undefined,
        amount_paid: Number(amount),
      });
      await queryClient.invalidateQueries({ queryKey: ["owner-today"] });
      router.back();
    } catch (e) {
      if (e instanceof ApiError && e.code === "SLOT_ALREADY_TAKEN") {
        Alert.alert("Slot just taken", "This slot was just booked through the app — pick another one.");
        setStartsAt(undefined);
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

      <ScrollView className="flex-1" contentContainerClassName="px-4.5 pt-4.5 pb-8 gap-5">
        <View className="gap-2">
          <FieldLabel>Court</FieldLabel>
          <View className="flex-row flex-wrap gap-2">
            {courts.map((c) => (
              <Chip
                key={c.id}
                label={c.name}
                selected={courtId === c.id}
                onPress={() => {
                  setCourtId(c.id);
                  setStartsAt(undefined);
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
                  setStartsAt(undefined);
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
          {availabilityQuery.isLoading ? (
            <ActivityIndicator color="#0E6274" />
          ) : (
            <View className="flex-row flex-wrap gap-2">
              {slots.map((slot) => {
                const takenOrPast = slot.status !== "available";
                const selected = startsAt === slot.starts_at;
                return (
                  <Pressable
                    key={slot.starts_at}
                    disabled={takenOrPast}
                    onPress={() => setStartsAt(slot.starts_at)}
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
                        color: selected ? "#FFFFFF" : takenOrPast ? "#A6B6BC" : "#101C21",
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
        </View>

        <View className="gap-3">
          <FieldLabel>Who</FieldLabel>
          <TextField label="Player name" value={playerName} onChangeText={setPlayerName} placeholder="Usman Tariq" />
          <TextField
            label="Player phone (optional)"
            value={playerPhone}
            onChangeText={setPlayerPhone}
            placeholder="0333 5119042"
            keyboardType="phone-pad"
            mono
          />
        </View>

        <TextField
          label="Amount collected (PKR)"
          value={amount}
          onChangeText={(v) => setAmount(v.replace(/\D/g, ""))}
          keyboardType="number-pad"
          placeholder="4000"
          mono
        />
        {selectedSlot ? (
          <Text className="-mt-3 font-plex-medium text-owner-ink-faint text-[12.5px]">
            Court price for this slot: PKR {formatPKR(selectedSlot.price)}
          </Text>
        ) : null}
      </ScrollView>

      <View className="px-4.5 pt-3.5 pb-6 bg-owner-surface border-t border-owner-border">
        <PrimaryButton label="Save booking" onPress={handleSubmit} loading={submitting} disabled={!isValid} />
      </View>
    </SafeAreaView>
  );
}
