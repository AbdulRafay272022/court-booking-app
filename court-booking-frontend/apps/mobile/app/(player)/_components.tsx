import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Image, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";
import { LocationPinIcon, StarIcon } from "@/components/icons";
import { AmenityBadges } from "@/components/amenity-badges";
import { formatDistance } from "@/lib/format";
import type { VenueSummary } from "@court-booking/types";
import { formatPKR } from "@/lib/format";

export function SportChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="px-4 rounded-full items-center justify-center active:opacity-80"
      style={{
        minHeight: 44,
        backgroundColor: selected ? "#EF5A2C" : "#F4EFEC",
        ...(selected ? { shadowColor: "#EF5A2C", shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 } : null),
      }}
    >
      <Text className="font-figtree-semibold text-[13.5px]" style={{ color: selected ? "#FFFFFF" : "#5C544D" }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** The brand orange, as a fill for a photo placeholder (same two stops as the web). Drawn with react-native-svg, no extra package. */
export function BrandGradient() {
  return (
    <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} preserveAspectRatio="none">
      <Defs>
        <LinearGradient id="brandOrange" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#F2784F" />
          <Stop offset="1" stopColor="#C8431C" />
        </LinearGradient>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#brandOrange)" />
    </Svg>
  );
}

export function VenueCard({ venue, onPress }: { venue: VenueSummary; onPress: () => void }) {
  const place = [venue.area ?? venue.city, formatDistance(venue.distance_meters)].filter(Boolean).join(" · ");
  const photo = venue.photo_urls?.[0];
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={`${venue.name}, open venue`}
      style={({ pressed }) => ({
        transform: [{ scale: pressed ? 0.985 : 1 }],
        shadowColor: "#141A1D",
        shadowOpacity: 0.1,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 5 },
        elevation: 3,
        borderRadius: 20,
      })}
    >
      <View className="bg-player-surface border border-player-border-light rounded-[20px] overflow-hidden">
        <View className="h-44 bg-player-surface-2 justify-end">
          {photo ? (
            <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : (
            <>
              <BrandGradient />
              <View className="absolute inset-0 items-center justify-center">
                <Text className="font-figtree-extrabold text-[52px]" style={{ color: "rgba(255,255,255,0.9)" }}>
                  {venue.name.charAt(0).toUpperCase()}
                </Text>
              </View>
            </>
          )}
          {venue.average_rating != null ? (
            <View
              className="absolute top-3 right-3 flex-row items-center gap-1 px-2.5 py-1 rounded-full"
              style={{ backgroundColor: "rgba(255,255,255,0.95)" }}
            >
              <StarIcon size={13} />
              <Text className="font-figtree-bold text-player-ink text-[13px]">{venue.average_rating.toFixed(1)}</Text>
              {venue.review_count > 0 ? (
                <Text className="font-figtree-medium text-player-ink-faint text-[12px]">({venue.review_count})</Text>
              ) : null}
            </View>
          ) : null}
          {venue.sports.length > 0 ? (
            <View className="self-start m-3 px-2.5 py-1 rounded-full" style={{ backgroundColor: "rgba(20,26,29,0.82)" }}>
              <Text className="font-figtree-semibold text-white text-[12px] capitalize">{venue.sports.join(" · ")}</Text>
            </View>
          ) : null}
        </View>

        <View className="p-5 gap-3">
          <View className="gap-1">
            <Text className="font-figtree-extrabold text-player-ink text-[18px] -tracking-[0.3px]">{venue.name}</Text>
            {place ? (
              <View className="flex-row items-center gap-1.5">
                <LocationPinIcon size={14} color="#7A7068" strokeWidth={1.8} />
                <Text className="font-figtree-medium text-player-ink-faint text-[13.5px]">{place}</Text>
              </View>
            ) : null}
          </View>

          <AmenityBadges amenities={venue.amenities} max={2} />

          <View className="flex-row items-end justify-between pt-3 border-t border-player-border-light">
            {venue.min_price != null ? (
              <View>
                <Text className="font-figtree-bold text-player-ink-fainter text-[11px] tracking-[0.1em]">FROM</Text>
                <Text className="font-mono-semibold text-player-ink text-[16.5px]">
                  PKR {formatPKR(venue.min_price)}
                  <Text className="font-figtree-medium text-player-ink-faint text-[12.5px]"> / slot</Text>
                </Text>
              </View>
            ) : (
              <Text className="font-figtree-medium text-player-ink-faint text-[13px]">Price on request</Text>
            )}
            <Text className="font-figtree-bold text-[13.5px]" style={{ color: "#C8431C" }}>
              View →
            </Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

/** Pulsing placeholder shown in the results list while the first search loads. */
export function VenueCardSkeleton() {
  const opacity = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    // NativeWind does not style an Animated.View from className: the animation sits on the wrapper, the look on the inner View.
    <Animated.View style={{ opacity }} accessibilityLabel="Loading venues">
      <View className="bg-player-surface border border-player-border-light rounded-[20px] overflow-hidden">
        <View className="h-44 bg-player-surface-2" />
        <View className="p-5 gap-3">
          <View className="h-5 w-2/3 rounded bg-player-surface-2" />
          <View className="h-4 w-1/3 rounded bg-player-surface-2" />
          <View className="flex-row gap-2">
            <View className="h-6 w-20 rounded-md bg-player-surface-2" />
            <View className="h-6 w-16 rounded-md bg-player-surface-2" />
          </View>
          <View className="h-px bg-player-border-light mt-1" />
          <View className="h-5 w-1/2 rounded bg-player-surface-2" />
        </View>
      </View>
    </Animated.View>
  );
}

export function EmptyState({
  title,
  subtitle,
  action,
  icon,
}: {
  title: string;
  subtitle: string;
  action?: { label: string; onPress: () => void };
  icon?: ReactNode;
}) {
  return (
    <View className="flex-1 items-center justify-center gap-3 px-8">
      {icon ? <View className="w-14 h-14 rounded-full bg-player-accent-soft items-center justify-center">{icon}</View> : null}
      <Text className="font-figtree-extrabold text-player-ink text-xl text-center -tracking-[0.3px]">{title}</Text>
      <Text className="font-figtree-medium text-player-ink-muted text-[15px] text-center leading-[1.5]">{subtitle}</Text>
      {action ? (
        <Pressable
          onPress={action.onPress}
          className="mt-2 h-12 px-6 rounded-full bg-player-accent items-center justify-center active:opacity-80"
        >
          <Text className="font-figtree-bold text-white text-[14.5px]">{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function DayTab({
  label,
  dayNum,
  selected,
  onPress,
}: {
  label: string;
  dayNum: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="items-center gap-0.5 rounded-xl py-2.5"
      style={{ minWidth: 52, backgroundColor: selected ? "#EF5A2C" : "#F4EFEC" }}
    >
      <Text
        className="font-figtree-semibold text-[10px] tracking-[0.06em]"
        style={{ color: selected ? "rgba(255,255,255,0.85)" : "#5C544D" }}
      >
        {label}
      </Text>
      <Text className="font-mono-semibold text-[17px]" style={{ color: selected ? "#FFFFFF" : "#5C544D" }}>
        {dayNum}
      </Text>
    </Pressable>
  );
}
