import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { palette } from "@court-booking/ui-tokens";
import { ErrorState, Screen } from "@/components/ui";
import { router } from "expo-router";

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { confirmLogout } from "@/lib/logout";
import { permissionAllows } from "@/lib/overview";
import { firstAllowedTabRoute } from "@/lib/owner-access";
import { queryClient } from "@/lib/query-client";

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
    <Screen scroll={false} testID="owner-gate" contentStyle={{ justifyContent: "center" }}>
      {error ? (
        <ErrorState
          title="Aap ki venue load nahi ho saki"
          message={error}
          onRetry={() => setAttempt((n) => n + 1)}
          onBack={confirmLogout}
          backLabel="Log out"
        />
      ) : (
        <View style={{ alignItems: "center" }} accessibilityLabel="Loading">
          <ActivityIndicator color={palette.teal} />
        </View>
      )}
    </Screen>
  );
}
