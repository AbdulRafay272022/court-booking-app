import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { confirmLogout } from "@/lib/logout";
import { permissionAllows } from "@/lib/overview";
import { firstAllowedTabRoute } from "@/lib/owner-access";
import { queryClient } from "@/lib/query-client";
import { AlertTriangleIcon, RefreshIcon } from "@/components/icons";

/**
 * Per Section 6.1: an owner with zero venues goes straight to the setup wizard;
 * one with a venue still under review sees the pending screen; otherwise, Today.
 * Staff have no venues of their own (the API lists the venues they work at) and never run the setup wizard: straight to
 * Overview, like web's owner shell.
 * If the venues call fails the owner gets Retry and Log out: this screen is the only way into the owner app, so a bare
 * error message used to trap them (docs/mobile-audit-2026-10.md P0-3).
 */
export default function OwnerGateScreen() {
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    (async () => {
      if (useAuthStore.getState().user?.role === "staff") {
        // Staff land on the first tab their permissions open (a record_payments-only account cannot read Overview).
        // If the answer can't be fetched, Overview's own 403 handling is the fallback.
        let route: string = "today";
        try {
          const data = await queryClient.fetchQuery({ queryKey: ["my-permissions"], queryFn: () => api.owners.myPermissions(), staleTime: 60_000 });
          route = firstAllowedTabRoute((k) => permissionAllows(data, undefined, k));
        } catch {
          // keep "today"
        }
        if (!cancelled) router.replace(`/(owner)/(tabs)/${route}` as never);
        return;
      }
      try {
        const venues = await api.owners.venues();
        if (cancelled) return;
        if (venues.length === 0) {
          router.replace("/(owner)/venue-setup/register");
          return;
        }
        // Owners can have several venues (the API doesn't limit it and Today has a switcher), so
        // look at ALL of them, not just venues[0]: any live venue means Today.
        if (venues.some((v) => v.status === "approved")) {
          router.replace("/(owner)/(tabs)/today");
          return;
        }
        // Nothing live yet: show the most actionable venue -- one under review or needing changes
        // before a rejected one, so a rejected second attempt doesn't hide the one still in review.
        const inReview = venues.find((v) => v.status === "pending" || v.status === "changes_requested");
        if (inReview) {
          router.replace({ pathname: "/(owner)/venue-setup/pending", params: { venueId: inReview.id } });
          return;
        }
        // All rejected: this used to fall through to Today with no message at all.
        router.replace({ pathname: "/(owner)/venue-setup/rejected", params: { venueId: venues[0].id } });
        return;
      } catch (e) {
        if (!cancelled) setError(friendlyErrorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return (
    <SafeAreaView className="flex-1 bg-owner-bg" edges={["top", "bottom"]}>
      <View className="flex-1 items-center justify-center gap-3 px-8">
        {error ? (
          <>
            <AlertTriangleIcon />
            <Text className="font-plex-bold text-owner-ink text-base text-center">Aap ki venue load nahi ho saki</Text>
            <Text className="font-plex-medium text-owner-ink-faint text-sm text-center leading-[1.45]">{error}</Text>
            <Pressable
              onPress={() => setAttempt((n) => n + 1)}
              accessibilityRole="button"
              className="mt-2 w-full max-w-[280px] flex-row items-center justify-center gap-2 rounded-xl bg-owner-accent active:opacity-80"
              style={{ minHeight: 48 }}
            >
              <RefreshIcon />
              <Text className="font-plex-semibold text-white text-[14.5px]">Dobara koshish karein</Text>
            </Pressable>
            <Pressable
              onPress={confirmLogout}
              accessibilityRole="button"
              className="w-full max-w-[280px] items-center justify-center rounded-xl border border-owner-border active:opacity-80"
              style={{ minHeight: 48 }}
            >
              <Text className="font-plex-semibold text-owner-ink-muted text-[14.5px]">Log out</Text>
            </Pressable>
          </>
        ) : (
          <ActivityIndicator color="#0E6274" />
        )}
      </View>
    </SafeAreaView>
  );
}
