import { router } from "expo-router";
import { AccountScreen } from "@/components/auth/kit";
import { ChangePhoneForm } from "@/components/account/forms";

export default function PlayerChangePhoneScreen() {
  return (
    <AccountScreen tone="player" title="Change phone number" onBack={() => router.back()}>
      <ChangePhoneForm tone="player" />
    </AccountScreen>
  );
}
