import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { create } from "zustand";

import { useOwnerIdentity } from "./identity-card";

/** Dismissed for this app session only (memory, not persisted): the banner comes back on the next launch. */
const useBannerDismissed = create<{ dismissed: boolean; dismiss: () => void }>()((set) => ({
  dismissed: false,
  dismiss: () => set({ dismissed: true }),
}));

/**
 * Stage 2: soft "CNIC dein" reminder on the owner Overview while the owner's CNIC is missing. Never locks anything out;
 * "Baad mein" hides it until the app is opened again. Renders nothing for staff, on errors, or once a CNIC is on file.
 */
export function CnicBanner() {
  const q = useOwnerIdentity();
  const { dismissed, dismiss } = useBannerDismissed();
  if (dismissed || q.data?.status !== "missing") return null;
  return (
    <View
      testID="cnic-banner"
      className="rounded-2xl px-4 py-3 gap-2"
      style={{ backgroundColor: "#FFF6E5", borderWidth: 1.5, borderColor: "#F2D49B" }}
    >
      <Text className="font-plex-bold text-owner-ink text-[14.5px]">CNIC dein</Text>
      <Text className="font-plex-medium text-owner-ink-muted text-[12.5px]">
        Apna shanakhti card (CNIC) aur us ki dono taraf ki photo dein, taa ke hum aap ki venue verify kar sakein. Is mein 1
        minute lagta hai.
      </Text>
      <View className="flex-row gap-2">
        <Pressable
          onPress={() => router.push("/(owner)/venue-settings" as never)}
          accessibilityRole="button"
          accessibilityLabel="CNIC dein"
          className="min-h-11 px-4 rounded-lg bg-owner-accent items-center justify-center"
        >
          <Text className="font-plex-semibold text-white text-[13.5px]">CNIC dein</Text>
        </Pressable>
        <Pressable
          onPress={dismiss}
          accessibilityRole="button"
          accessibilityLabel="Baad mein"
          className="min-h-11 px-4 rounded-lg items-center justify-center"
        >
          <Text className="font-plex-semibold text-owner-ink-muted text-[13.5px]">Baad mein</Text>
        </Pressable>
      </View>
    </View>
  );
}
