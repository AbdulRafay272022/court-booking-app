import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { router } from "expo-router";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";

/**
 * Per Section 6.1: an owner with zero venues goes straight to the setup wizard;
 * one with a venue still under review sees the pending screen; otherwise, Today.
 */
export default function OwnerGateScreen() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const venues = await api.owners.venues();
        if (venues.length === 0) {
          router.replace("/(owner)/venue-setup/register");
          return;
        }
        // Owners can have several venues (the API doesn't limit it and Today has a switcher), so
        // look at ALL of them, not just venues[0]: any live venue means Today.
        if (venues.some((v) => v.status === "approved")) {
          router.replace("/(owner)/today");
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
        setError(friendlyErrorMessage(e));
      }
    })();
  }, []);

  return (
    <View className="flex-1 bg-owner-bg items-center justify-center gap-3 px-6">
      {error ? (
        <Text className="font-plex-medium text-owner-danger text-center">{error}</Text>
      ) : (
        <ActivityIndicator color="#0E6274" />
      )}
    </View>
  );
}
