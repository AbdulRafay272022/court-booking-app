import { Platform } from "react-native";
import { Stack } from "expo-router";
import { FontScaleProvider, LangProvider, RoleProvider, ToastProvider } from "@/components/ui";

import { useOwnerLang } from "@/lib/owner-lang";

/** Expo web has no OS font scale: in development only, `?fs=1.3` (kept for the tab session) previews large font on the
 * owner screens, the same way the DS dev page does. On a phone the OS setting scales text instead (and this is 1). */
function devFontScale(): number {
  if (!__DEV__ || Platform.OS !== "web" || typeof window === "undefined") return 1;
  try {
    const q = new URLSearchParams(window.location.search).get("fs");
    if (q) window.sessionStorage.setItem("fl.fs", q);
    const v = Number(q ?? window.sessionStorage.getItem("fl.fs") ?? "1");
    return v >= 1 && v <= 2 ? v : 1;
  } catch {
    return 1;
  }
}

/** The owner tabs live under (tabs) (a real Tabs navigator); every other owner screen is a full-screen push on top of
 * them. Same Tabs-in-Stack shape as the player side. */
export default function OwnerLayout() {
  const lang = useOwnerLang((s) => s.lang);
  // Floodlight role theme is chosen HERE, by route group, never per screen (docs/floodlight-ds-contract.md).
  return (
    <RoleProvider role="owner">
      <LangProvider lang={lang}>
        <FontScaleProvider scale={devFontScale()}>
          <ToastProvider>
            <Stack screenOptions={{ headerShown: false }} initialRouteName="index">
              <Stack.Screen name="index" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="walkin" />
              <Stack.Screen name="history" />
              <Stack.Screen name="staff" />
              <Stack.Screen name="staff-activity" />
              <Stack.Screen name="bank-check" />
              <Stack.Screen name="dues" />
              <Stack.Screen name="premium" />
              <Stack.Screen name="notifications" />
              <Stack.Screen name="venue-setup" />
              <Stack.Screen name="account" />
              <Stack.Screen name="change-phone" />
            </Stack>
          </ToastProvider>
        </FontScaleProvider>
      </LangProvider>
    </RoleProvider>
  );
}
