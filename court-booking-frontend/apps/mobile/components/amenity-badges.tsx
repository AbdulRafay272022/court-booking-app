import { Text, View } from "react-native";
import Svg, { Path, Circle, Rect } from "react-native-svg";
import { amenityLabel } from "@court-booking/types";

const ACCENT = "#C8431C";

/** One small icon per known amenity key (same shapes as the web badges); unknown keys get a tick. */
function AmenityIcon({ name, size = 14, color = ACCENT }: { name: string; size?: number; color?: string }) {
  const stroke = { stroke: color, strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", fill: "none" } as const;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === "floodlights" ? (
        <>
          <Path d="M12 3v2M5.6 5.6 7 7M18.4 5.6 17 7M3 12h2M19 12h2" {...stroke} />
          <Path d="M8 21h8M12 21v-5" {...stroke} />
          <Path d="M8 16h8a4 4 0 1 0-8 0Z" {...stroke} />
        </>
      ) : name === "parking" ? (
        <>
          <Rect x="4" y="3" width="16" height="18" rx="3" {...stroke} />
          <Path d="M9.5 17V7.5h3.2a2.8 2.8 0 0 1 0 5.6H9.5" {...stroke} />
        </>
      ) : name === "washrooms" ? (
        <>
          <Circle cx="7" cy="5" r="1.6" {...stroke} />
          <Circle cx="17" cy="5" r="1.6" {...stroke} />
          <Path d="M7 9v11M4.5 9.5h5M17 9l-2.5 8h5L17 9ZM17 17v3" {...stroke} />
        </>
      ) : name === "changing_room" ? (
        <Path d="M9 4 4 7l2 3 2-1v11h8V9l2 1 2-3-5-3a3 3 0 0 1-6 0Z" {...stroke} />
      ) : (
        <Path d="m5 12 4.5 4.5L19 7" {...stroke} />
      )}
    </Svg>
  );
}

/**
 * Amenity chips with an icon each. `max` collapses the rest into a "+N" chip (for cards); omit it to show every one.
 * Mirrors the web component of the same name.
 */
export function AmenityBadges({
  amenities,
  max,
  size = "sm",
}: {
  amenities: string[] | null | undefined;
  max?: number;
  size?: "sm" | "md";
}) {
  const list = amenities ?? [];
  if (list.length === 0) return null;
  const shown = max != null ? list.slice(0, max) : list;
  const hidden = list.length - shown.length;
  const md = size === "md";

  return (
    <View className="flex-row flex-wrap gap-1.5" accessibilityLabel="Amenities">
      {shown.map((key) => (
        <View
          key={key}
          className={`flex-row items-center border border-player-accent-soft-border bg-player-accent-soft ${md ? "gap-2 px-3 py-1.5 rounded-lg" : "gap-1.5 px-2 py-1 rounded-md"}`}
        >
          <AmenityIcon name={key} size={md ? 16 : 14} />
          <Text className={`font-figtree-semibold ${md ? "text-[13px]" : "text-[12px]"}`} style={{ color: ACCENT }}>
            {amenityLabel(key)}
          </Text>
        </View>
      ))}
      {hidden > 0 ? (
        <View className={`items-center justify-center bg-player-surface-2 ${md ? "px-3 py-1.5 rounded-lg" : "px-2 py-1 rounded-md"}`}>
          <Text className={`font-figtree-semibold text-player-ink-muted ${md ? "text-[13px]" : "text-[12px]"}`}>+{hidden}</Text>
        </View>
      ) : null}
    </View>
  );
}
