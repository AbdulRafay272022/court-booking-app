import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Review } from "@court-booking/types";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { formatShortDate } from "@/lib/format";
import { ChevronLeftIcon, StarIcon } from "@/components/icons";
import { ErrorState } from "@/components/error-state";

export default function OwnerReviewsScreen() {
  const { activeVenue, isLoading: venuesLoading } = useOwnerVenues();
  const venueId = activeVenue?.id;
  const reviewsQuery = useQuery({
    queryKey: ["owner-reviews", venueId],
    queryFn: () => api.reviews.listForVenue(venueId!),
    enabled: !!venueId,
  });
  const reviews = reviewsQuery.data ?? [];

  return (
    <SafeAreaView className="flex-1 bg-owner-bg" edges={["top", "bottom"]}>
      <View className="px-4.5 py-5 bg-owner-surface border-b border-owner-border flex-row items-center gap-3">
        <Pressable onPress={() => router.back()} className="w-11 h-11 rounded-[10px] bg-owner-bg items-center justify-center">
          <ChevronLeftIcon />
        </Pressable>
        <Text className="font-plex-bold text-owner-ink text-[16.5px] -tracking-[0.2px] flex-1">
          Reviews{activeVenue ? ` · ${activeVenue.name}` : ""}
        </Text>
      </View>

      {venuesLoading || reviewsQuery.isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#0E6274" />
        </View>
      ) : reviewsQuery.isError ? (
        <ErrorState message={friendlyErrorMessage(reviewsQuery.error)} onRetry={() => reviewsQuery.refetch()} tone="owner" />
      ) : reviews.length === 0 ? (
        <Text className="font-plex-medium text-owner-ink-faint text-center px-6 pt-16">
          No reviews yet. They'll appear here once players rate their games.
        </Text>
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="px-4.5 pt-4 pb-8 gap-3.5">
          {reviews.map((r) => (
            <OwnerReviewCard key={r.id} review={r} venueId={venueId!} />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function OwnerReviewCard({ review, venueId }: { review: Review; venueId: string }) {
  const queryClient = useQueryClient();
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!text.trim()) return;
    setSaving(true);
    try {
      await api.reviews.reply(review.id, text.trim());
      setReplying(false);
      setText("");
      await queryClient.invalidateQueries({ queryKey: ["owner-reviews", venueId] });
    } catch (e) {
      Alert.alert("Couldn't post reply", friendlyErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View className="bg-owner-surface border border-owner-border rounded-xl p-4 gap-2">
      <View className="flex-row items-center justify-between">
        <Text className="font-plex-bold text-owner-ink text-[14px]">{review.player_first_name ?? "Player"}</Text>
        <View className="flex-row" accessibilityLabel={`${review.rating} of 5 stars`}>
          {[1, 2, 3, 4, 5].map((n) => (
            <StarIcon key={n} size={14} color={n <= review.rating ? "#0E6274" : "#D6DEE0"} />
          ))}
        </View>
      </View>
      {review.comment ? <Text className="font-plex-medium text-owner-ink text-[13.5px] leading-[19px]">{review.comment}</Text> : null}
      <Text className="font-mono-medium text-owner-ink-faint text-[11.5px]">{formatShortDate(review.created_at)}</Text>

      {review.owner_reply ? (
        <View className="mt-1 pl-3 border-l-2 border-owner-border-light gap-0.5">
          <Text className="font-plex-semibold text-owner-ink-muted text-[12px]">Your reply</Text>
          <Text className="font-plex-medium text-owner-ink text-[13px] leading-[18px]">{review.owner_reply}</Text>
        </View>
      ) : replying ? (
        <View className="gap-2 mt-1">
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Write a public reply…"
            placeholderTextColor="#8399A1"
            multiline
            className="min-h-[60px] border border-owner-border rounded-[10px] p-3 font-plex-medium text-owner-ink text-[13.5px]"
            style={{ textAlignVertical: "top" }}
          />
          <View className="flex-row gap-2.5">
            <Pressable onPress={() => setReplying(false)} className="flex-1 h-10 rounded-[10px] border border-owner-border items-center justify-center">
              <Text className="font-plex-semibold text-owner-ink text-[13px]">Cancel</Text>
            </Pressable>
            <Pressable onPress={submit} disabled={saving || !text.trim()} className="flex-1 h-10 rounded-[10px] items-center justify-center bg-owner-accent" style={{ opacity: saving || !text.trim() ? 0.5 : 1 }}>
              <Text className="font-plex-bold text-white text-[13px]">{saving ? "Posting…" : "Post reply"}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Pressable accessibilityLabel="Reply to review" onPress={() => setReplying(true)} className="self-start mt-1 px-3.5 h-9 rounded-full bg-owner-accent items-center justify-center">
          <Text className="font-plex-bold text-white text-[12.5px]">Reply</Text>
        </Pressable>
      )}
    </View>
  );
}
