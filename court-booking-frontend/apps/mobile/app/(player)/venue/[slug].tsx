import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useIsFocused, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { ApiError } from "@court-booking/api-client";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatDistance, formatPKR, formatSlotTimes, pktDayTabs } from "@/lib/format";
import { formatDuration } from "@court-booking/types";
import { DurationSheet } from "@/components/duration-sheet";
import { pollInterval } from "@/lib/polling";
import { ChevronLeftIcon, StarIcon } from "@/components/icons";
import { ErrorState } from "@/components/error-state";
import { DayTab, EmptyState, gradientFor } from "../_components";

// What each slot says. A slot somebody else holds is "Payment pending" (held, or proof under review) or "Booked" and is
// never tappable for booking; an owner blackout is "Unavailable". Times outside the court's opening hours are not in the
// list at all, so closed time is never shown as bookable.
const STATUS_META: Record<string, { label: string; color: string; tappable: boolean }> = {
  available: { label: "OPEN", color: "#1F7A52", tappable: true },
  held: { label: "PAYMENT PENDING", color: "#B5730B", tappable: false },
  payment_submitted: { label: "PAYMENT PENDING", color: "#B5730B", tappable: false },
  booked: { label: "BOOKED", color: "#7A7068", tappable: false },
  blocked: { label: "UNAVAILABLE", color: "#7A7068", tappable: false },
};

export default function VenueDetailScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const isFocused = useIsFocused();
  const queryClient = useQueryClient();
  // Pakistan calendar days -- NOT `new Date()` + `toISOString().slice(0, 10)` (the UTC date), which made the tab
  // labelled "23" query the 22nd between midnight and 5 AM in Karachi.
  const days = useMemo(() => pktDayTabs(6), []);
  const [dateIdx, setDateIdx] = useState(0);
  const [courtId, setCourtId] = useState<string | undefined>(undefined);
  const [joiningKey, setJoiningKey] = useState<string | null>(null);
  // The open slot the player tapped: the duration sheet asks how long, shows the total, then hands off to the chat.
  const [pickingIndex, setPickingIndex] = useState<number | null>(null);

  const waitlistQuery = useQuery({ queryKey: ["waitlist-mine"], queryFn: () => api.waitlist.mine() });
  const joinedKeys = new Set(
    (waitlistQuery.data ?? []).filter((e) => e.is_active).map((e) => `${e.court_id}|${e.slot_starts_at}`),
  );

  async function handleJoinWaitlist(courtIdForSlot: string, slotStartsAt: string) {
    const key = `${courtIdForSlot}|${slotStartsAt}`;
    setJoiningKey(key);
    try {
      const { position } = await api.waitlist.join({ court_id: courtIdForSlot, slot_starts_at: slotStartsAt });
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

  const venueQuery = useQuery({
    queryKey: ["venue-detail", slug],
    queryFn: () => api.venues.getBySlug(slug!),
    enabled: !!slug,
  });
  const venue = venueQuery.data;
  const courts = venue?.courts.filter((c) => c.is_active) ?? [];
  const activeCourtId = courtId ?? courts[0]?.id;
  const date = days[dateIdx].date;

  const availabilityQuery = useQuery({
    queryKey: ["venue-availability", venue?.id, date],
    queryFn: () => api.availability.forVenueOnDate(venue!.id, date),
    enabled: !!venue?.id,
    refetchInterval: (query) => (isFocused ? pollInterval(query, 15_000) : false),
  });

  const courtAvailability = availabilityQuery.data?.courts.find((c) => c.court_id === activeCourtId);
  const slots = courtAvailability?.slots ?? [];

  function handleTapSlot(index: number, mineBookingId: string | null) {
    const slot = slots[index];
    if (mineBookingId) {
      // My own booking / hold: go to it. (This used to say "someone's on it ... another player".)
      router.push({ pathname: slot.status === "booked" ? "/(player)/booking/[id]/done" : "/(player)/booking/[id]/pay", params: { id: mineBookingId } });
      return;
    }
    if (slot.status === "blocked") {
      Alert.alert("Unavailable", slot.reason ?? "The venue has blocked this time.");
      return;
    }
    if (slot.status !== "available") {
      Alert.alert(slot.status === "booked" ? "Booked" : "Payment pending", slot.status === "booked" ? "This time is already booked. Tap Notify me to hear if it opens up." : "Another player is paying for this time. If they don't finish, it opens up again.");
      return;
    }
    setPickingIndex(index);
  }

  function handleContinue(choice: { slotCount: number; minutes: number; price: number }) {
    if (pickingIndex === null) return;
    const court = courts.find((c) => c.id === activeCourtId);
    setPickingIndex(null);
    router.push({
      pathname: "/(player)/booking/[id]/chat",
      params: {
        id: "new",
        venueId: venue!.id,
        venueName: venue!.name,
        courtId: activeCourtId!,
        courtName: court?.name ?? "",
        startsAt: slots[pickingIndex].starts_at,
        price: String(choice.price),
        slotCount: String(choice.slotCount),
        minutes: String(choice.minutes),
      },
    });
  }

  if (venueQuery.isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-player-bg items-center justify-center" edges={["top", "bottom"]}>
        <ActivityIndicator color="#EF5A2C" />
      </SafeAreaView>
    );
  }

  if (!venue && venueQuery.isError) {
    return (
      <SafeAreaView className="flex-1 bg-player-bg" edges={["top", "bottom"]}>
        <ErrorState message={friendlyErrorMessage(venueQuery.error)} onRetry={() => venueQuery.refetch()} tone="player" />
      </SafeAreaView>
    );
  }

  if (!venue) {
    return (
      <SafeAreaView className="flex-1 bg-player-bg" edges={["top", "bottom"]}>
        <EmptyState title="Venue not found" subtitle="This listing may have been removed." />
      </SafeAreaView>
    );
  }

  const photos = venue.photo_urls ?? [];

  return (
    <SafeAreaView className="flex-1 bg-player-bg" edges={["top", "bottom"]}>
      {photos.length > 0 ? (
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={{ height: 180 }}>
          {photos.map((url, i) => (
            <Image key={i} source={{ uri: url }} style={{ width: 393, height: 180 }} resizeMode="cover" />
          ))}
        </ScrollView>
      ) : (
        <View className="h-[100px] items-start justify-end p-4" style={{ backgroundColor: gradientFor(venue.id) }}>
          <Text className="font-figtree-bold text-white text-[13px]" style={{ opacity: 0.85 }}>
            {venue.sports.join(" · ")}
          </Text>
        </View>
      )}
      <View className="px-5 pt-5 pb-3.5 bg-player-surface border-b border-player-border-light gap-3">
        <View className="flex-row items-center gap-3">
          <Pressable onPress={() => router.back()} className="w-11 h-11 rounded-xl bg-player-surface-2 items-center justify-center">
            <ChevronLeftIcon />
          </Pressable>
          <View className="flex-1 gap-0.5">
            <View className="flex-row items-center gap-2">
              <Text className="font-figtree-bold text-player-ink text-[18px] -tracking-[0.2px]">{venue.name}</Text>
              {venue.average_rating != null ? (
                <View className="flex-row items-center gap-1">
                  <StarIcon />
                  <Text className="font-figtree-bold text-player-ink text-[13px]">{venue.average_rating.toFixed(1)}</Text>
                </View>
              ) : null}
            </View>
            <Text className="font-figtree-medium text-player-ink-faint text-[13px]">
              {[venue.area ?? venue.city, formatDistance(venue.distance_meters)].filter(Boolean).join(" · ")}
            </Text>
          </View>
        </View>

        {courts.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
            {courts.map((c) => (
              <Pressable
                key={c.id}
                onPress={() => setCourtId(c.id)}
                className="px-4 rounded-full items-center justify-center"
                style={{ minHeight: 44, backgroundColor: activeCourtId === c.id ? "#141A1D" : "#F4EFEC" }}
              >
                <Text
                  className="font-figtree-semibold text-[13.5px]"
                  style={{ color: activeCourtId === c.id ? "#FFFFFF" : "#5C544D" }}
                >
                  {c.name}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 px-5 py-3.5 bg-player-surface border-b border-player-border-light">
        {days.map((d, i) => (
          <DayTab
            key={i}
            label={i === 0 ? "TODAY" : d.weekday.toUpperCase()}
            dayNum={String(d.day).padStart(2, "0")}
            selected={dateIdx === i}
            onPress={() => setDateIdx(i)}
          />
        ))}
      </ScrollView>

      {!activeCourtId ? (
        <EmptyState title="No active courts" subtitle="This venue hasn't published any courts yet." />
      ) : availabilityQuery.isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#EF5A2C" />
        </View>
      ) : availabilityQuery.isError && slots.length === 0 ? (
        <ErrorState message={friendlyErrorMessage(availabilityQuery.error)} onRetry={() => availabilityQuery.refetch()} tone="player" />
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="px-5 pt-4 pb-6 gap-2.5">
          {courtAvailability ? (
            <Text className="font-figtree-medium text-player-ink-faint text-[12.5px]">{formatDuration(courtAvailability.slot_minutes)} slots</Text>
          ) : null}
          {slots.map((slot, slotIndex) => {
            // My own booking or hold gets MY status, never "Notify me" (that is for a slot somebody ELSE has).
            const mineBookingId =
              slot.is_mine && slot.booking_id && (slot.status === "booked" || slot.status === "held" || slot.status === "payment_submitted")
                ? slot.booking_id
                : null;
            const meta = mineBookingId
              ? slot.status === "booked"
                ? { label: "YOUR BOOKING", color: "#1F7A52", tappable: true }
                : { label: "PAYMENT PENDING", color: "#B5730B", tappable: true }
              : STATUS_META[slot.status] ?? STATUS_META.blocked;
            const waitlistKey = `${activeCourtId}|${slot.starts_at}`;
            const isOnWaitlist = joinedKeys.has(waitlistKey);
            const isJoining = joiningKey === waitlistKey;
            // The first slot after midnight gets a small divider; those slots read "Fri 1:00 AM to 2:00 AM".
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
                  <Text className="font-mono-semibold text-player-ink text-[15px] -tracking-[0.1px]">
                    {formatSlotTimes(slot)}
                  </Text>
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
                        handleJoinWaitlist(activeCourtId!, slot.starts_at);
                      }}
                      className="px-3 h-8 rounded-full items-center justify-center"
                      style={{ backgroundColor: isOnWaitlist ? "#F4EFEC" : "#FFF3EE" }}
                    >
                      <Text
                        className="font-figtree-bold text-[11px]"
                        style={{ color: isOnWaitlist ? "#7A7068" : "#C8431C" }}
                      >
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
          })}
          {slots.length === 0 ? (
            <Text className="font-figtree-medium text-player-ink-faint text-sm text-center pt-8">Closed this day.</Text>
          ) : null}
        </ScrollView>
      )}

      {pickingIndex !== null && activeCourtId ? (
        <DurationSheet
          courtId={activeCourtId}
          courtName={courts.find((c) => c.id === activeCourtId)?.name ?? ""}
          slotMinutes={courtAvailability?.slot_minutes ?? 60}
          slots={slots}
          index={pickingIndex}
          onClose={() => setPickingIndex(null)}
          onContinue={handleContinue}
        />
      ) : null}

      <View className="px-5 pt-3.5 pb-6 bg-player-surface border-t border-player-border-light">
        <Text className="font-figtree-medium text-player-ink-faint text-[12.5px] text-center">
          Tap any open slot to book it
        </Text>
      </View>
    </SafeAreaView>
  );
}
