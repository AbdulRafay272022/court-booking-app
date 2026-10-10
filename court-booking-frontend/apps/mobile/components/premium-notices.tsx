import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";

const STYLE = {
  info: { bg: "#E7F2F5", fg: "#0E6274", border: "#BFDDE5" },
  urgent: { bg: "#FBF0DD", fg: "#8A5208", border: "#EBCB93" },
  off: { bg: "#F9E3E1", fg: "#A32018", border: "#EDB5B0" },
} as const;

/** Banners about premium payments at the top of Today (an owner only): a period ending within a week, an overdue payment
 * that still works for a few more days, or a feature that has switched off. Nothing shows while billing is not enforced. */
export function PremiumNotices() {
  const query = useQuery({ queryKey: ["owner-premium-notices"], queryFn: () => api.premium.notices(), staleTime: 5 * 60_000, retry: false });
  const notices = query.data ?? [];
  if (notices.length === 0) return null;
  return (
    <View className="gap-2">
      {notices.map((n) => {
        const c = STYLE[n.level];
        return (
          <Pressable
            key={n.feature_key}
            onPress={() => router.push("/(owner)/premium")}
            className="rounded-[10px] px-3.5 py-3"
            style={{ backgroundColor: c.bg, borderWidth: 1, borderColor: c.border }}
          >
            <Text className="font-plex-semibold text-[13px] leading-[18px]" style={{ color: c.fg }}>
              {n.message}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
