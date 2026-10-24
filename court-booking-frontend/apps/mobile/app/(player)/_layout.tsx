import { Stack } from "expo-router";
import { RoleProvider, ToastProvider } from "@/components/ui";

/** Tabs live under (tabs); search and venue detail are full-screen pushes on
 * top of them (not additional tabs) -- keeping them siblings of the Tabs
 * navigator, rather than href:null screens inside it, avoids a real
 * react-native-web bug where a hidden-but-still-Tabs-owned screen can end up
 * stacked above the active tab and silently swallow touches. */
export default function PlayerLayout() {
  // Floodlight role theme is chosen HERE, by route group, never per screen (docs/floodlight-ds-contract.md).
  return (
    <RoleProvider role="player">
      <ToastProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="search" />
          <Stack.Screen name="venue/[slug]" />
          <Stack.Screen name="booking/[id]/chat" />
          <Stack.Screen name="booking/[id]/pay" />
          <Stack.Screen name="booking/[id]/done" />
          <Stack.Screen name="notifications" />
          <Stack.Screen name="edit-profile" />
          <Stack.Screen name="change-phone" />
        </Stack>
      </ToastProvider>
    </RoleProvider>
  );
}
