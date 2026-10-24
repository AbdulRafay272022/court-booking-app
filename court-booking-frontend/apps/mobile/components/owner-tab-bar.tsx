import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { useIsFocused } from "expo-router";
import type { BottomTabBarProps } from "expo-router/tabs";

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { pollInterval } from "@/lib/polling";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { useMyPermissions } from "@/lib/use-my-permissions";
import { OV } from "@/lib/overview";
import { OWNER_TABS, tabAllowed, type OwnerTabKey } from "@/lib/owner-access";
import { ApprovalsIcon, DotsIcon, GridIcon, LedgerTabIcon } from "@/components/overview/icons";
import { RefreshIcon } from "@/components/icons";

export type OwnerTab = OwnerTabKey;

export function badgeText(n: number): string {
  return n > 99 ? "99+" : String(n);
}

/** Pending counts for the Approvals and Refunds tabs, polled every 15 s while the tab bar is on screen (`subscribed`:
 * a screen pushed over the tabs stops it; TanStack's focusManager stops it in the background, lib/query-client.ts).
 * Only asked for when this account may see at least one of the two counts, so staff without access cause no 403 noise. */
export function useOwnerBadges(active = true) {
  const { activeVenueId } = useOwnerVenues();
  const { can } = useMyPermissions();
  const mayAsk = can("view_ledger") || can("mark_refunds");
  const q = useQuery({
    queryKey: ["owner-badges", activeVenueId],
    queryFn: () => api.owners.badges(activeVenueId),
    enabled: !!activeVenueId && mayAsk,
    refetchInterval: (query) => pollInterval(query, 15_000),
    retry: false,
    subscribed: active,
  });
  return q.data ?? { approvals: 0, refunds: 0 };
}

/** The real tab bar of the owner `Tabs` navigator (app/(owner)/(tabs)/_layout.tsx): switching tabs no longer pushes a
 * new screen onto a Stack (the old fake tab bar did, so the stack grew and Back walked through tab history). Staff only
 * see the tabs their permissions open; while a staff account's permissions are still loading only "Aur" is shown, so a
 * forbidden tab never flashes. */
export function OwnerTabBar({ state, navigation }: BottomTabBarProps) {
  const role = useAuthStore((s) => s.user?.role);
  const { can, settled } = useMyPermissions();
  // Focus of the whole tab group in the owner Stack: false while walk-in, history, ... are pushed over the tabs.
  const tabsFocused = useIsFocused();
  const badges = useOwnerBadges(tabsFocused);
  const insets = useSafeAreaInsets();
  const count: Partial<Record<OwnerTab, number>> = { approvals: badges.approvals, refunds: badges.refunds };
  const activeRoute = state.routes[state.index]?.name;
  const staffPending = role === "staff" && !settled;

  return (
    <View
      accessibilityRole="tablist"
      className="flex-row bg-owner-surface border-t border-owner-border"
      style={{ paddingBottom: Math.max(insets.bottom, 6) }}
    >
      {OWNER_TABS.filter((t) => (staffPending ? t.key === "more" : tabAllowed(t.key, can))).map((t) => {
        const on = t.route === activeRoute;
        const color = on ? OV.ink : OV.muted;
        const n = count[t.key] ?? 0;
        const route = state.routes.find((r) => r.name === t.route);
        return (
          <Pressable
            key={t.key}
            onPress={() => {
              if (!route) return;
              const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
              if (!on && !event.defaultPrevented) navigation.navigate(route.name, route.params);
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
