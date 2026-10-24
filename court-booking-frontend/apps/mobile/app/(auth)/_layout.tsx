import { Stack } from "expo-router";
import { RoleProvider, ToastProvider } from "@/components/ui";

export default function AuthLayout() {
  // Floodlight role theme is chosen HERE, by route group, never per screen (docs/floodlight-ds-contract.md).
  return (
    <RoleProvider role="player">
      <ToastProvider>
        <Stack screenOptions={{ headerShown: false }} initialRouteName="login">
          <Stack.Screen name="login" />
          <Stack.Screen name="signup" />
          <Stack.Screen name="verify" />
          <Stack.Screen name="forgot-password" />
          <Stack.Screen name="reset-password" />
        </Stack>
      </ToastProvider>
    </RoleProvider>
  );
}
