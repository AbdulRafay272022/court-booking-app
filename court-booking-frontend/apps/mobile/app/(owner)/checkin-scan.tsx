import { useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { ChevronLeftIcon } from "@/components/icons";

/** Section 32 Part 9: owner scans a player's booking QR (a plain booking-id string, shown on the
 * player's own check-in screen -- see (player)/booking/[id]/checkin.tsx) as a faster front-desk
 * alternative to finding their row on Today, or types the booking code by hand when scanning fails
 * or the player has no signal to load their screen. Calls the same POST /bookings/{id}/checkin
 * Today's own "Check in" button uses -- no separate backend logic. */
export default function CheckinScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [useManual, setUseManual] = useState(false);

  async function submitCheckin(bookingId: string) {
    setSubmitting(true);
    try {
      const { booking } = await api.bookings.checkin(bookingId.trim());
      Alert.alert(
        "Checked in",
        `${booking.player_name ?? "Player"} is checked in.`,
        [{ text: "Done", onPress: () => router.back() }],
      );
    } catch (e) {
      Alert.alert("Couldn't check in", friendlyErrorMessage(e));
      setScanned(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-owner-bg" edges={["top", "bottom"]}>
      <View className="px-4.5 pt-5 pb-4 bg-owner-surface border-b border-owner-border flex-row items-center gap-3">
        <Pressable onPress={() => router.back()} className="w-11 h-11 rounded-[10px] bg-owner-bg items-center justify-center">
          <ChevronLeftIcon />
        </Pressable>
        <Text className="font-plex-bold text-owner-ink text-[19px] -tracking-[0.3px]">Scan to check in</Text>
      </View>

      {useManual ? (
        <View className="flex-1 px-5 pt-6 gap-4">
          <Text className="font-plex-medium text-owner-ink-faint text-[13px]">
            Enter the booking code the player shows you.
          </Text>
          <TextInput
            value={manualCode}
            onChangeText={setManualCode}
            placeholder="Booking code"
            autoCapitalize="none"
            autoCorrect={false}
            className="border border-owner-border rounded-xl px-4 font-mono-medium text-owner-ink text-[15px]"
            style={{ height: 52 }}
          />
          <Pressable
            disabled={!manualCode.trim() || submitting}
            onPress={() => submitCheckin(manualCode)}
            className="rounded-xl items-center justify-center"
            style={{ height: 50, backgroundColor: "#0E6274", opacity: !manualCode.trim() || submitting ? 0.5 : 1 }}
          >
            <Text className="font-plex-bold text-white text-[15px]">{submitting ? "Checking in…" : "Check in"}</Text>
          </Pressable>
          <Pressable onPress={() => setUseManual(false)}>
            <Text className="font-plex-semibold text-owner-accent text-[13px] text-center">Scan a code instead</Text>
          </Pressable>
        </View>
      ) : !permission ? null : !permission.granted ? (
        <View className="flex-1 items-center justify-center px-6 gap-4">
          <Text className="font-plex-medium text-owner-ink-faint text-[14px] text-center">
            Maidan needs camera access to scan a player's booking code.
          </Text>
          <Pressable onPress={requestPermission} className="rounded-xl px-5 items-center justify-center" style={{ height: 48, backgroundColor: "#0E6274" }}>
            <Text className="font-plex-semibold text-white text-[14px]">Allow camera</Text>
          </Pressable>
          <Pressable onPress={() => setUseManual(true)}>
            <Text className="font-plex-semibold text-owner-accent text-[13px]">Enter the code by hand instead</Text>
          </Pressable>
        </View>
      ) : (
        <View className="flex-1">
          <CameraView
            style={{ flex: 1 }}
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={
              scanned || submitting
                ? undefined
                : ({ data }) => {
                    setScanned(true);
                    submitCheckin(data);
                  }
            }
          />
          <View className="px-5 py-4 bg-owner-surface border-t border-owner-border">
            <Text className="font-plex-medium text-owner-ink-faint text-[12.5px] text-center mb-2">
              Point the camera at the player's booking QR code.
            </Text>
            <Pressable onPress={() => setUseManual(true)}>
              <Text className="font-plex-semibold text-owner-accent text-[13px] text-center">Enter the code by hand instead</Text>
            </Pressable>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}
