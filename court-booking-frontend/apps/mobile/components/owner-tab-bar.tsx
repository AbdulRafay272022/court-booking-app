import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { pollInterval } from "@/lib/polling";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { OV } from "@/lib/overview";
import { ApprovalsIcon, DotsIcon, GridIcon, LedgerTabIcon } from "@/components/overview/icons";
import { RefreshIcon } from "@/components/icons";

export type OwnerTab = "overview" | "approvals" | "refunds" | "ledger" | "more";

export function badgeText(n: number): string {
  return n > 99 ? "99+" : String(n);
}

/** Pending counts for the Approvals and Refunds tabs, polled every 15 s. TanStack's focusManager is wired to AppState in
 * lib/query-client.ts, so polling stops while the app is in the background. A 403 (staff without access) just shows no badge. */
export function useOwnerBadges() {
  const { activeVenueId } = useOwnerVenues();
  const q = useQuery({
    queryKey: ["owner-badges", activeVenueId],
    queryFn: () => api.owners.badges(activeVenueId),
    enabled: !!activeVenueId,
    refetchInterval: (query) => pollInterval(query, 15_000),
    retry: false,
  });
  return q.data ?? { approvals: 0, refunds: 0 };
}

const TABS: { key: OwnerTab; label: string; path: string }[] = [
  { key: "overview", label: "Overview", path: "/(owner)/today" },
  { key: "approvals", label: "Approvals", path: "/(owner)/approvals" },
  { key: "refunds", label: "Refunds", path: "/(owner)/refunds" },
  { key: "ledger", label: "Ledger", path: "/(owner)/ledger" },
  { key: "more", label: "Aur", path: "/(owner)/more" },
];

export function OwnerTabBar({ active }: { active: OwnerTab }) {
  const badges = useOwnerBadges();
  const insets = useSafeAreaInsets();
  const count: Partial<Record<OwnerTab, number>> = { approvals: badges.approvals, refunds: badges.refunds };

  return (
    <View
      accessibilityRole="tablist"
      className="flex-row bg-owner-surface border-t border-owner-border"
      style={{ paddingBottom: Math.max(insets.bottom, 6) }}
    >
      {TABS.map((t) => {
        const on = t.key === active;
        const color = on ? OV.ink : OV.muted;
        const n = count[t.key] ?? 0;
        return (
          <Pressable
            key={t.key}
            onPress={() => {
              if (!on) router.navigate(t.path as never);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={n > 0 ? `${t.label}, ${badgeText(n)} pending` : t.label}
            className="flex-1 items-center justify-center gap-0.5"
            style={{ minHeight: 58 }}
          >
            <View>
              {t.key === "overview" ? <GridIcon color={color} /> : null}
              {t.key === "approvals" ? <ApprovalsIcon color={color} /> : null}
              {t.key === "refunds" ? <RefreshIcon size={22} color={color} strokeWidth={1.9} /> : null}
              {t.key === "ledger" ? <LedgerTabIcon color={color} /> : null}
              {t.key === "more" ? <DotsIcon color={color} /> : null}
              {n > 0 ? (
                <View
                  className="absolute items-center justify-center rounded-full"
                  style={{ top: -6, right: -12, minWidth: 18, height: 18, paddingHorizontal: 4, backgroundColor: OV.orange }}
                >
                  <Text className="font-plex-bold text-owner-ink text-[10.5px]">{badgeText(n)}</Text>
                </View>
              ) : null}
            </View>
            <Text className="text-[11.5px]" style={{ color, fontFamily: on ? "IBMPlexSans_700Bold" : "IBMPlexSans_500Medium" }}>
              {t.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
