import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, pktDateString, weekOf } from "@court-booking/types";

import { api } from "@/lib/api";
import { ApiError } from "@court-booking/api-client";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatDateString, formatPKR, formatSlotTimes } from "@/lib/format";
import { DurationSheet } from "./duration-sheet";
import { CourtMonthCalendar } from "./court-month-calendar";

const STATUS_META: Record<string, { label: string; color: string }> = {
  available: { label: "OPEN", color: "#1F7A52" },
  held: { label: "PAYMENT PENDING", color: "#B5730B" },
  payment_submitted: { label: "PAYMENT PENDING", color: "#B5730B" },
  booked: { label: "BOOKED", color: "#7A7068" },
  blocked: { label: "UNAVAILABLE", color: "#7A7068" },
};

/**
 * The popup a tapped calendar date opens (Section 32 Part 4b UPDATE), scoped to ONE court: a Monday-first week
 * strip for quick day switching, that day's slot list below it, and a back arrow that returns to a month view
 * (without closing the popup) so the player can jump to any other date without leaving the popup.
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
  const queryClient = useQueryClient();
  const [view, setView] = useState<"day" | "month">("day");
  const [date, setDate] = useState(initialDate);
  const [pickingIndex, setPickingIndex] = useState<number | null>(null);
  const [joiningKey, setJoiningKey] = useState<string | null>(null);

  const today = pktDateString();
  const tomorrow = addDays(today, 1);
  const week = useMemo(() => weekOf(date), [date]);

  function tabLabel(d: string) {
    if (d === today) return "TODAY";
    if (d === tomorrow) return "TMRW";
    return formatDateString(d).split(",")[0].toUpperCase();
  }

  const waitlistQuery = useQuery({ queryKey: ["waitlist-mine"], queryFn: () => api.waitlist.mine() });
  const joinedKeys = new Set(
    (waitlistQuery.data ?? []).filter((e) => e.is_active).map((e) => `${e.court_id}|${e.slot_starts_at}`),
  );

  const dayQuery = useQuery({
    queryKey: ["court-availability", courtId, date],
    queryFn: () => api.availability.forCourtOnDate(courtId, date),
  });
  const slots = dayQuery.data?.slots ?? [];

  async function handleJoinWaitlist(slotStartsAt: string) {
    const key = `${courtId}|${slotStartsAt}`;
    setJoiningKey(key);
    try {
      const { position } = await api.waitlist.join({ court_id: courtId, slot_starts_at: slotStartsAt });
      await queryClient.invalidateQueries({ queryKey: ["waitlist-mine"] });
      Alert.alert("You're on the list", `We'll let you know if this slot opens up — you're #${position} in line.`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        await queryClient.invalidateQueries({ queryKey: ["waitlist-mine"] });
      } else {
        Alert.alert("Couldn't join the waitlist", friendlyErrorMessage(e));
      }
    } finally {
      setJoiningKey(null);
    }
  }

  function handleTapSlot(index: number, mineBookingId: string | null) {
    const slot = slots[index];
    if (mineBookingId) {
      onClose();
      router.push({ pathname: slot.status === "booked" ? "/(player)/booking/[id]/done" : "/(player)/booking/[id]/pay", params: { id: mineBookingId } });
      return;
    }
    if (slot.status === "blocked") {
      Alert.alert("Unavailable", slot.reason ?? "The venue has blocked this time.");
      return;
    }
    if (slot.status !== "available") {
      Alert.alert(
        slot.status === "booked" ? "Booked" : "Payment pending",
        slot.status === "booked" ? "This time is already booked. Tap Notify me to hear if it opens up." : "Another player is paying for this time. If they don't finish, it opens up again.",
      );
      return;
    }
    setPickingIndex(index);
  }

  function handleContinue(choice: { slotCount: number; minutes: number; price: number }) {
    if (pickingIndex === null) return;
    const startsAt = slots[pickingIndex].starts_at;
    setPickingIndex(null);
    onClose();
    router.push({
      pathname: "/(player)/booking/[id]/chat",
      params: {
        id: "new",
        venueId,
        venueName,
        courtId,
        courtName,
        startsAt,
        price: String(choice.price),
        slotCount: String(choice.slotCount),
        minutes: String(choice.minutes),
      },
    });
  }

  return (
    <>
      <Modal transparent animationType="slide" onRequestClose={onClose}>
        <Pressable className="flex-1 justify-end" style={{ backgroundColor: "rgba(0,0,0,0.4)" }} onPress={onClose}>
          <Pressable className="bg-player-surface rounded-t-3xl px-5 pt-5 pb-8 gap-4" style={{ maxHeight: "86%" }} onPress={(e) => e.stopPropagation?.()}>
            <View className="flex-row items-center justify-between">
              {view === "day" ? (
                <Pressable onPress={() => setView("month")} accessibilityLabel="Back to month view" className="w-11 h-11 rounded-xl bg-player-surface-2 items-center justify-center">
                  <Text className="font-figtree-bold text-player-ink text-base">‹</Text>
                </Pressable>
              ) : (
                <View className="w-11" />
              )}
              <Text className="font-figtree-bold text-player-ink text-[15px]">{courtName}</Text>
              <Pressable onPress={onClose} accessibilityLabel="Close" className="w-11 h-11 rounded-xl bg-player-surface-2 items-center justify-center">
                <Text className="font-figtree-bold text-player-ink text-base">✕</Text>
              </Pressable>
            </View>

            {view === "month" ? (
              <ScrollView>
                <CourtMonthCalendar
                  courtId={courtId}
                  onSelectDate={(d) => {
                    setDate(d);
                    setView("day");
                  }}
                />
              </ScrollView>
            ) : (
              <>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
                  {week.map((d) => {
                    const isPast = d < today;
                    return (
                      <Pressable
                        key={d}
                        disabled={isPast}
                        onPress={() => setDate(d)}
                        className="items-center gap-0.5 rounded-xl py-2.5"
                        style={{ minWidth: 52, backgroundColor: d === date ? "#EF5A2C" : "#F4EFEC", opacity: isPast ? 0.4 : 1 }}
                      >
                        <Text className="font-figtree-semibold text-[10px] tracking-[0.06em]" style={{ color: d === date ? "rgba(255,255,255,0.85)" : "#5C544D" }}>
                          {tabLabel(d)}
                        </Text>
                        <Text className="font-mono-semibold text-[17px]" style={{ color: d === date ? "#FFFFFF" : "#5C544D" }}>
                          {String(Number(d.slice(8))).padStart(2, "0")}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>

                {dayQuery.isLoading ? (
                  <View className="py-10 items-center">
                    <ActivityIndicator color="#EF5A2C" />
                  </View>
                ) : (
                  <ScrollView contentContainerClassName="gap-2.5 pb-2">
                    {slots.length === 0 ? (
                      <Text className="font-figtree-medium text-player-ink-faint text-sm text-center py-8">Closed this day.</Text>
                    ) : (
                      slots.map((slot, slotIndex) => {
                        const mineBookingId =
                          slot.is_mine && slot.booking_id && (slot.status === "booked" || slot.status === "held" || slot.status === "payment_submitted")
                            ? slot.booking_id
                            : null;
                        const meta = mineBookingId
                          ? slot.status === "booked"
                            ? { label: "YOUR BOOKING", color: "#1F7A52" }
                            : { label: "PAYMENT PENDING", color: "#B5730B" }
                          : STATUS_META[slot.status] ?? STATUS_META.blocked;
                        const waitlistKey = `${courtId}|${slot.starts_at}`;
                        const isOnWaitlist = joinedKeys.has(waitlistKey);
                        const isJoining = joiningKey === waitlistKey;
                        const dividerBefore = slot.after_midnight && !slots[slotIndex - 1]?.after_midnight;
                        return (
                          <View key={slot.starts_at} className="gap-2.5">
                            {dividerBefore ? (
                              <Text className="font-figtree-bold text-player-ink-fainter text-[10.5px] tracking-[0.14em]">AFTER MIDNIGHT</Text>
                            ) : null}
                            <Pressable
                              onPress={() => handleTapSlot(slotIndex, mineBookingId)}
                              className="flex-row items-center justify-between px-4 py-3.5 rounded-[14px]"
                              style={{
                                backgroundColor: mineBookingId ? "#EAF5EF" : slot.status === "available" ? "#FFFFFF" : "#F4EFEC",
                                borderWidth: 1.5,
                                borderColor: slot.status === "available" ? "#E5DED8" : "transparent",
                                opacity: slot.status === "blocked" ? 0.6 : 1,
                              }}
                            >
                              <View className="gap-0.5">
                                <Text className="font-mono-semibold text-player-ink text-[15px] -tracking-[0.1px]">{formatSlotTimes(slot)}</Text>
                                <Text className="font-figtree-semibold text-[11px] tracking-[0.04em]" style={{ color: meta.color }}>
                                  {meta.label}
                                </Text>
                              </View>
                              <View className="flex-row items-center gap-2.5">
                                {slot.status === "booked" && !mineBookingId ? (
                                  <Pressable
                                    disabled={isOnWaitlist || isJoining}
                                    onPress={(e) => {
                                      e.stopPropagation?.();
                                      handleJoinWaitlist(slot.starts_at);
                                    }}
                                    className="px-3 h-8 rounded-full items-center justify-center"
                                    style={{ backgroundColor: isOnWaitlist ? "#F4EFEC" : "#FFF3EE" }}
                                  >
                                    <Text className="font-figtree-bold text-[11px]" style={{ color: isOnWaitlist ? "#7A7068" : "#C8431C" }}>
                                      {isJoining ? "…" : isOnWaitlist ? "On waitlist" : "Notify me"}
                                    </Text>
                                  </Pressable>
                                ) : null}
                                {slot.status === "available" ? (
                                  <Text className="font-mono-semibold text-player-ink text-[15px]">PKR {formatPKR(slot.price)}</Text>
                                ) : null}
                              </View>
                            </Pressable>
                          </View>
                        );
                      })
                    )}
                  </ScrollView>
                )}
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

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
