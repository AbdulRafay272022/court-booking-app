import { Image, Pressable, Text, View } from "react-native";
import { StarIcon } from "@/components/icons";
import { formatDistance } from "@/lib/format";
import type { VenueSummary } from "@court-booking/types";

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
      className="px-4 rounded-full items-center justify-center"
      style={{ minHeight: 44, backgroundColor: selected ? "#141A1D" : "#F4EFEC" }}
    >
      <Text className="font-figtree-semibold text-[13.5px]" style={{ color: selected ? "#FFFFFF" : "#5C544D" }}>
        {label}
      </Text>
    </Pressable>
  );
}

const GRADIENTS = ["#12657A", "#2E5F49", "#8A4A2E", "#5B4A8A"];

export function gradientFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return GRADIENTS[hash % GRADIENTS.length];
}

export function VenueCard({ venue, onPress }: { venue: VenueSummary; onPress: () => void }) {
  const distance = formatDistance(venue.distance_meters);
  const photo = venue.photo_urls?.[0];
  return (
    <Pressable
      onPress={onPress}
      className="bg-player-surface border border-player-border-light rounded-[18px] overflow-hidden"
    >
      <View className="h-24 items-end justify-end p-3" style={{ backgroundColor: gradientFor(venue.id) }}>
        {photo ? (
          <Image source={{ uri: photo }} className="absolute inset-0 w-full h-full" resizeMode="cover" />
        ) : null}
        <View className="px-2.5 py-1 rounded-full" style={{ backgroundColor: "rgba(255,255,255,0.92)" }}>
          <Text className="font-figtree-bold text-[11.5px]" style={{ color: gradientFor(venue.id) }}>
            {venue.sports.join(" · ")}
          </Text>
        </View>
      </View>
      <View className="p-4 gap-2.5">
        <View className="flex-row items-start justify-between gap-3">
          <View className="flex-1 gap-0.5">
            <Text className="font-figtree-bold text-player-ink text-[16.5px] -tracking-[0.2px]">{venue.name}</Text>
            <Text className="font-figtree-medium text-player-ink-faint text-[13px]">
              {[venue.area ?? venue.city, distance].filter(Boolean).join(" · ")}
            </Text>
          </View>
          {venue.average_rating != null ? (
            <View className="flex-row items-center gap-1">
              <StarIcon />
              <Text className="font-figtree-bold text-player-ink text-[13.5px]">{venue.average_rating.toFixed(1)}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

export function EmptyState({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View className="flex-1 items-center justify-center gap-3 px-8">
      <Text className="font-figtree-extrabold text-player-ink text-xl text-center -tracking-[0.3px]">{title}</Text>
      <Text className="font-figtree-medium text-player-ink-muted text-[15px] text-center leading-[1.5]">{subtitle}</Text>
      {action ? (
        <Pressable onPress={action.onPress} className="mt-2 h-12 px-6 rounded-[14px] bg-player-accent items-center justify-center">
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
