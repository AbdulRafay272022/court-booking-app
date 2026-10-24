import { Tabs } from "expo-router";

import { OwnerTabBar } from "@/components/owner-tab-bar";

/** The owner's five bottom tabs, a real Tabs navigator like the player side (`(player)/(tabs)`). Everything else on the
 * owner side (walk-in, history, settings, check-in, ...) stays a full-screen push in the parent Stack
 * (`(owner)/_layout.tsx`), so it covers the tab bar and Back returns to the tab it came from. Back on a tab goes to
 * Overview first, then leaves the app (`backBehavior: "firstRoute"`). */
export default function OwnerTabsLayout() {
  return (
    <Tabs
      initialRouteName="today"
      backBehavior="firstRoute"
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <OwnerTabBar {...props} />}
    >
      <Tabs.Screen name="today" />
      <Tabs.Screen name="approvals" />
      <Tabs.Screen name="refunds" />
      <Tabs.Screen name="ledger" />
      <Tabs.Screen name="more" />
    </Tabs>
  );
}
