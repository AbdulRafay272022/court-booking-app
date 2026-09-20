import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { AccountScreen } from "@/components/auth/kit";
import { ProfileForm } from "@/components/account/forms";
import { confirmLogout } from "@/lib/logout";

/** Owner account (profile, phone, password, log out). Owners had no profile screen at all. */
export default function OwnerAccountScreen() {
  return (
    <AccountScreen tone="owner" title="Your account" onBack={() => router.back()}>
      <ProfileForm tone="owner" changePhoneRoute="/(owner)/change-phone" />
      <View>
        <Pressable onPress={confirmLogout} accessibilityRole="button" className="min-h-12 rounded-[10px] border border-owner-border items-center justify-center">
          <Text className="font-plex-semibold text-owner-ink-muted text-[14.5px]">Log out</Text>
        </Pressable>
      </View>
    </AccountScreen>
  );
}
