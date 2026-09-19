import { Pressable, Text, View } from "react-native";

export function VenueSwitcher({
  venues,
  activeVenueId,
  onSelect,
}: {
  venues: { id: string; name: string }[];
  activeVenueId: string | undefined;
  onSelect: (id: string) => void;
}) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {venues.map((v) => (
        <Pressable
          key={v.id}
          onPress={() => onSelect(v.id)}
          className="px-3 py-2 rounded-lg"
          style={{ backgroundColor: v.id === activeVenueId ? "#0E6274" : "#F4F6F7" }}
        >
          <Text
            className="font-plex-semibold text-[12.5px]"
            style={{ color: v.id === activeVenueId ? "#FFFFFF" : "#5B7079" }}
          >
            {v.name}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Tab({
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
      className="px-3.5 rounded-lg items-center justify-center"
      style={{ minHeight: 44, backgroundColor: selected ? "#0E6274" : "#F4F6F7" }}
    >
      <Text
        className="font-plex-semibold text-[13px]"
        style={{ color: selected ? "#FFFFFF" : "#5B7079" }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function StatTile({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "warn";
}) {
  const bg = tone === "warn" ? "#FBF0DD" : "#F4F6F7";
  const labelColor = tone === "warn" ? "#9C5C0A" : "#8399A1";
  const valueColor = tone === "warn" ? "#9C5C0A" : "#101C21";
  return (
    <View className="flex-1 rounded-[11px] p-3" style={{ backgroundColor: bg }}>
      <Text
        className="font-plex-semibold text-[10px] tracking-[1.1px]"
        style={{ color: labelColor }}
      >
        {label.toUpperCase()}
      </Text>
      <Text className="font-mono-semibold text-[19px] -tracking-[0.4px] mt-0.5" style={{ color: valueColor }}>
        {value}
      </Text>
    </View>
  );
}

export function IconButton({ onPress, children }: { onPress: () => void; children: React.ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      className="w-12 h-12 rounded-[10px] border border-owner-border items-center justify-center"
    >
      {children}
    </Pressable>
  );
}

export function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <View className="flex-1 items-center justify-center gap-2 px-8">
      <Text className="font-plex-bold text-owner-ink text-base text-center">{title}</Text>
      <Text className="font-plex-medium text-owner-ink-faint text-sm text-center">{subtitle}</Text>
    </View>
  );
}
