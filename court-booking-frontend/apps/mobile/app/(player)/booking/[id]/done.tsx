import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { courtLabel } from "@/components/court-label";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useIsFocused, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { CheckIcon, ClockIcon, XIcon } from "@/components/icons";
import { DONE_TONE_COLORS, doneCopy, donePaidAmount, donePollMs } from "@/lib/booking-done";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatDate, formatPKR, formatTimeRange } from "@/lib/format";

export default function BookingDoneScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const focused = useIsFocused();
  const bookingQuery = useQuery({
    queryKey: ["booking", id],
    queryFn: () => api.bookings.get(id),
    refetchInterval: (q) => donePollMs(q.state.data?.status),
    subscribed: focused,
  });
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

  const copy = doneCopy(booking.status, booking.cancelled_by);
  const tone = DONE_TONE_COLORS[copy.tone];
  const paid = donePaidAmount(booking);

  return (
    <SafeAreaView className="flex-1" style={{ backgroundColor: tone.bg }} edges={["top", "bottom"]}>
      <View className="flex-1 px-6 pt-11 items-center gap-6">
        <View className="w-[66px] h-[66px] rounded-full items-center justify-center" style={{ backgroundColor: tone.badge }}>
          {copy.icon === "check" ? <CheckIcon size={32} strokeWidth={2.4} /> : null}
          {copy.icon === "clock" ? <ClockIcon size={30} color="#FFFFFF" /> : null}
          {copy.icon === "x" ? <XIcon size={28} color="#FFFFFF" /> : null}
        </View>
        <View className="items-center gap-1.5" accessibilityRole="header">
          <Text className="font-figtree-extrabold text-white text-2xl -tracking-[0.4px] text-center">{copy.title}</Text>
          <Text className="font-figtree-medium text-[14.5px] text-center leading-[1.45]" style={{ color: tone.sub }}>
            {copy.subtitle}
          </Text>
          {booking.status === "payment_submitted" ? <ActivityIndicator testID="done-waiting-spinner" size="large" color={tone.spinner} style={{ marginTop: 8 }} /> : null}
        </View>

        <View className="w-full bg-white rounded-[20px] p-6 gap-5">
          <View className="gap-1">
            <Text className="font-figtree-bold text-player-ink text-[19px] -tracking-[0.2px]">
              {venueQuery.data?.name ?? "Venue"} · {courtQuery.data ? courtLabel(courtQuery.data.name, courtQuery.data.sport) : "Court"}
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
            {/* Only money the venue has recorded; while the screenshot is in review this is 0, so the line is hidden. */}
            {paid != null ? (
              <View className="gap-0.5" style={{ width: "50%" }}>
                <Text className="font-figtree-bold text-[10.5px] tracking-[0.1em] text-player-ink-fainter">PAID</Text>
                <Text className="font-mono-semibold text-[15px] text-player-ink">PKR {formatPKR(paid)}</Text>
              </View>
            ) : null}
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

      <View className="px-6 pt-5 pb-6">
        <Pressable
          onPress={() =>
            copy.action === "pay"
              ? router.replace({ pathname: "/(player)/booking/[id]/pay", params: { id } })
              : router.replace("/bookings")
          }
          accessibilityRole="button"
          className="rounded-2xl bg-white items-center justify-center active:opacity-80"
          style={{ height: 52 }}
        >
          <Text className="font-figtree-bold text-player-ink text-[15.5px]">{copy.actionLabel}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
