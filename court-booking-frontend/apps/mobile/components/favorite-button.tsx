import { useState } from "react";
import { Alert, Pressable, Text } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import Svg, { Path } from "react-native-svg";

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { FAVORITES_KEY, useFavorites } from "@/lib/use-favorites";

const HEART = "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z";

function Heart({ filled, size = 18, color }: { filled: boolean; size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? color : "none"}>
      <Path d={HEART} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/**
 * Save / un-save a venue. `card` is a round heart for the corner of a photo, `pill` is a labelled button for the venue
 * header. Flips at once and settles when the server answers; if the call fails it flips back and says so. Anyone who is not
 * a player (owners use other screens) gets nothing. Mirrors the web component of the same name.
 */
export function FavoriteButton({ venueId, venueName, variant = "card" }: { venueId: string; venueName: string; variant?: "card" | "pill" }) {
  const queryClient = useQueryClient();
  const status = useAuthStore((s) => s.status);
  const role = useAuthStore((s) => s.user?.role);
  const { enabled, loading, ids } = useFavorites();
  const [pending, setPending] = useState<boolean | null>(null);

  if (status === "signedIn" && role !== "player") return null;

  const saved = pending ?? ids.has(venueId);
  const busy = pending !== null || loading || !enabled;

  async function toggle() {
    if (busy) return;
    const next = !saved;
    setPending(next);
    try {
      if (next) await api.favorites.add(venueId);
      else await api.favorites.remove(venueId);
      await queryClient.invalidateQueries({ queryKey: FAVORITES_KEY });
    } catch (e) {
      Alert.alert("Couldn't update your saved venues", friendlyErrorMessage(e));
    } finally {
      setPending(null);
    }
  }

  const label = saved ? `Remove ${venueName} from saved venues` : `Save ${venueName}`;
  const color = saved ? "#EF5A2C" : "#5C544D";

  if (variant === "pill") {
    return (
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: saved, busy }}
        className="h-11 px-4 rounded-full flex-row items-center gap-2 border active:opacity-70"
        style={{ backgroundColor: saved ? "#FFF3EE" : "#FFFFFF", borderColor: saved ? "#F6DCD1" : "#E5DED8", opacity: busy ? 0.7 : 1 }}
      >
        <Heart filled={saved} size={17} color={color} />
        <Text className="font-figtree-bold text-[13.5px]" style={{ color: saved ? "#C8431C" : "#5C544D" }}>
          {saved ? "Saved" : "Save"}
        </Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={toggle}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: saved, busy }}
      hitSlop={6}
      className="w-10 h-10 rounded-full items-center justify-center active:opacity-70"
      style={{
        backgroundColor: "rgba(255,255,255,0.95)",
        opacity: busy ? 0.7 : 1,
        shadowColor: "#141A1D",
        shadowOpacity: 0.15,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 },
        elevation: 3,
      }}
    >
      <Heart filled={saved} color={color} />
    </Pressable>
  );
}
