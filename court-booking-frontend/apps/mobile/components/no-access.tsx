import { Linking, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Lock } from "lucide-react-native";
import { palette, radius, space } from "@court-booking/ui-tokens";
import { Button, Text } from "@/components/ui";

import { useOwnerVenues } from "@/lib/use-owner-venues";

/** The ONE "you can't use this" state for staff (OStaffView frame 2 "Ijazat nahi"). Shown when GET /owners/me/permissions
 * says the key is missing, e.g. a deep link or an old notification opening a screen the tab bar and "Aur" no longer
 * offer. "Owner ko WhatsApp" uses the venue's own WhatsApp number and only shows when the venue has one. */
export function NoAccess({ what, withBack = true }: { what: string; withBack?: boolean }) {
  const insets = useSafeAreaInsets();
  const { activeVenue } = useOwnerVenues();
  const wa = (activeVenue as { whatsapp?: string | null } | undefined)?.whatsapp?.replace(/[^0-9]/g, "");
  return (
    <View testID="no-access" accessibilityRole="alert" style={{ flex: 1, backgroundColor: palette.ground, justifyContent: "center", paddingHorizontal: space[6], paddingTop: insets.top, paddingBottom: insets.bottom + (withBack ? 0 : 96), gap: space[4], alignItems: "center" }}>
      <View style={{ width: 88, height: 88, borderRadius: radius.cardL, backgroundColor: palette.mist, alignItems: "center", justifyContent: "center" }}>
        <Lock size={38} color={palette.night} />
      </View>
      <Text variant="label" tone="muted" align="center">
        {`${what} ki ijazat nahi`}
      </Text>
      <Text variant="h2" align="center" accessibilityRole="header">
        Ye hissa aap ke liye band hai
      </Text>
      <Text variant="bodyL" tone="muted" align="center">
        {`"${what}" ki ijazat owner ke paas hai. Owner Staff settings mein de sakta hai; milte hi ye hissa yahan khud aa jayega.`}
      </Text>
      <Button
        label={withBack ? "Wapas" : "Aur par jayein"}
        block
        onPress={() => (withBack ? (router.canGoBack() ? router.back() : router.replace("/(owner)")) : router.navigate("/(owner)/(tabs)/more"))}
      />
      {wa ? <Button label="Owner ko WhatsApp" variant="soft" size="md" block onPress={() => Linking.openURL(`https://wa.me/${wa}`)} /> : null}
    </View>
  );
}
