import { View } from "react-native";
import { space } from "@court-booking/ui-tokens";
import { Screen } from "@/components/ui";

import { NotificationsList } from "@/components/notification-row";
import { OwnerHeader } from "./_fl";

/** The owner's list behind the bell (Owner Round 2, A6): readable sentences from the notification feed. The list itself
 * is the shared components/notification-row (player + owner), unchanged here. */
export default function OwnerNotificationsScreen() {
  return (
    <Screen scroll={false} gutter={false} testID="owner-notifications">
      <View style={{ paddingHorizontal: space[4], paddingBottom: space[2] }}>
        <OwnerHeader title="Notifications" />
      </View>
      <NotificationsList tone="owner" />
    </Screen>
  );
}
