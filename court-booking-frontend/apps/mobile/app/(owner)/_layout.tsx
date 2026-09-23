import { Stack } from "expo-router";

export default function OwnerLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }} initialRouteName="index">
      <Stack.Screen name="index" />
      <Stack.Screen name="today" />
      <Stack.Screen name="approvals" />
      <Stack.Screen name="walkin" />
      <Stack.Screen name="ledger" />
      <Stack.Screen name="refunds" />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="venue-setup" />
      <Stack.Screen name="account" />
      <Stack.Screen name="change-phone" />
    </Stack>
  );
}
