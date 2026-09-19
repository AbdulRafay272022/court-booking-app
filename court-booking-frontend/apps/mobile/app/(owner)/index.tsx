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
        const venue = venues[0];
        if (venue.status === "pending" || venue.status === "changes_requested") {
          router.replace({
            pathname: "/(owner)/venue-setup/pending",
            params: { venueId: venue.id },
          });
          return;
        }
        router.replace("/(owner)/today");
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
