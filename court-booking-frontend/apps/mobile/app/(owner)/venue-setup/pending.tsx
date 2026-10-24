import { useEffect, useState } from "react";
import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { MessageCircle } from "lucide-react-native";
import type { Venue } from "@court-booking/types";
import { palette, radius, space } from "@court-booking/ui-tokens";
import { Banner, Button, ErrorState, Pill, Screen, SkeletonCard, Text, Timeline } from "@/components/ui";

import { courtLabel } from "@/components/court-label";
import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { PhotoManager } from "@/components/photo-manager";
import { confirmLogout } from "@/lib/logout";
import { openSupportWhatsApp } from "@/lib/support";
import { useOwnerVenues } from "@/lib/use-owner-venues";

/** OWizard frame 3 "Venue review mein hai": a timeline of what happened and what comes next, photos while waiting, and a
 * walk-in shortcut (walk-ins work before the venue is live). Error = retry + log out (never a dead end, audit P0-3). */
export default function VenuePendingScreen() {
  const { venues: ownerVenues } = useOwnerVenues();
  const hasLiveVenue = ownerVenues.some((v) => v.status === "approved");
  const { venueId } = useLocalSearchParams<{ venueId: string }>();
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

  async function reloadVenue() {
    setVenue(await api.venues.get(venueId));
  }

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

  const isChangesRequested = venue.status === "changes_requested";
  // A court the owner deleted in the wizard stays on the server as inactive; it is not one of the courts they sent in.
  const activeCourts = (venue.courts ?? []).filter((c) => c.is_active);
  const courtCount = activeCourts.length;

  return (
    <Screen testID="venue-pending">
      {hasLiveVenue ? <Button label="Wapas dashboard par" variant="soft" size="sm" onPress={() => router.replace("/(owner)/(tabs)/today")} /> : null}
      <View style={{ gap: space[2] }}>
        <Pill tone="waiting" label={isChangesRequested ? "Tabdeeli chahiye" : "Review mein"} />
        <Text variant="h2" accessibilityRole="header">
          {isChangesRequested ? "Thodi tabdeeli chahiye" : "Venue review mein hai"}
        </Text>
        <Text variant="bodyStrong">{venue.name}</Text>
        <Text variant="body" tone="muted">
          {isChangesRequested ? "Admin ne kuch cheezein theek karne ko kaha hai." : "Hum har venue khud check karte hain, aam taur par ek din ke andar. Approve hote hi aap ko notification aayegi."}
        </Text>
      </View>
      {isChangesRequested && venue.rejection_reason ? <Banner tone="waiting" title="Admin ka note" body={venue.rejection_reason} /> : null}

      <View style={{ backgroundColor: palette.white, borderRadius: radius.card, padding: space[5] }}>
        <Timeline
          steps={[
            { label: "Form bhej diya", sub: `${courtCount} ${courtCount === 1 ? "court" : "courts"}, ghante aur qeemat mil gaye`, state: "done" },
            isChangesRequested
              ? { label: "Aap ki tabdeeli ka intezar", sub: "Jo cheez batayi gayi woh theek karke dobara bhejein", state: "now" }
              : { label: "Admin check kar raha hai", sub: "CNIC, bank aur location", state: "now" },
            { label: "Venue live", sub: "Players dhoond kar book kar sakenge", state: "next" },
            { label: "Pehli booking", sub: "Notification aayegi", state: "next" },
          ]}
        />
      </View>

      <View style={{ backgroundColor: palette.tealTint, borderRadius: radius.card, padding: space[4], gap: space[3] }}>
        <Text variant="bodyStrong" tone="info">
          Intezar ki zaroorat nahi
        </Text>
        <Text variant="meta" tone="info">
          Aaj ki phone aur walk-in bookings abhi add karein. Live hone par aap ka calendar pehle se sahi hoga.
        </Text>
        <Button label="Booking add karein" size="md" onPress={() => router.push("/(owner)/walkin")} />
      </View>

      <View style={{ gap: space[1] }}>
        <Text variant="bodyStrong">Photos lagayein</Text>
        <Text variant="caption" tone="muted">
          Achhi photos se players aap ko chunte hain. Baad mein Venue settings mein aur laga ya tarteeb badal sakte hain.
        </Text>
      </View>
      <PhotoManager
        title="Venue photos"
        photoUrls={venue.photo_urls}
        photoKeys={venue.photo_keys}
        max={8}
        onUpload={async (uri) => {
          await api.venues.uploadPhoto(venue.id, uri);
          await reloadVenue();
        }}
        onReorder={async (keys) => {
          await api.venues.reorderPhotos(venue.id, keys);
          await reloadVenue();
        }}
      />
      {activeCourts.map((c) => (
        <PhotoManager
          key={`court-photos-${c.id}`}
          title={`${courtLabel(c.name, c.sport)} photos`}
          photoUrls={c.photo_urls}
          photoKeys={c.photo_keys}
          max={5}
          onUpload={async (uri) => {
            await api.courts.uploadPhoto(c.id, uri);
            await reloadVenue();
          }}
          onReorder={async (keys) => {
            await api.courts.reorderPhotos(c.id, keys);
            await reloadVenue();
          }}
        />
      ))}

      <Button
        label="Der ho rahi hai? WhatsApp par madad"
        variant="soft"
        size="md"
        block
        icon={<MessageCircle size={18} color={palette.night} />}
        onPress={() => openSupportWhatsApp(`Hi, my venue "${venue.name}" is waiting for review.`)}
      />
      <Button label="Log out" variant="soft" size="md" block onPress={confirmLogout} />
    </Screen>
  );
}
