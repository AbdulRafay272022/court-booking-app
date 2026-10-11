import { Pressable, ScrollView, Text, View } from "react-native";
import { Image } from "react-native";
import { router } from "expo-router";

import { FavoriteButton } from "@/components/favorite-button";
import { formatPKR } from "@/lib/format";
import { useFavorites } from "@/lib/use-favorites";
import { BrandGradient } from "@/app/(player)/_components";

/** The player's saved venues, as a row of compact cards on the Bookings tab. Reads the same shared list the hearts use, so
 * un-saving here (or on a search card) updates both. Mirrors the web strip. */
export function SavedVenues() {
  const { enabled, loading, venues, isError } = useFavorites();
  if (!enabled) return null;

  return (
    <View className="gap-3" accessibilityLabel="Saved venues">
      <View className="flex-row items-baseline justify-between">
        <Text className="font-figtree-extrabold text-player-ink text-[18px] -tracking-[0.3px]">
          Saved venues
          {venues.length ? <Text className="font-mono text-player-ink-fainter text-[14px]">{`  ${venues.length}`}</Text> : null}
        </Text>
        {venues.length > 0 ? (
          <Pressable onPress={() => router.push("/(player)/search")} accessibilityLabel="Find more courts" className="py-1 active:opacity-70">
            <Text className="font-figtree-bold text-[13.5px]" style={{ color: "#C8431C" }}>
              Find more
            </Text>
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <View className="flex-row gap-3" accessibilityLabel="Loading saved venues">
          <View className="h-[88px] w-[280px] rounded-2xl bg-player-surface-2" />
          <View className="h-[88px] w-[280px] rounded-2xl bg-player-surface-2" />
        </View>
      ) : isError && venues.length === 0 ? (
        <View className="rounded-2xl border border-player-border-light bg-player-surface px-5 py-4">
          <Text className="font-figtree-medium text-player-ink-muted text-[14px]">Couldn&apos;t load your saved venues right now.</Text>
        </View>
      ) : venues.length === 0 ? (
        <View className="rounded-2xl border border-dashed border-player-border bg-player-surface px-5 py-4" accessibilityLabel="No saved venues yet">
          <Text className="font-figtree-medium text-player-ink-muted text-[14px]">Tap the heart on any court to keep it here for next time.</Text>
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-3 pr-1" snapToInterval={292} decelerationRate="fast">
          {venues.map((v) => (
            <View key={v.id} style={{ width: 280 }} accessibilityLabel={`Saved venue ${v.name}`}>
              <Pressable
                onPress={() => router.push({ pathname: "/(player)/venue/[slug]", params: { slug: v.slug } })}
                accessibilityLabel={`${v.name}, open venue`}
                className="flex-row items-center gap-3 rounded-2xl border border-player-border-light bg-player-surface p-3 active:opacity-80"
                style={{ paddingRight: 60 }}
              >
                <View className="w-16 h-16 rounded-xl overflow-hidden items-center justify-center bg-player-surface-2">
                  {v.photo_urls?.[0] ? (
                    <Image source={{ uri: v.photo_urls[0] }} style={{ width: 64, height: 64 }} resizeMode="cover" />
                  ) : (
                    <>
                      <BrandGradient />
                      <Text className="font-figtree-extrabold text-[24px]" style={{ color: "rgba(255,255,255,0.92)" }}>
                        {v.name.charAt(0).toUpperCase()}
                      </Text>
                    </>
                  )}
                </View>
                <View className="flex-1 gap-0.5">
                  <Text className="font-figtree-extrabold text-player-ink text-[15.5px]" numberOfLines={1}>
                    {v.name}
                  </Text>
                  <Text className="font-figtree-medium text-player-ink-faint text-[12.5px]" numberOfLines={1}>
                    {[v.area ?? v.city, v.sports.join(" · ")].filter(Boolean).join(" · ")}
                  </Text>
                  <Text className="font-figtree-semibold text-player-ink text-[12.5px]" numberOfLines={1}>
                    {v.average_rating != null ? (
                      <>
                        <Text style={{ color: "#EF5A2C" }}>★</Text> {v.average_rating.toFixed(1)}
                        {v.min_price != null ? "  ·  " : ""}
                      </>
                    ) : null}
                    {v.min_price != null ? <Text className="font-mono text-player-ink-muted">from PKR {formatPKR(v.min_price)}</Text> : null}
                  </Text>
                </View>
              </Pressable>
              <View style={{ position: "absolute", right: 12, top: "50%", marginTop: -20 }}>
                <FavoriteButton venueId={v.id} venueName={v.name} />
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
