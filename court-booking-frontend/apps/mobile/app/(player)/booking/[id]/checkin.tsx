import { useState } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Check, ScanLine } from "lucide-react-native";
import { formatTimeRange, formatWhen, selfCheckinWindow } from "@court-booking/types";
import { palette, radius, space } from "@court-booking/ui-tokens";

import { Banner, Button, Card, EmptyState, ErrorState, Header, Input, Screen, Skeleton, Text, Ticket, useCopy, useLang } from "@/components/ui";
import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { safeBack } from "@/lib/safe-back";
import { sportLabel, useBookingPlace } from "../../_components";

/** Player check-in (Section 32 Part 9), Floodlight look. (1) The booking's own QR (booking id) for the owner to scan, shown
 * ONLY for a booked booking; (2) "Scan to check in": the player scans the venue's printed QR, gated to ~15 min before/after
 * the start (selfCheckinWindow) with a clear message outside it. Same tested backend paths as before. */
export default function PlayerCheckinScreen() {
  const copy = useCopy();
  const lang = useLang();
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const bookingQuery = useQuery({ queryKey: ["booking", id], queryFn: () => api.bookings.get(id) });
  const booking = bookingQuery.data;
  const place = useBookingPlace(booking);
  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [manualToken, setManualToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitSelfCheckin(token: string) {
    setSubmitting(true);
    setError(null);
    try {
      await api.bookings.checkinSelf(id, token.trim());
      void queryClient.invalidateQueries({ queryKey: ["booking", id] });
      void queryClient.invalidateQueries({ queryKey: ["bookings-mine"] });
      setScanning(false);
    } catch (e) {
      setError(friendlyErrorMessage(e));
      setScanned(false);
    } finally {
      setSubmitting(false);
    }
  }

  const header = <Header title={copy("Check-in", "Check in")} onBack={() => safeBack()} />;
  if (!booking) {
    return (
      <Screen>
        {header}
        {bookingQuery.isError ? (
          <ErrorState message={friendlyErrorMessage(bookingQuery.error)} onRetry={() => bookingQuery.refetch()} onBack={() => safeBack()} />
        ) : (
          <Skeleton height={320} r={radius.cardL} />
        )}
      </Screen>
    );
  }
  if (booking.checked_in_at) {
    return (
      <Screen>
        {header}
        <EmptyState icon={Check} title={copy("Check-in ho gaya", "You're checked in")} body={formatWhen(booking.checked_in_at, new Date(), lang)} />
      </Screen>
    );
  }
  const window = selfCheckinWindow(booking.starts_at, new Date(), lang);

  if (scanning) {
    return (
      <Screen scroll={false} gutter={false}>
        <View style={{ paddingHorizontal: space[5] }}>
          <Header title={copy("Venue ka QR scan karein", "Scan the venue QR")} onBack={() => setScanning(false)} />
        </View>
        {!permission ? null : !permission.granted ? (
          <View style={{ padding: space[5], gap: space[4] }}>
            <Text variant="body" tone="muted">
              {copy("Venue ka check-in code scan karne ke liye camera ki ijazat chahiye.", "Khelo needs camera access to scan the venue's check-in code.")}
            </Text>
            <Button label={copy("Camera ki ijazat dein", "Allow camera")} block onPress={requestPermission} />
          </View>
        ) : (
          <View style={{ flex: 1, backgroundColor: palette.night }}>
            <CameraView
              style={{ flex: 1 }}
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={
                scanned || submitting
                  ? undefined
                  : ({ data }) => {
                      setScanned(true);
                      void submitSelfCheckin(data);
                    }
              }
            />
            <View style={{ padding: space[4], backgroundColor: palette.white, gap: space[2] }}>
              {error ? <Banner tone="danger" body={error} /> : null}
              <Text variant="meta" tone="muted" align="center">
                {copy("Camera ko venue ke darwaze par lage QR code ki taraf karein.", "Point the camera at the QR code posted at the venue entrance.")}
              </Text>
            </View>
          </View>
        )}
      </Screen>
    );
  }

  return (
    <Screen keyboard>
      {header}
      {booking.status === "booked" ? (
        <Ticket
          bookingId={booking.id}
          booking={booking}
          venueName={place.venue?.name ?? copy("Venue", "Venue")}
          eyebrow={place.court ? `${sportLabel(place.court.sport).toUpperCase()} · ${place.court.name.toUpperCase()}` : undefined}
          fields={[{ label: copy("Waqt", "Time"), value: formatTimeRange(booking.starts_at, booking.ends_at, lang) }]}
          qrTitle={copy("Staff ko ye dikhayein", "Show this to venue staff")}
          qrBody={copy("Owner ye scan karke check-in kar dega.", "The owner scans it to check you in.")}
        />
      ) : (
        <Banner tone="waiting" body={copy("Check-in sirf pakki booking par hota hai.", "Check-in is only for a confirmed booking.")} />
      )}
      <Card padding={4} radiusSize="cardL" style={{ gap: space[3] }}>
        <Text variant="title" accessibilityRole="header">
          {copy("Ya venue ka QR khud scan karein", "Or scan the venue's QR yourself")}
        </Text>
        {window.isOpen ? (
          <Button label={copy("Scan karke check-in", "Scan to check in")} block icon={<ScanLine size={18} color={palette.night} />} onPress={() => setScanning(true)} />
        ) : (
          <Banner tone="neutral" body={window.message} />
        )}
        <Input label={copy("Ya venue ka code likhein", "Or type the venue's code")} autoCapitalize="none" autoCorrect={false} editable={window.isOpen} value={manualToken} onChangeText={setManualToken} />
        {error ? <Banner tone="danger" body={error} /> : null}
        <Button label={copy("Is code se check-in", "Check in with this code")} variant="soft" size="md" block loading={submitting} disabled={!window.isOpen || !manualToken.trim()} onPress={() => submitSelfCheckin(manualToken)} />
      </Card>
    </Screen>
  );
}
