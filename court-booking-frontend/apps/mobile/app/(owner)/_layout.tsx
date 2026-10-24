import { Stack } from "expo-router";
import { RoleProvider, ToastProvider } from "@/components/ui";

/** The five owner tabs live under (tabs) (a real Tabs navigator); every other owner screen is a full-screen push on
 * top of them. Same Tabs-in-Stack shape as the player side. */
export default function OwnerLayout() {
  // Floodlight role theme is chosen HERE, by route group, never per screen (docs/floodlight-ds-contract.md).
  return (
    <RoleProvider role="owner">
      <ToastProvider>
        <Stack screenOptions={{ headerShown: false }} initialRouteName="index">
          <Stack.Screen name="index" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="walkin" />
          <Stack.Screen name="history" />
          <Stack.Screen name="staff" />
          <Stack.Screen name="premium" />
          <Stack.Screen name="notifications" />
          <Stack.Screen name="venue-setup" />
          <Stack.Screen name="account" />
          <Stack.Screen name="change-phone" />
        </Stack>
      </ToastProvider>
    </RoleProvider>
  );
}
