import { useState } from "react";
import { View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Star } from "lucide-react-native";
import type { Review } from "@court-booking/types";
import { palette, radius, shadow, space } from "@court-booking/ui-tokens";
import { Banner, Button, EmptyState, ErrorState, Input, Screen, SkeletonCard, Text } from "@/components/ui";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { useMyPermissions } from "@/lib/use-my-permissions";
import { useFeatureFlags } from "@/lib/use-feature-flags";
import { formatShortDate } from "@/lib/format";
import { NoAccess } from "@/components/no-access";
import { OwnerHeader } from "./_fl";

const stars = (n: number) => "★★★★★".slice(0, Math.round(n)) + "☆☆☆☆☆".slice(0, 5 - Math.round(n));

/** OGrowthTeam frame 2 "Reviews": the venue's real reviews (GET /venues/{id}/reviews). The average is computed from them;
 * nothing shows without reviews. Reply (POST /reviews/{id}/reply) needs respond_reviews and the `reviews` flag. */
export default function OwnerReviewsScreen() {
  const { activeVenue, isLoading: venuesLoading } = useOwnerVenues();
  const perms = useMyPermissions();
  const flags = useFeatureFlags();
  const venueId = activeVenue?.id;
  const reviewsQuery = useQuery({
    queryKey: ["owner-reviews", venueId],
    queryFn: () => api.reviews.listForVenue(venueId!),
    enabled: !!venueId,
  });
  const reviews = reviewsQuery.data ?? [];
  const avg = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : null;
  const mayReply = perms.can("respond_reviews") && flags.on("reviews");

  if (perms.settled && !perms.can("respond_reviews")) return <NoAccess what="Reviews" />;

  return (
    <Screen testID="reviews-screen">
      <OwnerHeader title="Reviews" subtitle={activeVenue?.name} />
      {!flags.on("reviews") ? <Banner tone="info" body="Reviews ka feature abhi band hai: naye reviews aur jawab abhi nahi ho sakte." /> : null}
      {venuesLoading || reviewsQuery.isLoading ? (
        <SkeletonCard />
      ) : reviewsQuery.isError ? (
        <ErrorState message={friendlyErrorMessage(reviewsQuery.error)} onRetry={() => reviewsQuery.refetch()} />
      ) : reviews.length === 0 ? (
        <EmptyState title="Abhi koi review nahi" body="Players khel ke baad rating denge to yahan dikhegi." icon={Star} />
      ) : (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[4], backgroundColor: palette.white, borderRadius: radius.card, padding: space[4], boxShadow: shadow.card }}>
            <Text variant="display">{avg!.toFixed(1)}</Text>
            <View style={{ gap: 2, flex: 1 }}>
              <Text variant="bodyStrong" tone="info" accessibilityLabel={`${avg!.toFixed(1)} mein se 5`}>
                {stars(avg!)}
              </Text>
              <Text variant="meta" tone="muted">{`${reviews.length} ${reviews.length === 1 ? "review" : "reviews"}`}</Text>
            </View>
          </View>
          {reviews.map((r) => (
            <OwnerReviewCard key={r.id} review={r} venueId={venueId!} mayReply={mayReply} />
          ))}
        </>
      )}
    </Screen>
  );
}

function OwnerReviewCard({ review, venueId, mayReply }: { review: Review; venueId: string; mayReply: boolean }) {
  const queryClient = useQueryClient();
  const [replying, setReplying] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!text.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.reviews.reply(review.id, text.trim());
      setReplying(false);
      setText("");
      await queryClient.invalidateQueries({ queryKey: ["owner-reviews", venueId] });
    } catch (e) {
      setError(friendlyErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={{ backgroundColor: palette.white, borderRadius: radius.tile, padding: space[4], gap: space[2] }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: space[2] }}>
        <Text variant="bodyStrong">{review.player_first_name ?? "Player"}</Text>
        <Text variant="bodyBold" tone="info" accessibilityLabel={`${review.rating} mein se 5`}>
          {stars(review.rating)}
        </Text>
      </View>
      {review.comment ? <Text variant="body">{review.comment}</Text> : null}
      <Text variant="caption" tone="muted">
        {formatShortDate(review.created_at)}
      </Text>
      {review.owner_reply ? (
        <View style={{ backgroundColor: palette.tealTint, borderRadius: radius.md, padding: space[3], gap: 2 }}>
          <Text variant="label" tone="info">
            Aap ka jawab:
          </Text>
          <Text variant="body">{review.owner_reply}</Text>
        </View>
      ) : !mayReply ? null : replying ? (
        <View style={{ gap: space[2] }}>
          <Input label="Public jawab" value={text} onChangeText={setText} multiline placeholder="Shukriya! ..." />
          {error ? <Banner tone="danger" body={error} /> : null}
          <View style={{ flexDirection: "row", gap: space[2] }}>
            <Button label="Cancel" variant="soft" size="sm" onPress={() => setReplying(false)} />
            <Button label={saving ? "Bhej rahe hain" : "Jawab bhejein"} size="sm" onPress={submit} disabled={saving || !text.trim()} />
          </View>
        </View>
      ) : (
        <Button label="Jawab dein" variant="soft" size="sm" onPress={() => setReplying(true)} accessibilityLabel={`${review.player_first_name ?? "Player"} ko jawab dein`} />
      )}
    </View>
  );
}
