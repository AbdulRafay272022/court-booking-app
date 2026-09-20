import { Pressable, Text, View } from "react-native";

const STATUS_LABEL: Record<string, string> = {
  approved: "Live",
  pending: "Under review",
  changes_requested: "Changes requested",
  rejected: "Not approved",
};

/** Every venue as a chip carrying ITS OWN status (a venue that isn't live says so), plus "+ Add
 * venue" (reuses the setup wizard). The selection is shared by every owner screen. */
export function VenueSwitcher({
  venues,
  activeVenueId,
  onSelect,
  onAdd,
}: {
  venues: { id: string; name: string; status?: string }[];
  activeVenueId: string | undefined;
  onSelect: (id: string) => void;
  onAdd?: () => void;
}) {
  return (
    <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
      {venues.map((v) => {
        const active = v.id === activeVenueId;
        const live = !v.status || v.status === "approved";
        return (
          <Pressable
            key={v.id}
            accessibilityRole="radio"
            accessibilityState={{ checked: active }}
            accessibilityLabel={`${v.name}${live ? "" : `, ${STATUS_LABEL[v.status ?? ""] ?? v.status}`}`}
            onPress={() => onSelect(v.id)}
            className="px-3 py-2 rounded-lg"
            style={{ backgroundColor: active ? "#0E6274" : "#F4F6F7" }}
          >
            <Text className="font-plex-semibold text-[12.5px]" style={{ color: active ? "#FFFFFF" : "#5B7079" }}>
              {v.name}
            </Text>
            {!live ? (
              <Text className="font-plex-medium text-[10.5px]" style={{ color: active ? "#DCE9EC" : "#9C5C0A" }}>
                {STATUS_LABEL[v.status ?? ""] ?? v.status}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
      {onAdd ? (
        <Pressable
          accessibilityRole="button"
          onPress={onAdd}
          className="px-3 py-2 rounded-lg border border-dashed border-owner-accent-soft-border justify-center"
        >
          <Text className="font-plex-semibold text-[12.5px] text-owner-accent">+ Add venue</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Shown when the venue being managed isn't live: each venue keeps its own status, so this reflects the
 * SELECTED one. */
export function VenueStatusBanner({ venue, onView }: { venue: { name: string; status: string }; onView: () => void }) {
  if (venue.status === "approved") return null;
  const copy: Record<string, string> = {
    pending: "is under review. Players can't find or book it yet — walk-ins still work.",
    changes_requested: "needs changes before it can go live.",
    rejected: "wasn't approved, so players can't book it.",
  };
  const bad = venue.status === "rejected";
  return (
    <View
      accessibilityRole="alert"
      className="rounded-xl px-3.5 py-3 gap-1"
      style={{ backgroundColor: bad ? "#F8E5E0" : "#FBF0DD", borderWidth: 1, borderColor: bad ? "#DDBAB1" : "#E8D3A8" }}
    >
      <Text className="font-plex-medium text-[13px] leading-[18px]" style={{ color: bad ? "#8C3823" : "#7A480A" }}>
        <Text className="font-plex-bold">{venue.name}</Text> {copy[venue.status] ?? "isn't live yet."}
      </Text>
      <Pressable onPress={onView} accessibilityRole="button">
        <Text className="font-plex-bold text-[13px] underline" style={{ color: bad ? "#8C3823" : "#7A480A" }}>
          View status
        </Text>
      </Pressable>
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
