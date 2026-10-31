import { Stack } from "expo-router";

/** audit 2026-10-28 Phase 2 item 4: the admin's core tools in the app. */
export default function AdminLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="venues" />
      <Stack.Screen name="identities" />
      <Stack.Screen name="refunds" />
      <Stack.Screen name="alerts" />
      <Stack.Screen name="money-health" />
    </Stack>
  );
}
