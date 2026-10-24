import { router } from "expo-router";
import { QrCode, ScanLine } from "lucide-react-native";
import { ListRow, Screen, Text } from "@/components/ui";

import { useMyPermissions } from "@/lib/use-my-permissions";
import { NoAccess } from "@/components/no-access";
import { GroupCard, IconTile, OwnerHeader } from "./_fl";

/** Section 32 Part 9: the two check-in paths that are not on Aaj's own booking cards: scanning a player's booking QR (or
 * typing the booking ID) at the front desk, and showing the venue's own QR so players check themselves in. */
export default function CheckinHubScreen() {
  const perms = useMyPermissions();
  if (perms.settled && !perms.can("check_in")) return <NoAccess what="Check-in" />;
  return (
    <Screen testID="checkin-hub">
      <OwnerHeader title="Check-in" subtitle="Player aaya? Scan karein ya booking ID likhein." />
      <GroupCard>
        <ListRow
          title="Player ka QR scan karein"
          subtitle="Player ki booking ka QR, ya poora booking ID haath se"
          leading={<IconTile icon={ScanLine} />}
          onPress={() => router.push("/(owner)/checkin-scan")}
          divider
          testID="checkin-scan-row"
        />
        <ListRow title="Venue ka QR dikhayein" subtitle="Entrance par lagayein: player khud scan karke check-in kare" leading={<IconTile icon={QrCode} />} onPress={() => router.push("/(owner)/checkin-qr")} />
      </GroupCard>
      <Text variant="caption" tone="muted">
        Aaj screen par booking card ya timeline block khol kar bhi &quot;Check in&quot; daba sakte hain.
      </Text>
    </Screen>
  );
}
