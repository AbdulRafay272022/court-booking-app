import { router } from "expo-router";
import { AccountScreen } from "@/components/auth/kit";
import { ChangePhoneForm } from "@/components/account/forms";

export default function OwnerChangePhoneScreen() {
  return (
    <AccountScreen tone="owner" title="Change phone number" onBack={() => router.back()}>
      <ChangePhoneForm tone="owner" />
    </AccountScreen>
  );
}
