import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { CheckIcon } from "@/components/icons";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatDate, formatPKR, formatTimeRange } from "@/lib/format";

export default function BookingDoneScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const bookingQuery = useQuery({ queryKey: ["booking", id], queryFn: () => api.bookings.get(id) });
  const courtQuery = useQuery({
    queryKey: ["court", bookingQuery.data?.court_id],
    queryFn: () => api.courts.get(bookingQuery.data!.court_id),
    enabled: !!bookingQuery.data?.court_id,
  });
  const venueQuery = useQuery({
    queryKey: ["venue", courtQuery.data?.venue_id],
    queryFn: () => api.venues.get(courtQuery.data!.venue_id),
    enabled: !!courtQuery.data?.venue_id,
  });

  const booking = bookingQuery.data;

  if (!booking && bookingQuery.isError) {
    return (
      <SafeAreaView className="flex-1" style={{ backgroundColor: "#0F2D22" }} edges={["top", "bottom"]}>
        <View className="flex-1 items-center justify-center px-8 gap-3">
          <Text className="font-figtree-bold text-white text-base text-center">Couldn't load your booking</Text>
          <Text className="font-figtree-medium text-sm text-center" style={{ color: "#9BC4B1" }}>
            {friendlyErrorMessage(bookingQuery.error)}
          </Text>
          <Pressable
            onPress={() => bookingQuery.refetch()}
            className="px-4 h-11 rounded-xl bg-white items-center justify-center mt-1"
          >
            <Text className="font-figtree-semibold text-player-ink text-[13.5px]">Try again</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (!booking) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center" style={{ backgroundColor: "#0F2D22" }} edges={["top", "bottom"]}>
        <ActivityIndicator color="#FFFFFF" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: "#0F2D22" }} edges={["top", "bottom"]}>
      <View className="flex-1 px-6 pt-11 items-center gap-5.5">
        <View className="w-[66px] h-[66px] rounded-full items-center justify-center" style={{ backgroundColor: "#1F7A52" }}>
          <CheckIcon size={32} strokeWidth={2.4} />
        </View>
        <View className="items-center gap-1.5">
          <Text className="font-figtree-extrabold text-white text-2xl -tracking-[0.4px]">Court is yours</Text>
          <Text className="font-figtree-medium text-[14.5px] text-center" style={{ color: "#9BC4B1" }}>
            Confirmed by the venue
          </Text>
        </View>

        <View className="w-full bg-white rounded-[20px] p-5.5 gap-4.5">
          <View className="gap-1">
            <Text className="font-figtree-bold text-player-ink text-[19px] -tracking-[0.2px]">
              {venueQuery.data?.name ?? "Venue"} · {courtQuery.data?.name ?? "Court"}
            </Text>
            <Text className="font-figtree-medium text-player-ink-faint text-sm">
              {venueQuery.data ? [venueQuery.data.area ?? venueQuery.data.city].join(", ") : ""}
            </Text>
          </View>

          <View className="flex-row flex-wrap gap-y-4">
            <View className="gap-0.5" style={{ width: "50%" }}>
              <Text className="font-figtree-bold text-[10.5px] tracking-[0.1em] text-player-ink-fainter">DATE</Text>
              <Text className="font-mono-semibold text-[15px] text-player-ink">{formatDate(booking.starts_at)}</Text>
            </View>
            <View className="gap-0.5" style={{ width: "50%" }}>
              <Text className="font-figtree-bold text-[10.5px] tracking-[0.1em] text-player-ink-fainter">TIME</Text>
              <Text className="font-mono-semibold text-[15px] text-player-ink">{formatTimeRange(booking.starts_at, booking.ends_at)}</Text>
            </View>
            <View className="gap-0.5" style={{ width: "50%" }}>
              <Text className="font-figtree-bold text-[10.5px] tracking-[0.1em] text-player-ink-fainter">PAID</Text>
              <Text className="font-mono-semibold text-[15px] text-player-ink">PKR {formatPKR(booking.amount_paid)}</Text>
            </View>
            <View className="gap-0.5" style={{ width: "50%" }}>
              {/* "AT VENUE 0" read like a broken "Venue 0"; say what it means. */}
              <Text className="font-figtree-bold text-[10.5px] tracking-[0.1em] text-player-ink-fainter">DUE AT VENUE</Text>
              <Text className="font-mono-semibold text-[15px]" style={{ color: booking.balance_due > 0 ? "#B5730B" : "#141A1D" }}>
                {booking.balance_due > 0 ? `PKR ${formatPKR(booking.balance_due)}` : "Nothing due"}
              </Text>
            </View>
          </View>
        </View>
      </View>

      <View className="px-6 pt-4.5 pb-6">
        <Pressable
          onPress={() => router.replace("/bookings")}
          className="h-13 rounded-2xl bg-white items-center justify-center"
          style={{ height: 52 }}
        >
          <Text className="font-figtree-bold text-player-ink text-[15.5px]">Done</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
