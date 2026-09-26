import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, monthOf, pktDateString, weekOf } from "@court-booking/types";
import type { DaySummaryState } from "@court-booking/types";

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

// Day-state dot colours for the week strip (match the calendar + the approved mockup).
const DOW_DOT: Partial<Record<DaySummaryState, string>> = { open: "#1E9E5A", few: "#D6900A", full: "#C43A3A" };

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

  // Drives the availability dot on each week-strip pill; shares the calendar's query key so it's already cached.
  const monthSummaryQuery = useQuery({
    queryKey: ["court-month-summary", courtId, monthOf(date)],
    queryFn: () => api.availability.monthSummary(courtId, monthOf(date)),
  });
  const stateByDate = new Map((monthSummaryQuery.data?.days ?? []).map((d) => [d.date, d.state]));

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
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-1.5">
                  {week.map((d) => {
                    const isPast = d < today;
                    const selected = d === date;
                    const dot = DOW_DOT[stateByDate.get(d) ?? "closed"];
                    return (
                      <Pressable
                        key={d}
                        disabled={isPast}
                        onPress={() => setDate(d)}
                        className="items-center gap-1 rounded-xl py-2.5"
                        style={{
                          minWidth: 50,
                          backgroundColor: selected ? "#EF5A2C" : "#FFFFFF",
                          borderWidth: 1,
                          borderColor: selected ? "#EF5A2C" : "#E5DED8",
                          opacity: isPast ? 0.4 : 1,
                        }}
                      >
                        <Text className="font-figtree-bold text-[10px] tracking-[0.06em] uppercase" style={{ color: selected ? "rgba(255,255,255,0.9)" : "#5C544D" }}>
                          {tabLabel(d)}
                        </Text>
                        <Text className="font-mono-semibold text-[16px]" style={{ color: selected ? "#FFFFFF" : "#141A1D" }}>
                          {String(Number(d.slice(8))).padStart(2, "0")}
                        </Text>
                        <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: selected ? (dot ? "#FFFFFF" : "transparent") : (dot ?? "transparent") }} />
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
                        const isOpen = slot.status === "available";
                        const isBooked = slot.status === "booked" && !mineBookingId;
                        const mineBadge = mineBookingId
                          ? slot.status === "booked"
                            ? { label: "YOUR BOOKING", bg: "#D6EDDE", color: "#1F7A52" }
                            : { label: "PAYMENT PENDING", bg: "#F7E4BE", color: "#9A6208" }
                          : null;
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
                              className="flex-row items-center justify-between px-3.5 py-3 rounded-xl"
                              style={{
                                backgroundColor: mineBadge ? (slot.status === "booked" ? "#EAF5EF" : "#FFF6E5") : isOpen ? "#FFFFFF" : "#F3EEE9",
                                borderWidth: 1,
                                borderColor: mineBadge ? (slot.status === "booked" ? "#BFE0CE" : "#F3DDAE") : isOpen ? "#cfe9d9" : "transparent",
                                opacity: slot.status === "blocked" ? 0.6 : 1,
                              }}
                            >
                              <Text
                                className="font-mono-semibold text-[14px]"
                                style={{ color: isOpen || mineBadge ? "#141A1D" : "#9A9791", textDecorationLine: isBooked ? "line-through" : "none" }}
                              >
                                {formatSlotTimes(slot)}
                              </Text>
                              <View className="flex-row items-center" style={{ gap: 8 }}>
                                {isBooked ? (
                                  <Pressable
                                    disabled={isOnWaitlist || isJoining}
                                    onPress={(e) => {
                                      e.stopPropagation?.();
                                      handleJoinWaitlist(slot.starts_at);
                                    }}
                                    className="px-2.5 h-7 rounded-full items-center justify-center"
                                    style={{ backgroundColor: isOnWaitlist ? "#F4EFEC" : "#FFF3EE" }}
                                  >
                                    <Text className="font-figtree-bold text-[11px]" style={{ color: isOnWaitlist ? "#7A7068" : "#C8431C" }}>
                                      {isJoining ? "…" : isOnWaitlist ? "On waitlist" : "Notify me"}
                                    </Text>
                                  </Pressable>
                                ) : null}
                                {mineBadge ? (
                                  <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: mineBadge.bg }}>
                                    <Text className="font-figtree-bold text-[10px]" style={{ color: mineBadge.color }}>{mineBadge.label}</Text>
                                  </View>
                                ) : isOpen ? (
                                  <>
                                    <Text className="font-mono-semibold text-[12px]" style={{ color: "#9A9791" }}>PKR {formatPKR(slot.price)}</Text>
                                    <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: "#E3F7EB" }}>
                                      <Text className="font-figtree-bold text-[10px]" style={{ color: "#1E9E5A" }}>Open</Text>
                                    </View>
                                  </>
                                ) : !isBooked ? (
                                  <Text className="font-figtree-bold text-[11px]" style={{ color: "#9A9791" }}>
                                    {(STATUS_META[slot.status] ?? STATUS_META.blocked).label}
                                  </Text>
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
