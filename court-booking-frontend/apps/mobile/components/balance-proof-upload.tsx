import { useState } from "react";
import { View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useQueryClient } from "@tanstack/react-query";
import { space } from "@court-booking/ui-tokens";
import { Banner, Button, Text, useCopy } from "@/components/ui";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { prepareProofImage } from "@/lib/proof-image";

/**
 * audit 2026-10-28 Phase 3 item 2 (flag balance_proof): send a screenshot for the BALANCE of a booked booking. The server runs
 * the same checks as the advance; the owner always looks at it and the booking stays booked either way. `state` comes from
 * GET /bookings/{id}/payment-instructions (`balance_upload`).
 */
export function BalanceProofUpload({ bookingId, state }: { bookingId: string; state: "open" | "pending" | "off" }) {
  const copy = useCopy();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  if (state === "off") return null;
  if (state === "pending") {
    return (
      <Banner tone="waiting" body={copy("Baqi raqam ka screenshot venue ke paas hai. Woh check kar ke darj karega.", "Your balance screenshot is with the venue. They will check it and record it.")} testID="balance-proof-pending" />
    );
  }

  async function pick() {
    setMessage(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== "granted") {
      setMessage({ ok: false, text: copy("Screenshot lagane ke liye photos ki ijazat dein (phone Settings).", "Allow photo access in your phone Settings to attach the screenshot.") });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
    if (result.canceled || !result.assets[0]) return;
    setBusy(true);
    try {
      const proof = await prepareProofImage(result.assets[0]);
      await api.bookings.submitPaymentProof(bookingId, proof.blob ?? proof.uri, proof.name, proof.type);
      setMessage({ ok: true, text: copy("Screenshot bhej diya. Venue check kar ke darj karega.", "Screenshot sent. The venue will check it and record it.") });
      await queryClient.invalidateQueries({ queryKey: ["payment-instructions", bookingId] });
    } catch (e) {
      setMessage({ ok: false, text: friendlyErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: space[2] }} testID="balance-proof-upload">
      <Text variant="meta" tone="muted">{copy("Transfer kar diya? Uska screenshot yahan bhejo.", "Sent it? Send the screenshot here.")}</Text>
      <Button label={copy("Baqi ka screenshot bhejo", "Send balance screenshot")} variant="soft" size="md" loading={busy} onPress={pick} testID="balance-proof-pick" />
      {message ? <Banner tone={message.ok ? "open" : "danger"} body={message.text} /> : null}
    </View>
  );
}
