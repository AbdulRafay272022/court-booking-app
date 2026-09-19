import "../global.css";
import { useEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import * as Notifications from "expo-notifications";
import * as SplashScreen from "expo-splash-screen";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import {
  useFonts as useFigtreeFonts,
  Figtree_400Regular,
  Figtree_500Medium,
  Figtree_600SemiBold,
  Figtree_700Bold,
  Figtree_800ExtraBold,
} from "@expo-google-fonts/figtree";
import {
  useFonts as usePlexSansFonts,
  IBMPlexSans_400Regular,
  IBMPlexSans_500Medium,
  IBMPlexSans_600SemiBold,
  IBMPlexSans_700Bold,
} from "@expo-google-fonts/ibm-plex-sans";
import {
  useFonts as usePlexMonoFonts,
  IBMPlexMono_400Regular,
  IBMPlexMono_500Medium,
  IBMPlexMono_600SemiBold,
} from "@expo-google-fonts/ibm-plex-mono";

import { api } from "@/lib/api";
import { queryClient } from "@/lib/query-client";
import { useAuthStore } from "@/lib/auth-store";
import { registerForPushNotifications } from "@/lib/push-notifications";
import { OfflineBanner } from "@/components/offline-banner";

SplashScreen.preventAutoHideAsync();

// Foreground notifications still show a banner/sound (default RN behavior) rather than
// being silently swallowed -- push is a rare enough event that this shouldn't be noisy.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/** Section 10.2: map a notification's event_type to where it should deep-link. This
 * depends on the backend attaching a `data` payload to push messages, which
 * FRONTEND_INTEGRATION.md documents as not shipped yet (title/body text only) --
 * this listener is correct and ready, but untestable until that lands. Until then it
 * silently no-ops (falls through to whatever screen the app was already showing). */
function routeForNotification(data: Record<string, unknown> | undefined): void {
  if (!data) return;
  const eventType = String(data.event_type ?? "");
  const referenceId = data.reference_id ? String(data.reference_id) : undefined;

  if (eventType === "payment_submitted") {
    router.push("/(owner)/approvals");
  } else if ((eventType === "booking_confirmed" || eventType === "payment_rejected") && referenceId) {
    router.push({ pathname: "/(player)/booking/[id]/pay", params: { id: referenceId } });
  } else if (eventType.includes("slot") || eventType === "waitlist_slot_available") {
    router.push("/(player)/search");
  }
}

export default function RootLayout() {
  const [figtreeLoaded] = useFigtreeFonts({
    Figtree_400Regular,
    Figtree_500Medium,
    Figtree_600SemiBold,
    Figtree_700Bold,
    Figtree_800ExtraBold,
  });
  const [plexSansLoaded] = usePlexSansFonts({
    IBMPlexSans_400Regular,
    IBMPlexSans_500Medium,
    IBMPlexSans_600SemiBold,
    IBMPlexSans_700Bold,
  });
  const [plexMonoLoaded] = usePlexMonoFonts({
    IBMPlexMono_400Regular,
    IBMPlexMono_500Medium,
    IBMPlexMono_600SemiBold,
  });

  const status = useAuthStore((s) => s.status);
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const role = useAuthStore((s) => s.user?.role);
  const fontsLoaded = figtreeLoaded && plexSansLoaded && plexMonoLoaded;
  const ready = fontsLoaded && hasHydrated && status !== "hydrating";

  useEffect(() => {
    (async () => {
      await useAuthStore.getState().hydrate();
      const token = useAuthStore.getState().token;
      if (!token) return;
      try {
        const { user, session } = await api.auth.me();
        useAuthStore.getState().setUser(user, session);
      } catch {
        // A 401 already triggers onUnauthorized -> signOut() inside the api client.
        // Anything else (e.g. offline at launch) falls back to the login screen
        // without discarding the token, so a later launch can retry.
        useAuthStore.getState().markUnverified();
      }
    })();
  }, []);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  useEffect(() => {
    if (status === "signedIn") registerForPushNotifications();
  }, [status]);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      routeForNotification(response.notification.request.content.data as Record<string, unknown> | undefined);
    });
    return () => sub.remove();
  }, []);

  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="dark" />
        <OfflineBanner />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Protected guard={status === "signedOut"}>
            <Stack.Screen name="(auth)" />
          </Stack.Protected>
          <Stack.Protected guard={status === "signedIn" && role === "player"}>
            <Stack.Screen name="(player)" />
          </Stack.Protected>
          <Stack.Protected guard={status === "signedIn" && role === "owner"}>
            <Stack.Screen name="(owner)" />
          </Stack.Protected>
          <Stack.Protected guard={status === "signedIn" && role === "admin"}>
            <Stack.Screen name="(admin)" />
          </Stack.Protected>
        </Stack>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
