import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useIsFocused, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { ApiError } from "@court-booking/api-client";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatDistance, formatPKR, formatTime, toDateInputValue } from "@/lib/format";
import { pollInterval } from "@/lib/polling";
import { ChevronLeftIcon, StarIcon } from "@/components/icons";
import { ErrorState } from "@/components/error-state";
import { DayTab, EmptyState } from "../_components";

function nextDays(count: number): Date[] {
  const today = new Date();
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    return d;
  });
}

const STATUS_META: Record<string, { label: string; color: string; tappable: boolean }> = {
  available: { label: "OPEN", color: "#1F7A52", tappable: true },
  held: { label: "IN PROGRESS", color: "#9A9791", tappable: false },
  payment_submitted: { label: "AWAITING REVIEW", color: "#C8431C", tappable: false },
  booked: { label: "BOOKED", color: "#9A9791", tappable: false },
  blocked: { label: "UNAVAILABLE", color: "#9A9791", tappable: false },
};

export default function VenueDetailScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const isFocused = useIsFocused();
  const queryClient = useQueryClient();
  const days = useMemo(() => nextDays(6), []);
  const [dateIdx, setDateIdx] = useState(0);
  const [courtId, setCourtId] = useState<string | undefined>(undefined);
  const [joiningKey, setJoiningKey] = useState<string | null>(null);

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
  const date = toDateInputValue(days[dateIdx]);

  const availabilityQuery = useQuery({
    queryKey: ["venue-availability", venue?.id, date],
    queryFn: () => api.availability.forVenueOnDate(venue!.id, date),
    enabled: !!venue?.id,
    refetchInterval: (query) => (isFocused ? pollInterval(query, 15_000) : false),
  });

  const courtAvailability = availabilityQuery.data?.courts.find((c) => c.court_id === activeCourtId);
  const slots = courtAvailability?.slots ?? [];

  function handleTapSlot(status: string, slotStartsAt: string, reason: string | null, price: number) {
    if (status === "blocked") {
      Alert.alert("Not available", reason ?? "This slot is blocked by the venue.");
      return;
    }
    if (status !== "available") {
      Alert.alert("Someone's on it", "This slot is currently being booked or paid for by another player.");
      return;
    }
    const court = courts.find((c) => c.id === activeCourtId);
    router.push({
      pathname: "/(player)/booking/[id]/chat",
      params: {
        id: "new",
        venueId: venue!.id,
        venueName: venue!.name,
        courtId: activeCourtId!,
        courtName: court?.name ?? "",
        startsAt: slotStartsAt,
        price: String(price),
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

  return (
    <SafeAreaView className="flex-1 bg-player-bg" edges={["top", "bottom"]}>
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
            label={d.toLocaleDateString("en-GB", { weekday: "short" }).toUpperCase()}
            dayNum={String(d.getDate()).padStart(2, "0")}
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
          {slots.map((slot) => {
            const meta = STATUS_META[slot.status] ?? STATUS_META.blocked;
            const waitlistKey = `${activeCourtId}|${slot.starts_at}`;
            const isOnWaitlist = joinedKeys.has(waitlistKey);
            const isJoining = joiningKey === waitlistKey;
            return (
              <Pressable
                key={slot.starts_at}
                onPress={() => handleTapSlot(slot.status, slot.starts_at, slot.reason, slot.price)}
                className="flex-row items-center justify-between px-4 py-3.5 rounded-[14px]"
                style={{
                  backgroundColor: slot.status === "available" ? "#FFFFFF" : "#F4EFEC",
                  borderWidth: 1.5,
                  borderColor: slot.status === "available" ? "#E5DED8" : "transparent",
                  opacity: slot.status === "blocked" ? 0.6 : 1,
                }}
              >
                <View className="gap-0.5">
                  <Text className="font-mono-semibold text-player-ink text-[15px] -tracking-[0.1px]">
                    {formatTime(slot.starts_at)}
                  </Text>
                  <Text className="font-figtree-semibold text-[11px] tracking-[0.04em]" style={{ color: meta.color }}>
                    {slot.status === "blocked" && slot.reason ? slot.reason.toUpperCase() : meta.label}
                  </Text>
                </View>
                <View className="flex-row items-center gap-2.5">
                  {slot.status === "booked" ? (
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
                  <Text
                    className="font-mono-semibold text-[15px]"
                    style={{ color: slot.status === "available" ? "#141A1D" : "#9A9791" }}
                  >
                    {formatPKR(slot.price)}
                  </Text>
                </View>
              </Pressable>
            );
          })}
          {slots.length === 0 ? (
            <Text className="font-figtree-medium text-player-ink-faint text-sm text-center pt-8">
              No schedule published for this court on this day.
            </Text>
          ) : null}
        </ScrollView>
      )}

      <View className="px-5 pt-3.5 pb-6 bg-player-surface border-t border-player-border-light">
        <Text className="font-figtree-medium text-player-ink-faint text-[12.5px] text-center">
          Tap any open slot to book it
        </Text>
      </View>
    </SafeAreaView>
  );
}
