import { View } from "react-native";
import { router } from "expo-router";
import { space } from "@court-booking/ui-tokens";
import { Header, Screen } from "@/components/ui";

import { NotificationsList } from "@/components/notification-row";

/** audit 2026-10-28 Phase 2 item 4: the admin's alerts (new venues waiting, payments, refunds): the same notification feed as
 * the owner's bell, read for the admin account. */
export default function AdminAlertsScreen() {
  return (
    <Screen scroll={false} gutter={false} testID="admin-alerts-screen">
      <View style={{ paddingHorizontal: space[4], paddingBottom: space[2] }}>
        <Header title="Alerts" onBack={() => router.back()} />
      </View>
      <NotificationsList tone="owner" />
    </Screen>
  );
}
