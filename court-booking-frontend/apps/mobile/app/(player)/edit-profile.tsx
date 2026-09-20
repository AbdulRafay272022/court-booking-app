import { router } from "expo-router";
import { AccountScreen } from "@/components/auth/kit";
import { ProfileForm } from "@/components/account/forms";

export default function PlayerEditProfileScreen() {
  return (
    <AccountScreen tone="player" title="Edit profile" onBack={() => router.back()}>
      <ProfileForm tone="player" changePhoneRoute="/(player)/change-phone" />
    </AccountScreen>
  );
}
