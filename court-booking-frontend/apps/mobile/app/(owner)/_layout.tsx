import { Stack } from "expo-router";

export default function OwnerLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }} initialRouteName="index">
      <Stack.Screen name="index" />
      <Stack.Screen name="today" />
      <Stack.Screen name="approvals" />
      <Stack.Screen name="walkin" />
      <Stack.Screen name="ledger" />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="venue-setup" />
    </Stack>
  );
}
