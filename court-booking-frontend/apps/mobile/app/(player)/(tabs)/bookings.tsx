import { useState } from "react";
import { ScrollView, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { countByGroup, isActiveBooking, nextBooking, statusGroup, type Booking, type StatusGroup } from "@court-booking/types";

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { ErrorState } from "@/components/error-state";
import { BookingCard, NextBookingCard } from "@/components/booking-card";
import { SavedVenues } from "@/components/saved-venues";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { SearchIcon } from "@/components/icons";
import { EmptyState } from "../_components";

type Tab = "upcoming" | "past";
type Filter = "all" | StatusGroup;

// The API caps a page at 100; a player's newest bookings come first on "past", so only the oldest could ever drop off.
const PAGE = 100;

const FILTERS: Record<Tab, { key: Filter; label: string }[]> = {
  upcoming: [
    { key: "all", label: "All" },
    { key: "confirmed", label: "Confirmed" },
    { key: "pending", label: "Pending" },
    { key: "cancelled", label: "Cancelled" },
  ],
  past: [
    { key: "all", label: "All" },
    { key: "completed", label: "Completed" },
    { key: "cancelled", label: "Cancelled" },
  ],
};

function Stat({ label, value, hint, warn }: { label: string; value: number; hint: string; warn?: boolean }) {
  return (
    <View className="flex-1 gap-1 rounded-2xl border border-player-border-light bg-player-surface p-3.5" accessibilityLabel={`${label}: ${value}`}>
      <Text className="font-figtree-bold text-player-ink-faint text-[10.5px] tracking-[0.12em]">{label.toUpperCase()}</Text>
      <Text className="font-mono-semibold text-[28px] leading-[30px]" style={{ color: warn && value > 0 ? "#8A5A0A" : "#141A1D" }}>
        {value}
      </Text>
      <Text className="font-figtree-medium text-player-ink-fainter text-[11.5px]">{hint}</Text>
    </View>
  );
}

function ListSkeleton() {
  return (
    <View className="gap-3.5" accessibilityLabel="Loading bookings">
      {[0, 1, 2].map((i) => (
        <View key={i} className="h-44 rounded-[20px] bg-player-surface-2" />
      ))}
    </View>
  );
}

export default function PlayerBookingsScreen() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [tab, setTab] = useState<Tab>("upcoming");
  const [filter, setFilter] = useState<Filter>("all");

  // Both lists load up front: the stat tiles and the "next up" card need upcoming even while Past is selected.
  const upcomingQ = useQuery({ queryKey: ["bookings-mine", "upcoming"], queryFn: () => api.bookings.mine("upcoming", 1, PAGE) });
  const pastQ = useQuery({ queryKey: ["bookings-mine", "past"], queryFn: () => api.bookings.mine("past", 1, PAGE) });
  // The player's own reviews, to show "Rate your game" vs "Edit review" on each completed booking.
  const reviewsQ = useQuery({ queryKey: ["my-reviews"], queryFn: () => api.reviews.mine() });
  const reviewByBooking = new Map((reviewsQ.data ?? []).map((r) => [r.booking_id, r]));
  const refetchAll = () => {
    upcomingQ.refetch();
    pastQ.refetch();
    queryClient.invalidateQueries({ queryKey: ["my-reviews"] });
  };

  const upcoming: Booking[] = upcomingQ.data ?? [];
  const past: Booking[] = pastQ.data ?? [];
  const next = nextBooking(upcoming);
  const activeUpcoming = upcoming.filter((b) => isActiveBooking(b));
  const pendingCount = activeUpcoming.filter((b) => statusGroup(b.status) === "pending").length;
  const played = countByGroup(past).completed;

  const query = tab === "upcoming" ? upcomingQ : pastQ;
  const list = tab === "upcoming" ? upcoming : past;
  const counts = countByGroup(list);
  const shown = filter === "all" ? list : list.filter((b) => statusGroup(b.status) === filter);
  const firstName = user?.name?.trim().split(/\s+/)[0];

  function switchTab(t: Tab) {
    setTab(t);
    setFilter("all");
  }

  return (
    <SafeAreaView className="flex-1 bg-player-bg" edges={["top", "bottom"]}>
      <View className="px-5 pt-5 pb-4 bg-player-accent-soft border-b border-player-accent-soft-border flex-row items-end justify-between gap-3">
        <View className="flex-1 gap-1">
          <Text className="font-figtree-bold text-[11.5px] tracking-[0.14em]" style={{ color: "#C8431C" }}>
            YOUR DASHBOARD
          </Text>
          <Text className="font-figtree-extrabold text-player-ink text-[26px] -tracking-[0.03em]" numberOfLines={1}>
            {firstName ? `Hi, ${firstName}` : "Your bookings"}
          </Text>
        </View>
        <Pressable
          onPress={() => router.push("/(player)/search")}
          accessibilityLabel="Find a court"
          className="h-11 px-4 rounded-xl flex-row items-center gap-2 active:opacity-80"
          style={{ backgroundColor: "#EF5A2C" }}
        >
          <SearchIcon size={16} color="#FFFFFF" />
          <Text className="font-figtree-bold text-white text-[13.5px]">Find a court</Text>
        </Pressable>
      </View>

      <ScrollView className="flex-1" contentContainerClassName="px-5 pt-5 pb-10 gap-5">
        <View className="flex-row gap-3">
          <Stat label="Upcoming" value={activeUpcoming.length} hint="games booked" />
          <Stat label="Pending" value={pendingCount} hint="need your action" warn />
          <Stat label="Played" value={played} hint="games so far" />
        </View>

        {next ? <NextBookingCard booking={next} onChanged={refetchAll} /> : null}

        <SavedVenues />

        <View className="gap-3.5 pt-1">
          <View className="flex-row gap-2" accessibilityRole="tablist">
            {(["upcoming", "past"] as const).map((t) => (
              <Pressable
                key={t}
                onPress={() => switchTab(t)}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === t }}
                className="px-5 rounded-full items-center justify-center active:opacity-80"
                style={{ minHeight: 44, backgroundColor: tab === t ? "#141A1D" : "#F4EFEC" }}
              >
                <Text className="font-figtree-bold text-[14px]" style={{ color: tab === t ? "#FFFFFF" : "#5C544D" }}>
                  {t === "upcoming" ? "Upcoming" : "Past"}
                </Text>
              </Pressable>
            ))}
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2" accessibilityLabel="Filter by status">
            {FILTERS[tab].map((f) => {
              const on = filter === f.key;
              return (
                <Pressable
                  key={f.key}
                  onPress={() => setFilter(f.key)}
                  accessibilityLabel={`Filter ${f.label}, ${counts[f.key]}`}
                  accessibilityState={{ selected: on }}
                  className="h-10 px-4 rounded-full flex-row items-center gap-2 border active:opacity-80"
                  style={{
                    backgroundColor: on ? "#EF5A2C" : "#FFFFFF",
                    borderColor: on ? "#EF5A2C" : "#E5DED8",
                    ...(on ? { shadowColor: "#EF5A2C", shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 } : null),
                  }}
                >
                  <Text className="font-figtree-semibold text-[13.5px]" style={{ color: on ? "#FFFFFF" : "#5C544D" }}>
                    {f.label}
                  </Text>
                  <Text className="font-mono text-[12px]" style={{ color: on ? "rgba(255,255,255,0.85)" : "#9A9791" }}>
                    {counts[f.key]}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {query.isLoading ? (
          <ListSkeleton />
        ) : query.isError && list.length === 0 ? (
          <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} tone="player" />
        ) : shown.length === 0 ? (
          <View style={{ minHeight: 260 }} className="rounded-[20px] border border-player-border-light bg-player-surface py-8">
            <EmptyState
              icon={<SearchIcon size={26} color="#EF5A2C" />}
              title={filter !== "all" ? "Nothing here with that status" : tab === "upcoming" ? "Nothing booked yet" : "No past bookings"}
              subtitle={
                filter !== "all"
                  ? "Try another status, or show all."
                  : tab === "upcoming"
                    ? "Find a court and book your first slot."
                    : "Games you've played show up here."
              }
              action={
                filter !== "all"
                  ? { label: "Show all", onPress: () => setFilter("all") }
                  : tab === "upcoming"
                    ? { label: "Find a court", onPress: () => router.push("/(player)/search") }
                    : undefined
              }
            />
          </View>
        ) : (
          <View className="gap-3.5">
            {shown.map((b) => (
              <BookingCard key={b.id} booking={b} review={reviewByBooking.get(b.id)} onChanged={refetchAll} />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
