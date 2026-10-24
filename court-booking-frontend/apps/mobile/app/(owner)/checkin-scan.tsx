import { useState } from "react";
import { Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react-native";
import type { OwnerBookingDetail } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";
import { palette, radius, space } from "@court-booking/ui-tokens";
import { Banner, Button, IconButton, Input, Text } from "@/components/ui";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR, formatTimeRange } from "@/lib/format";
import { invalidateOwnerMoney } from "@/lib/owner-cache";
import { useMyPermissions } from "@/lib/use-my-permissions";
import { NoAccess } from "@/components/no-access";
import { BookingDetailSheet } from "@/components/booking-detail-sheet";
import { ownerBack } from "./_fl";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function checkinError(e: unknown): string {
  if (e instanceof ApiError && e.code === "INVALID_BOOKING_STATE") return "Ye booking check-in ke liye tayyar nahi (pakki nahi, cancel, ya pehle ho chuka).";
  if (e instanceof ApiError && (e.code === "INVALID_CHECKIN_CODE" || e.status === 404 || e.status === 422)) return "Ye booking ID nahi mila. Poora ID dobara dekhein.";
  if (e instanceof ApiError && e.status === 403) return "Aapke paas check-in ki ijazat nahi hai.";
  return friendlyErrorMessage(e);
}

/**
 * OWalkin frame 2: the owner scans a player's booking QR (its content is the booking UUID, shown on the player's
 * ticket) or types the booking ID, then POST /bookings/{id}/checkin. A short typed code is not supported by the backend
 * (contract B2), so the manual field takes the full ID and says so. On Expo web there is no camera: the manual field only.
 */
export default function CheckinScanScreen() {
  const insets = useSafeAreaInsets();
  const perms = useMyPermissions();
  const qc = useQueryClient();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; name: string; detail: OwnerBookingDetail | null } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const web = Platform.OS === "web";
  const camera = !web && !!permission?.granted;

  async function submitCheckin(raw: string) {
    const id = raw.trim();
    setError(null);
    if (!UUID.test(id)) {
      setError("Ye poora booking ID nahi lagta. Player ki booking screen par lamba ID hota hai (jaise 3b9a41d7-...); wahi likhein ya paste karein.");
      setScanned(false);
      return;
    }
    setSubmitting(true);
    try {
      const { booking } = await api.bookings.checkin(id);
      let detail: OwnerBookingDetail | null = null;
      try {
        detail = await api.owners.bookingDetail(id);
      } catch {
        detail = null;
      }
      setDone({ id, name: booking.player_name ?? detail?.row.player_name ?? "Player", detail });
      setManualCode("");
      void invalidateOwnerMoney(qc);
    } catch (e) {
      setError(checkinError(e));
    } finally {
      setSubmitting(false);
      setScanned(false);
    }
  }

  if (perms.settled && !perms.can("check_in")) return <NoAccess what="Check-in" />;

  const row = done?.detail?.row;
  return (
    <View style={{ flex: 1, backgroundColor: palette.night, paddingTop: insets.top + space[3], paddingBottom: insets.bottom + space[4] }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: space[4] }}>
        <IconButton icon={X} variant="onDark" accessibilityLabel="Band karein" onPress={ownerBack} />
        <Text variant="cta" tone="onDark" accessibilityRole="header" style={{ flex: 1 }}>
          Player ka QR scan karein
        </Text>
      </View>

      <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: space[4], paddingHorizontal: space[4], paddingTop: space[5], paddingBottom: space[6] }}>
        {camera ? (
          <View style={{ alignSelf: "center", width: 260, height: 260, borderRadius: radius.card, overflow: "hidden", backgroundColor: palette.scanFrame }}>
            <CameraView
              style={{ flex: 1 }}
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={
                scanned || submitting
                  ? undefined
                  : ({ data }) => {
                      setScanned(true);
                      void submitCheckin(data);
                    }
              }
            />
            <View pointerEvents="none" style={{ position: "absolute", left: 20, right: 20, top: 128, height: 3, borderRadius: 2, backgroundColor: palette.mint }} />
          </View>
        ) : (
          <View style={{ alignSelf: "stretch", minHeight: 150, borderRadius: radius.card, backgroundColor: palette.scanFrame, alignItems: "center", justifyContent: "center", padding: space[5], gap: space[3] }}>
            <Text variant="bodyL" tone="onDark" align="center">
              {web ? "Camera scan phone ki app mein chalta hai. Yahan booking ID likh kar check-in karein." : "QR scan ke liye camera ki ijazat chahiye."}
            </Text>
            {!web && permission && !permission.granted ? <Button label="Camera ki ijazat dein" size="md" onPress={requestPermission} /> : null}
          </View>
        )}
        {camera ? (
          <Text variant="bodyL" tone="onDark" align="center">
            QR ko frame ke andar rakhein
          </Text>
        ) : null}

        {done ? (
          <View testID="checkin-done" style={{ backgroundColor: palette.white, borderRadius: radius.card, padding: space[4], gap: space[3] }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[3] }}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: palette.openTint, alignItems: "center", justifyContent: "center" }}>
                <Check size={20} color={palette.open} strokeWidth={3} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong">{`${done.name} · check-in ho gaya`}</Text>
                {row ? (
                  <Text variant="meta" tone="muted">{`${row.court_name} · ${formatTimeRange(row.starts_at, row.ends_at)} · ${row.due > 0 ? `Baqi PKR ${formatPKR(row.due)}` : "Poora paid"}`}</Text>
                ) : null}
              </View>
            </View>
            <Button label="Booking detail kholein" variant="soft" size="md" block onPress={() => setDetailId(done.id)} />
          </View>
        ) : null}

        <View style={{ backgroundColor: palette.white, borderRadius: radius.card, padding: space[4], gap: space[3] }}>
          <Input
            label="Ya booking ID likhein"
            value={manualCode}
            onChangeText={(v) => {
              setManualCode(v);
              setError(null);
            }}
            placeholder="Poora ID, jaise 3b9a41d7-..."
            autoCapitalize="none"
            autoCorrect={false}
            help="Player ki booking / ticket screen par poora booking ID hota hai. Chhota code (KH-...) abhi check-in mein nahi chalta."
            testID="checkin-code"
          />
          <Button label={submitting ? "Ho raha hai" : "Check in"} block size="md" onPress={() => submitCheckin(manualCode)} disabled={!manualCode.trim() || submitting} loading={submitting} testID="checkin-submit" />
          {error ? <Banner tone="danger" body={error} testID="checkin-error" /> : null}
        </View>
        <Button label="Venue ka QR dikhayein" variant="soft" size="md" block onPress={() => router.push("/(owner)/checkin-qr")} />
      </ScrollView>
      {detailId ? <BookingDetailSheet bookingId={detailId} onClose={() => setDetailId(null)} onOpenBooking={(id) => setDetailId(id)} /> : null}
    </View>
  );
}
