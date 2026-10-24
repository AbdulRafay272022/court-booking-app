import { useMemo } from "react";
import { Stack } from "expo-router";
import { FontScaleProvider, LangProvider, RoleProvider, ToastProvider } from "@/components/ui";
import { usePlayerLang } from "@/lib/player-lang";
import { devFontScale } from "@/lib/dev-font-scale";

export default function AuthLayout() {
  const lang = usePlayerLang((s) => s.lang);
  const fs = useMemo(() => devFontScale(), []);
  // Floodlight role theme is chosen HERE, by route group, never per screen (docs/floodlight-ds-contract.md).
  return (
    <RoleProvider role="player">
      <LangProvider lang={lang}>
        <FontScaleProvider scale={fs}>
          <ToastProvider>
            <Stack screenOptions={{ headerShown: false }} initialRouteName="login">
              <Stack.Screen name="login" />
              <Stack.Screen name="signup" />
              <Stack.Screen name="verify" />
              <Stack.Screen name="forgot-password" />
              <Stack.Screen name="reset-password" />
            </Stack>
          </ToastProvider>
        </FontScaleProvider>
      </LangProvider>
    </RoleProvider>
  );
}
