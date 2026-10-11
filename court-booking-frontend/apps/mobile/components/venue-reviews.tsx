import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { reviewStats, type Review } from "@court-booking/types";

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatRelativeTime, formatShortDate } from "@/lib/format";
import { StarIcon } from "@/components/icons";

const FIRST_PAGE = 5;
const STAR_GAP = 2;

/** Five stars filled to `value`; fractions allowed (4.4 fills the fifth star 40%). Two layers: grey base, orange clipped on top. */
function Stars({ value, size = 16, label }: { value: number; size?: number; label?: string }) {
  const total = size * 5 + STAR_GAP * 4;
  const clipped = (Math.max(0, Math.min(5, value)) / 5) * total;
  const row = (color: string) => (
    <View className="flex-row" style={{ width: total, gap: STAR_GAP }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <StarIcon key={i} size={size} color={color} />
      ))}
    </View>
  );
  return (
    <View style={{ width: total, height: size }} accessibilityRole="image" accessibilityLabel={label ?? `${value} out of 5 stars`}>
      {row("#E5DED8")}
      <View style={{ position: "absolute", left: 0, top: 0, width: clipped, height: size, overflow: "hidden" }}>{row("#EF5A2C")}</View>
    </View>
  );
}

const AVATAR_TONES: { bg: string; fg: string }[] = [
  { bg: "#FFF3EE", fg: "#C8431C" },
  { bg: "#EBF2F4", fg: "#0E6274" },
  { bg: "#E4F0EA", fg: "#14563A" },
  { bg: "#FDF6E9", fg: "#8A5A0A" },
  { bg: "#F4EFEC", fg: "#5C544D" },
];

function Avatar({ name }: { name: string }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const tone = AVATAR_TONES[h % AVATAR_TONES.length];
  return (
    <View className="w-10 h-10 rounded-full items-center justify-center" style={{ backgroundColor: tone.bg }}>
      <Text className="font-figtree-extrabold text-[15px]" style={{ color: tone.fg }}>
        {name.charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}

/** "3d ago" for recent reviews, a calendar date once it is older than a month. */
function when(iso: string): string {
  return Date.now() - new Date(iso).getTime() > 30 * 86_400_000 ? formatShortDate(iso) : formatRelativeTime(iso);
}

function Summary({ average, count, distribution }: { average: number; count: number; distribution: number[] }) {
  return (
    <View className="bg-player-surface border border-player-border-light rounded-[18px] p-5 gap-4" accessibilityLabel="Rating summary">
      <View className="flex-row items-center gap-5">
        <View className="items-center gap-1.5">
          <Text className="font-figtree-extrabold text-player-ink text-[44px] leading-[48px] -tracking-[1px]">{average.toFixed(1)}</Text>
          <Stars value={average} size={17} label={`${average.toFixed(1)} out of 5 stars`} />
          <Text className="font-figtree-medium text-player-ink-faint text-[12.5px]">
            {count} review{count === 1 ? "" : "s"}
          </Text>
        </View>
        <View className="flex-1 gap-1.5" accessibilityLabel="Rating breakdown">
          {distribution.map((n, i) => {
            const star = 5 - i;
            return (
              <View key={star} className="flex-row items-center gap-2" accessibilityLabel={`${star} stars: ${n}`}>
                <Text className="w-7 font-figtree-semibold text-player-ink-muted text-[12px]">{star} ★</Text>
                <View className="flex-1 h-2 rounded-full bg-player-surface-2 overflow-hidden">
                  <View className="h-2 rounded-full bg-player-accent" style={{ width: `${count ? (n / count) * 100 : 0}%` }} />
                </View>
                <Text className="w-5 text-right font-mono text-player-ink-faint text-[12px]">{n}</Text>
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

function ReviewCard({ review: r, isAdmin, onToggle }: { review: Review; isAdmin: boolean; onToggle: () => void }) {
  const name = r.player_first_name ?? "Player";
  return (
    <View
      className="bg-player-surface border border-player-border-light rounded-[18px] p-4 gap-3"
      style={{ opacity: r.is_hidden ? 0.55 : 1 }}
      accessibilityLabel={`Review by ${name}`}
    >
      <View className="flex-row items-center gap-3">
        <Avatar name={name} />
        <View className="flex-1">
          <Text className="font-figtree-bold text-player-ink text-[15px]" numberOfLines={1}>
            {name}
            {r.is_hidden ? <Text className="font-figtree-bold text-player-ink-fainter text-[11px]">{"  HIDDEN"}</Text> : null}
          </Text>
          <Text className="font-figtree-medium text-player-ink-fainter text-[12.5px]">
            {when(r.created_at)}
            {r.updated_at ? " · edited" : ""}
          </Text>
        </View>
        <Stars value={r.rating} size={14} />
      </View>
      {r.comment ? <Text className="font-figtree-medium text-player-ink-muted text-[14.5px] leading-[21px]">{r.comment}</Text> : null}
      {r.owner_reply ? (
        <View className="rounded-xl bg-player-surface-2 px-4 py-3 gap-1">
          <Text className="font-figtree-bold text-player-ink-faint text-[11.5px] tracking-[0.08em]">REPLY FROM THE VENUE</Text>
          <Text className="font-figtree-medium text-player-ink-muted text-[13.5px] leading-[19px]">{r.owner_reply}</Text>
        </View>
      ) : null}
      {isAdmin ? (
        <Pressable
          accessibilityLabel={r.is_hidden ? "Unhide review" : "Hide review"}
          onPress={onToggle}
          className="self-start px-3 py-1.5 rounded-lg bg-player-surface-2"
        >
          <Text className="font-figtree-semibold text-[12px]" style={{ color: r.is_hidden ? "#1F7A52" : "#A8432C" }}>
            {r.is_hidden ? "Unhide (admin)" : "Hide (admin)"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** The venue's reviews: a rating summary with a per-star breakdown, then the reviews newest first (first name only).
 * An admin viewing the page also gets Hide/Unhide per review (their list includes hidden ones; those never count in the numbers). */
export function VenueReviews({ venueId }: { venueId: string }) {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === "admin";
  const [showAll, setShowAll] = useState(false);
  const reviewsQuery = useQuery({ queryKey: ["venue-reviews", venueId], queryFn: () => api.reviews.listForVenue(venueId) });
  const reviews = reviewsQuery.data ?? [];
  const stats = reviewStats(reviews);
  const shown = showAll ? reviews : reviews.slice(0, FIRST_PAGE);

  async function toggleHidden(r: Review) {
    try {
      if (r.is_hidden) await api.admin.unhideReview(r.id);
      else await api.admin.hideReview(r.id);
      await queryClient.invalidateQueries({ queryKey: ["venue-reviews", venueId] });
    } catch (e) {
      // Alert is a no-op on web; keep it quiet, the list just won't change
      console.warn("toggle review failed", friendlyErrorMessage(e));
    }
  }

  return (
    <View className="gap-3.5 mt-2">
      <Text className="font-figtree-extrabold text-player-ink text-[18px] -tracking-[0.3px]">Reviews{stats.count ? ` (${stats.count})` : ""}</Text>
      {reviewsQuery.isLoading ? (
        <View className="gap-3" accessibilityLabel="Loading reviews">
          <View className="h-36 rounded-[18px] bg-player-surface-2" />
          <View className="h-24 rounded-[18px] bg-player-surface-2" />
        </View>
      ) : reviews.length === 0 ? (
        <View className="items-center gap-2 py-8 px-6 bg-player-surface border border-player-border-light rounded-[18px]">
          <View className="w-12 h-12 rounded-full bg-player-accent-soft items-center justify-center">
            <StarIcon size={24} />
          </View>
          <Text className="font-figtree-bold text-player-ink text-[15px]">No reviews yet</Text>
          <Text className="font-figtree-medium text-player-ink-faint text-[13.5px] text-center">
            Played here? Rate your game from My bookings once it&apos;s done.
          </Text>
        </View>
      ) : (
        <>
          {stats.average != null ? <Summary average={stats.average} count={stats.count} distribution={stats.distribution} /> : null}
          {shown.map((r) => (
            <ReviewCard key={r.id} review={r} isAdmin={isAdmin} onToggle={() => toggleHidden(r)} />
          ))}
          {reviews.length > FIRST_PAGE ? (
            <Pressable
              onPress={() => setShowAll((v) => !v)}
              accessibilityLabel={showAll ? "Show fewer reviews" : `Show all ${reviews.length} reviews`}
              className="self-center h-11 px-6 rounded-full border border-player-border bg-player-surface items-center justify-center active:opacity-70"
            >
              <Text className="font-figtree-bold text-player-ink text-[14px]">{showAll ? "Show fewer" : `Show all ${reviews.length} reviews`}</Text>
            </Pressable>
          ) : null}
        </>
      )}
    </View>
  );
}
