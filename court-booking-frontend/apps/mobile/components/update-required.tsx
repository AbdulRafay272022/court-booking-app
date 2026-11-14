import { useState } from "react";
import { Linking, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Updates from "expo-updates";
import { DownloadCloud } from "lucide-react-native";
import { palette, space } from "@court-booking/ui-tokens";
import { Banner, Button, RoleProvider, Text } from "@/components/ui";

import { UPDATE_URL, updateAction } from "@/lib/app-level";

/**
 * "Update karein" (founder 14 Nov): shown to an owner / staff member when the server says this app is too old
 * (426 UPGRADE_REQUIRED). Roman Urdu + English together (the owner's language setting may not have loaded). The button takes
 * the OTA update itself and restarts the app; if there is none (or updates are off / a dev build), it opens the store / APK page.
 */
export function UpdateRequired() {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function update() {
    setBusy(true);
    setNote(null);
    try {
      if (updateAction({ isDev: typeof __DEV__ !== "undefined" && __DEV__, updatesEnabled: Updates.isEnabled }) === "ota") {
        const check = await Updates.checkForUpdateAsync();
        if (check.isAvailable) {
          await Updates.fetchUpdateAsync();
          await Updates.reloadAsync();
          return;
        }
      }
      await Linking.openURL(UPDATE_URL);
      setNote("Store / APK page khul gaya. Install ke baad app dobara kholein. / The store page is open: install, then reopen the app.");
    } catch {
      await Linking.openURL(UPDATE_URL).catch(() => {});
      setNote("Update khud nahi aa saka, store / APK page se install karein. / The update could not load: install it from the store page.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <RoleProvider role="owner">
      <SafeAreaView style={{ flex: 1, backgroundColor: palette.ground, justifyContent: "center", paddingHorizontal: space[5] }} edges={["top", "bottom"]} testID="update-required">
        <View style={{ alignItems: "center", gap: 14 }}>
          <View style={{ width: 88, height: 88, borderRadius: 28, backgroundColor: palette.waitingTint, alignItems: "center", justifyContent: "center" }}
            accessibilityElementsHidden importantForAccessibility="no">
            <DownloadCloud size={40} color={palette.waiting} strokeWidth={2} />
          </View>
          <Text variant="h2" align="center" accessibilityRole="header">Naya update install karein</Text>
          <Text variant="body" tone="muted" align="center">
            Paisa ke naye hisaab ke liye Khelo ka naya version zaroori hai. Update ke baad app khud dobara khulegi.
          </Text>
          <Text variant="h3" align="center">Please update Khelo</Text>
          <Text variant="body" tone="muted" align="center">
            The new money screens need the latest version of the app. It restarts by itself after the update.
          </Text>
          {note ? <Banner tone="info" body={note} /> : null}
          <View style={{ alignSelf: "stretch", paddingTop: space[2] }}>
            <Button label="Update karein / Update" block loading={busy} onPress={() => void update()} testID="update-required-button" />
          </View>
        </View>
      </SafeAreaView>
    </RoleProvider>
  );
}
