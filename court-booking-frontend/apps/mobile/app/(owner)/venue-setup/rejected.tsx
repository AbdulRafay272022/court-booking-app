import { useEffect, useState } from "react";
import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { MessageCircle } from "lucide-react-native";
import type { Venue } from "@court-booking/types";
import { palette, radius, space } from "@court-booking/ui-tokens";
import { Button, ErrorState, Pill, Screen, SkeletonCard, Text } from "@/components/ui";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { confirmLogout } from "@/lib/logout";
import { openSupportWhatsApp } from "@/lib/support";
import { useVenueSetupStore } from "@/lib/venue-setup-store";
import { useOwnerVenues } from "@/lib/use-owner-venues";

/** OWizard frame 4: the "not approved" state with the admin's own note (venue.rejection_reason). There is no owner-side
 * resubmit endpoint, so the next steps are honest: talk to us, or register the venue again with the details corrected. */
export default function VenueRejectedScreen() {
  const { venueId } = useLocalSearchParams<{ venueId: string }>();
  const resetDraft = useVenueSetupStore((s) => s.reset);
  const { venues: ownerVenues } = useOwnerVenues();
  const hasLiveVenue = ownerVenues.some((v) => v.status === "approved");
  const [venue, setVenue] = useState<Venue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        setError(null);
        setVenue(await api.venues.get(venueId));
      } catch (e) {
        setError(friendlyErrorMessage(e));
      }
    })();
  }, [venueId, attempt]);

  if (error) {
    return (
      <Screen scroll={false} contentStyle={{ justifyContent: "center" }}>
        <ErrorState title="Venue load nahi hui" message={error} onRetry={() => setAttempt((n) => n + 1)} onBack={confirmLogout} backLabel="Log out" />
      </Screen>
    );
  }
  if (!venue) {
    return (
      <Screen>
        <SkeletonCard />
      </Screen>
    );
  }

  return (
    <Screen testID="venue-rejected">
      {hasLiveVenue ? <Button label="Wapas dashboard par" variant="soft" size="sm" onPress={() => router.replace("/(owner)/(tabs)/today")} /> : null}
      <View style={{ gap: space[2] }}>
        <Pill tone="danger" label="Approve nahi hui" />
        <Text variant="h2" accessibilityRole="header">
          Thodi tabdeeli chahiye
        </Text>
        <Text variant="bodyStrong">{venue.name}</Text>
      </View>
      <View style={{ backgroundColor: palette.dangerTint, borderRadius: radius.card, padding: space[4], gap: space[1] }}>
        <Text variant="label" tone="danger">
          Admin ka note
        </Text>
        <Text variant="body" tone="danger">
          {venue.rejection_reason ?? "Ye venue jaise bheji gayi thi waise approve nahi ho saki."}
        </Text>
      </View>
      <View style={{ backgroundColor: palette.white, borderRadius: radius.card, padding: space[4], gap: space[3] }}>
        <Text variant="bodyStrong">Aage kya karein</Text>
        <Text variant="meta" tone="muted">
          App se dobara bhejne ka raasta abhi nahi hai: hum se baat karein (kya badalna hai, hum batayenge), ya sahi tafseel ke saath venue dobara register karein.
        </Text>
        <Button
          label="WhatsApp par madad"
          size="md"
          block
          icon={<MessageCircle size={18} color={palette.white} />}
          onPress={() => openSupportWhatsApp(`Hi, my venue "${venue.name}" was not approved. Can you help?`)}
        />
        <Button
          label="Venue dobara register karein"
          variant="soft"
          size="md"
          block
          onPress={() => {
            resetDraft();
            router.replace("/(owner)/venue-setup/register");
          }}
        />
      </View>
      <Button label="Log out" variant="soft" size="md" block onPress={confirmLogout} />
    </Screen>
  );
}
