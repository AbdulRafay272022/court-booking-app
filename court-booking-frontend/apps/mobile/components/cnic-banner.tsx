import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { create } from "zustand";
import { ChevronRight, IdCard } from "lucide-react-native";
import { palette, radius, size, space } from "@court-booking/ui-tokens";
import { Text } from "@/components/ui";

import { useOwnerIdentity } from "./identity-card";

/** Dismissed for this app session only (memory, not persisted): the row comes back on the next launch. */
const useBannerDismissed = create<{ dismissed: boolean; dismiss: () => void }>()((set) => ({
  dismissed: false,
  dismiss: () => set({ dismissed: true }),
}));

/**
 * OwnerToday's slim CNIC row while the owner's CNIC is missing. Never locks anything out; "Baad mein" hides it until the
 * app is opened again. Opens Venue settings straight at the CNIC card. Renders nothing for staff, on errors, or once a
 * CNIC is on file.
 */
export function CnicBanner() {
  const q = useOwnerIdentity();
  const { dismissed, dismiss } = useBannerDismissed();
  if (dismissed || q.data?.status !== "missing") return null;
  return (
    <View testID="cnic-banner" style={{ flexDirection: "row", alignItems: "center", gap: space[2], backgroundColor: palette.white, borderRadius: 18, paddingLeft: space[3], paddingRight: space[1], minHeight: 50 }}>
      <Pressable
        onPress={() => router.push({ pathname: "/(owner)/venue-settings", params: { section: "cnic" } })}
        accessibilityRole="button"
        accessibilityLabel="CNIC verify karein, payout ke liye, 1 minute"
        style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10, minHeight: size.tap, paddingVertical: space[2] }}
      >
        <IdCard size={18} color={palette.teal} />
        <Text variant="body" style={{ flex: 1 }}>
          <Text variant="bodyBold">CNIC verify karein</Text>
          <Text variant="body" tone="muted">
            {" · payout ke liye, 1 minute"}
          </Text>
        </Text>
        <ChevronRight size={16} color={palette.muted} />
      </Pressable>
      <Pressable onPress={dismiss} accessibilityRole="button" accessibilityLabel="Baad mein" style={{ minHeight: size.tap, paddingHorizontal: space[2], justifyContent: "center", borderRadius: radius.sm }}>
        <Text variant="label" tone="muted">
          Baad mein
        </Text>
      </Pressable>
    </View>
  );
}
