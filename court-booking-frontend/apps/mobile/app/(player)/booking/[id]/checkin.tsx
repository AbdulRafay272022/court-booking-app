import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CameraView, useCameraPermissions } from "expo-camera";
import QRCode from "react-native-qrcode-svg";
import { selfCheckinWindow } from "@court-booking/types";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatTime, formatWhen } from "@/lib/format";
import { ChevronLeftIcon, CheckIcon } from "@/components/icons";

/** Section 32 Part 9. Two directions in one screen: (1) show this booking's own QR (its plain
 * booking id) for the OWNER to scan -- works any time the booking is booked, no time window; (2)
 * "Scan to check in" -- the player scans the VENUE's printed QR themselves, gated to about 15
 * minutes before to 15 minutes after start (packages/types' selfCheckinWindow), with a clear
 * message outside it rather than just hiding the option. Both call the same tested backend paths
 * Today's "Check in" button and the owner's scan screen already use. */
export default function PlayerCheckinScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const bookingQuery = useQuery({ queryKey: ["booking", id], queryFn: () => api.bookings.get(id) });
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [manualToken, setManualToken] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const booking = bookingQuery.data;

  if (!booking) {
    return (
      <SafeAreaView className="flex-1 bg-player-bg items-center justify-center" edges={["top", "bottom"]}>
        {bookingQuery.isError ? (
          <Text className="font-figtree-medium text-player-ink-faint text-sm">{friendlyErrorMessage(bookingQuery.error)}</Text>
        ) : (
          <ActivityIndicator color="#EF5A2C" />
        )}
      </SafeAreaView>
    );
  }

  async function submitSelfCheckin(token: string) {
    setSubmitting(true);
    try {
      await api.bookings.checkinSelf(id, token.trim());
      queryClient.invalidateQueries({ queryKey: ["booking", id] });
      queryClient.invalidateQueries({ queryKey: ["bookings-mine"] });
    } catch (e) {
      Alert.alert("Couldn't check in", friendlyErrorMessage(e));
      setScanned(false);
    } finally {
      setSubmitting(false);
    }
  }

  if (booking.checked_in_at) {
    return (
      <SafeAreaView className="flex-1 bg-player-bg" edges={["top", "bottom"]}>
        <View className="px-5 pt-5 pb-4 bg-player-surface border-b border-player-border-light flex-row items-center gap-3">
          <Pressable onPress={() => router.back()} className="w-11 h-11 rounded-xl items-center justify-center" style={{ backgroundColor: "#F4EFEC" }}>
            <ChevronLeftIcon />
          </Pressable>
          <Text className="font-figtree-bold text-player-ink text-[18px]">Check in</Text>
        </View>
        <View className="flex-1 items-center justify-center px-8 gap-4">
          <View className="w-16 h-16 rounded-full items-center justify-center" style={{ backgroundColor: "#1F7A52" }}>
            <CheckIcon size={30} strokeWidth={2.4} />
          </View>
          <Text className="font-figtree-bold text-player-ink text-[18px] text-center">You're checked in</Text>
          <Text className="font-figtree-medium text-player-ink-faint text-[13.5px] text-center">
            {formatWhen(booking.checked_in_at)}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const window = selfCheckinWindow(booking.starts_at);

  return (
    <SafeAreaView className="flex-1 bg-player-bg" edges={["top", "bottom"]}>
      <View className="px-5 pt-5 pb-4 bg-player-surface border-b border-player-border-light flex-row items-center gap-3">
        <Pressable onPress={() => router.back()} className="w-11 h-11 rounded-xl items-center justify-center" style={{ backgroundColor: "#F4EFEC" }}>
          <ChevronLeftIcon />
        </Pressable>
        <Text className="font-figtree-bold text-player-ink text-[18px]">Check in</Text>
      </View>

      {scanning ? (
        !permission ? null : !permission.granted ? (
          <View className="flex-1 items-center justify-center px-6 gap-4">
            <Text className="font-figtree-medium text-player-ink-faint text-[14px] text-center">
              Maidan needs camera access to scan the venue's check-in code.
            </Text>
            <Pressable onPress={requestPermission} className="rounded-xl px-5 items-center justify-center" style={{ height: 48, backgroundColor: "#EF5A2C" }}>
              <Text className="font-figtree-semibold text-white text-[14px]">Allow camera</Text>
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
                      submitSelfCheckin(data);
                    }
              }
            />
            <View className="px-5 py-4 bg-player-surface border-t border-player-border-light">
              <Text className="font-figtree-medium text-player-ink-faint text-[12.5px] text-center">
                Point the camera at the QR code posted at the venue entrance.
              </Text>
            </View>
          </View>
        )
      ) : (
        <View className="flex-1 px-5 pt-5 gap-6">
          <View className="items-center gap-4 bg-player-surface border border-player-border-light rounded-2xl p-5">
            <Text className="font-figtree-bold text-player-ink text-[15px]">Show this to venue staff</Text>
            <View className="p-4 bg-white rounded-xl border border-player-border-light">
              <QRCode value={booking.id} size={180} />
            </View>
            <Text className="font-figtree-medium text-player-ink-faint text-[12.5px] text-center">
              {formatTime(booking.starts_at)} today -- the owner can scan this to check you in.
            </Text>
          </View>

          <View className="gap-3">
            <Text className="font-figtree-bold text-player-ink text-[15px]">Or scan the venue's QR yourself</Text>
            {window.isOpen ? (
              <Pressable
                onPress={() => setScanning(true)}
                className="rounded-xl items-center justify-center"
                style={{ height: 50, backgroundColor: "#EF5A2C" }}
              >
                <Text className="font-figtree-bold text-white text-[15px]">Scan to check in</Text>
              </Pressable>
            ) : (
              <View className="rounded-xl p-3.5" style={{ backgroundColor: "#F4EFEC" }}>
                <Text className="font-figtree-medium text-player-ink-faint text-[13px] text-center">{window.message}</Text>
              </View>
            )}
            <View className="gap-2">
              <TextInput
                value={manualToken}
                onChangeText={setManualToken}
                placeholder="Or type the venue's code"
                autoCapitalize="none"
                autoCorrect={false}
                editable={window.isOpen}
                className="border border-player-border-light rounded-xl px-4 font-mono-medium text-player-ink text-[14px]"
                style={{ height: 48, opacity: window.isOpen ? 1 : 0.5 }}
              />
              <Pressable
                disabled={!window.isOpen || !manualToken.trim() || submitting}
                onPress={() => submitSelfCheckin(manualToken)}
                className="rounded-xl items-center justify-center"
                style={{ height: 44, backgroundColor: "#F4EFEC", opacity: !window.isOpen || !manualToken.trim() || submitting ? 0.5 : 1 }}
              >
                <Text className="font-figtree-semibold text-player-ink text-[13.5px]">
                  {submitting ? "Checking in…" : "Check in with this code"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}
