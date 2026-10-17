import { Text, View } from "react-native";

import { useUnreadNotifications } from "@/lib/use-unread-notifications";

/** Unread-count pill for a bell button. Render it inside the bell's (relatively positioned) Pressable. */
export function BellBadge() {
  const { unread, label } = useUnreadNotifications();
  if (unread <= 0) return null;
  return (
    <View
      pointerEvents="none"
      testID="bell-badge"
      accessibilityLabel={`${unread} unread notifications`}
      style={{
        position: "absolute",
        top: -4,
        right: -4,
        minWidth: 20,
        height: 20,
        paddingHorizontal: 5,
        borderRadius: 10,
        backgroundColor: "#D8421F",
        borderWidth: 2,
        borderColor: "#FFFFFF",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: "#FFFFFF", fontSize: 10.5, fontWeight: "700", lineHeight: 13 }}>{label}</Text>
    </View>
  );
}
