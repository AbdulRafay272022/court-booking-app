import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { space } from "@court-booking/ui-tokens";
import { Banner } from "@/components/ui";

import { api } from "@/lib/api";

const TONE = { info: "info", urgent: "waiting", off: "danger" } as const;

/** Banners about premium payments at the top of Today (an owner only): a period ending within a week, an overdue payment
 * that still works for a few more days, or a feature that has switched off. Nothing shows while billing is not enforced.
 * The message is server text (contract: premium notices[].message). */
export function PremiumNotices() {
  const query = useQuery({ queryKey: ["owner-premium-notices"], queryFn: () => api.premium.notices(), staleTime: 5 * 60_000, retry: false });
  const notices = query.data ?? [];
  if (notices.length === 0) return null;
  return (
    <View style={{ gap: space[2] }}>
      {notices.map((n) => (
        <Pressable key={n.feature_key} onPress={() => router.push("/(owner)/premium")} accessibilityRole="button" accessibilityLabel={`${n.message}. Premium kholein`}>
          <Banner tone={TONE[n.level] ?? "info"} body={n.message} />
        </Pressable>
      ))}
    </View>
  );
}
