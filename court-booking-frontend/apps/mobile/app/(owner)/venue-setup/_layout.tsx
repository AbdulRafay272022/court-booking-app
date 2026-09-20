import { Stack } from "expo-router";

export default function VenueSetupLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }} initialRouteName="register">
      <Stack.Screen name="register" />
      <Stack.Screen name="courts" />
      <Stack.Screen name="pending" />
      <Stack.Screen name="rejected" />
    </Stack>
  );
}
