import { View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { QrCode } from "lucide-react-native";
import { palette, radius, space } from "@court-booking/ui-tokens";
import { EmptyState, Screen, Skeleton, Text } from "@/components/ui";

import { useOwnerVenues } from "@/lib/use-owner-venues";
import { OwnerHeader } from "./_fl";

/** Section 32 Part 9. Encodes the venue's own `checkin_qr_token` -- a player scans it with their own phone and the app
 * calls POST /bookings/{id}/checkin/self. One QR per venue location (not per court), as the token is scoped. */
export default function CheckinQrScreen() {
  const { activeVenue, isLoading } = useOwnerVenues();
  const token = activeVenue?.checkin_qr_token;

  return (
    <Screen testID="checkin-qr">
      <OwnerHeader title="Venue check-in QR" subtitle={activeVenue?.name} />
      {isLoading ? (
        <Skeleton height={300} r={radius.card} />
      ) : !token ? (
        <EmptyState title="QR abhi nahi" body="Ye QR sirf venue owner ko milta hai, ya venue abhi chuni nahi gayi." icon={QrCode} />
      ) : (
        <View style={{ alignItems: "center", gap: space[5], paddingTop: space[4] }}>
          <View style={{ padding: space[5], backgroundColor: palette.white, borderRadius: radius.card }}>
            <QRCode value={token} size={240} color={palette.night} backgroundColor={palette.white} />
          </View>
          <Text variant="title" align="center">
            {activeVenue?.name ?? ""}
          </Text>
          <Text variant="body" tone="muted" align="center">
            Ise entrance par print karke lagayein ya screen par dikhayein. Player Khelo mein apni booking par &quot;Scan to check in&quot; daba kar ye code scan kare; aap ko kuch nahi karna.
          </Text>
        </View>
      )}
    </Screen>
  );
}
