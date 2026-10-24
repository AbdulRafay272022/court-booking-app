import "../global.css";
import { useEffect } from "react";
import { AppState } from "react-native";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import * as Notifications from "expo-notifications";
import * as SplashScreen from "expo-splash-screen";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
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
// Floodlight fonts (weights used by design/khelo-mobile-floodlight/System.dc.html). Loaded now so the
// design-system phase can switch to them; no screen uses them yet.
import {
  useFonts as useBricolageFonts,
  BricolageGrotesque_600SemiBold,
  BricolageGrotesque_700Bold,
  BricolageGrotesque_800ExtraBold,
} from "@expo-google-fonts/bricolage-grotesque";
import {
  useFonts as useJakartaFonts,
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from "@expo-google-fonts/plus-jakarta-sans";

import { REFRESH_CHECK_INTERVAL_MS, restoreSession, shouldRefreshSoon } from "@court-booking/api-client";
import { api } from "@/lib/api";
import { queryClient } from "@/lib/query-client";
import { useAuthStore } from "@/lib/auth-store";
import { registerForPushNotifications } from "@/lib/push-notifications";
import { OfflineBanner } from "@/components/offline-banner";
import { SessionUnreachable } from "@/components/session-unreachable";
import { initSentry, wrapRoot } from "@/lib/sentry";

// No-op unless EXPO_PUBLIC_SENTRY_DSN is set (lib/sentry.ts).
initSentry();

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

/** Section 10.2: map a notification's event_type to where it should deep-link. The
 * backend attaches `{event_type, reference_id?}` as the FCM `data` payload
 * (NotificationService._send_push_tier). Events with no route here (or no
 * `reference_id` where one is needed) just open the app on whatever it was showing. */
function routeForNotification(data: Record<string, unknown> | undefined): void {
  if (!data) return;
  const eventType = String(data.event_type ?? "");
  const referenceId = data.reference_id ? String(data.reference_id) : undefined;

  if (eventType === "payment_submitted" || eventType === "late_payment_proof") {
    router.push("/(owner)/(tabs)/approvals");
  } else if ((eventType === "booking_confirmed" || eventType === "payment_rejected") && referenceId) {
    router.push({ pathname: "/(player)/booking/[id]/pay", params: { id: referenceId } });
  } else if (eventType.includes("slot") || eventType === "waitlist_slot_available") {
    router.push("/(player)/search");
  }
}

function RootLayout() {
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

  const [bricolageLoaded] = useBricolageFonts({
    BricolageGrotesque_600SemiBold,
    BricolageGrotesque_700Bold,
    BricolageGrotesque_800ExtraBold,
  });
  const [jakartaLoaded] = useJakartaFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });

  const status = useAuthStore((s) => s.status);
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const role = useAuthStore((s) => s.user?.role);
  const fontsLoaded = figtreeLoaded && plexSansLoaded && plexMonoLoaded && bricolageLoaded && jakartaLoaded;
  const ready = fontsLoaded && hasHydrated && status !== "hydrating";

  const restore = async (isRetry = false) => {
    if (!isRetry) await useAuthStore.getState().hydrate();
    if (!useAuthStore.getState().token) return;
    // Retried with backoff. Only a real 401 signs the user out (the api client already did that on
    // its 401 -> refresh -> onUnauthorized path); a flaky network on launch must NOT drop a valid
    // stored session onto the login screen -- logging in again costs a WhatsApp send (and may not
    // even be deliverable), and wouldn't fix a network problem anyway.
    const result = await restoreSession(() => api.auth.me());
    if (result.kind === "ok") useAuthStore.getState().setUser(result.data.user, result.data.session);
    else if (result.kind === "unreachable") await useAuthStore.getState().markUnreachable();
  };

  useEffect(() => {
    void restore();
  }, []);

  // Proactive refresh (Section 26): sessions last 8h, so renew BEFORE expiry -- when the app returns
  // to the foreground and on a timer while it's open -- rather than waiting for a 401 (by then the
  // token is already dead and there is nothing left to refresh).
  useEffect(() => {
    let running = false;
    async function maybeRefresh() {
      const { status: s, expiresAt } = useAuthStore.getState();
      if (running || s !== "signedIn" || !shouldRefreshSoon(expiresAt)) return;
      running = true;
      try {
        await api.client.refreshSession();
      } finally {
        running = false;
      }
    }
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void maybeRefresh();
    });
    const timer = setInterval(maybeRefresh, REFRESH_CHECK_INTERVAL_MS);
    void maybeRefresh();
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [status]);

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
    <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <BottomSheetModalProvider>
        <StatusBar style="dark" />
        {/* Player + auth screens show the Floodlight OfflineBanner in their own layout (one /health poller there); owner/staff/admin keep this one until M2 switches. */}
        {status === "signedIn" && role !== "player" ? <OfflineBanner /> : null}
        {status === "unreachable" ? (
          <SessionUnreachable onRetry={() => void restore(true)} />
        ) : (
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Protected guard={status === "signedOut"}>
            <Stack.Screen name="(auth)" />
          </Stack.Protected>
          <Stack.Protected guard={status === "signedIn" && role === "player"}>
            <Stack.Screen name="(player)" />
          </Stack.Protected>
          {/* Staff accounts (Section 32 Part 12) use the owner screens with a reduced view, like web's owner shell. */}
          <Stack.Protected guard={status === "signedIn" && (role === "owner" || role === "staff")}>
            <Stack.Screen name="(owner)" />
          </Stack.Protected>
          <Stack.Protected guard={status === "signedIn" && role === "admin"}>
            <Stack.Screen name="(admin)" />
          </Stack.Protected>
        </Stack>
        )}
        </BottomSheetModalProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

// Sentry.wrap only when a DSN is configured; otherwise the component is exported untouched.
export default wrapRoot(RootLayout);
