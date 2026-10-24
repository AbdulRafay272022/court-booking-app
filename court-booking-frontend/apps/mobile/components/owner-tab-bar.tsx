import { router, useIsFocused } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { BottomTabBarProps } from "expo-router/tabs";
import { CalendarDays, Ellipsis, ShieldCheck, Wallet } from "lucide-react-native";
import { TabBar, type IconComponent, type TabItem } from "@/components/ui";

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { pollInterval } from "@/lib/polling";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { useMyPermissions } from "@/lib/use-my-permissions";
import { activeBarKey, ownerBarTabs, showWalkinFab, type OwnerBarKey } from "@/lib/owner-floodlight";

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

const ICON: Record<OwnerBarKey, IconComponent> = { aaj: CalendarDays, approvals: ShieldCheck, paisa: Wallet, aur: Ellipsis };

/**
 * The real tab bar of the owner `Tabs` navigator (OwnerToday board): Aaj · Approvals · teal "+" walk-in · Paisa · Aur, the
 * Floodlight glass TabBar. Paisa groups the Ledger and Refunds tab routes (both stay real routes for deep links and
 * notification paths). Staff only see the cells their permissions open and the "+" only with `walkin`; while a staff
 * account's permissions are still loading only "Aur" is shown, so a forbidden tab never flashes.
 */
export function OwnerTabBar({ state, navigation }: BottomTabBarProps) {
  const role = useAuthStore((s) => s.user?.role);
  const { can, settled } = useMyPermissions();
  // Focus of the whole tab group in the owner Stack: false while walk-in, history, ... are pushed over the tabs.
  const tabsFocused = useIsFocused();
  const badges = useOwnerBadges(tabsFocused);
  const activeRoute = state.routes[state.index]?.name;
  const lit = activeBarKey(activeRoute);
  const staffPending = role === "staff" && !settled;
  const tabs = staffPending ? ownerBarTabs(() => false) : ownerBarTabs(can);
  const count: Partial<Record<OwnerBarKey, number>> = { approvals: badges.approvals, paisa: can("mark_refunds") ? badges.refunds : 0 };

  const items: TabItem[] = tabs.map((t) => {
    const n = count[t.key] ?? 0;
    const route = state.routes.find((r) => r.name === t.route);
    const on = lit === t.key;
    return {
      key: t.key,
      label: t.label,
      icon: ICON[t.key],
      active: on,
      badge: n > 0 ? n : null,
      accessibilityLabel: n > 0 ? `${t.label}, ${badgeText(n)} baqi` : t.label,
      testID: `owner-tab-${t.key}`,
      onPress: () => {
        if (!route) return;
        const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
        if (!on && !event.defaultPrevented) navigation.navigate(route.name, route.params);
      },
    };
  });

  const fab = !staffPending && showWalkinFab(can) ? { accessibilityLabel: "Walk-in booking add karein", onPress: () => router.push("/(owner)/walkin"), testID: "owner-fab-walkin" } : undefined;
  return <TabBar items={items} fab={fab} testID="owner-tabbar" />;
}
