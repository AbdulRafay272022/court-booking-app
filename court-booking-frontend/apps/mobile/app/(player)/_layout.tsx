import { useMemo } from "react";
import { Stack } from "expo-router";
import { FontScaleProvider, LangProvider, RoleProvider, ToastProvider } from "@/components/ui";
import { usePlayerLang } from "@/lib/player-lang";
import { devFontScale } from "@/lib/dev-font-scale";
import { PlayerNetworkProvider } from "./_components";

/** Tabs live under (tabs); search and venue detail are full-screen pushes on
 * top of them (not additional tabs) -- keeping them siblings of the Tabs
 * navigator, rather than href:null screens inside it, avoids a real
 * react-native-web bug where a hidden-but-still-Tabs-owned screen can end up
 * stacked above the active tab and silently swallow touches. */
export default function PlayerLayout() {
  const lang = usePlayerLang((s) => s.lang);
  const fs = useMemo(() => devFontScale(), []);
  // Floodlight role theme + language are chosen HERE, by route group, never per screen (docs/floodlight-ds-contract.md).
  return (
    <RoleProvider role="player">
      <LangProvider lang={lang}>
        <FontScaleProvider scale={fs}>
          <ToastProvider>
            <PlayerNetworkProvider>
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
            </PlayerNetworkProvider>
          </ToastProvider>
        </FontScaleProvider>
      </LangProvider>
    </RoleProvider>
  );
}
