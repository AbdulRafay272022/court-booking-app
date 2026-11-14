import { Pressable, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react-native";
import { refundBreakdown, type OwnerRefund } from "@court-booking/types";
import { palette, radius, shadow, space } from "@court-booking/ui-tokens";
import { Button, Pill, Text } from "@/components/ui";

import { formatPKR, formatWhen } from "@/lib/format";
import { duplicateCreditText } from "@/lib/overview";
import { RefundPayoutBlock } from "@/components/refund-payout-block";
import { pkr, type PT } from "./kit";

/** The refund reasons in words (same map as the old Refunds tab; the backend codes are not in the shared dictionary yet). */
const REFUND_REASON_RU: Record<string, string> = {
  player_cancelled_paid_booking: "Player ne paid booking cancel ki",
  owner_cancelled_paid_booking: "Aap ne paid booking cancel ki",
  system_cancelled_paid_booking: "Booking khud cancel hui",
  overpayment_excess: "Zyada paisa aa gaya",
  cancelled_payment_received: "Cancel booking ka paisa aaya",
  payment_review_expired: "Screenshot waqt par check nahi hua",
  payment_rejected: "Payment reject hui",
  player_refund_request: "Player ne refund maanga",
};

/** One owed refund in Paisa -> Kaam (everything the old Refunds tab card showed): player, court · slot · KH-id, what is
 * still owed, partial chip, reason, the player's note, duplicate-screenshot chip, overdue line, the player's number, the
 * payout account + each refund sent ("Mil gaya / Nahi mila"), "Refund ho gaya" and the booking. */
export function RefundCard({ refund, court, t, canMark, onMark, onOpenBooking }: {
  refund: OwnerRefund;
  court: string;
  t: PT;
  canMark: boolean;
  onMark: () => void;
  onOpenBooking: () => void;
}) {
  const qc = useQueryClient();
  const b = refundBreakdown(refund);
  const who = refund.player_name ?? refund.player_phone ?? "Player";
  return (
    <View testID="paisa-refund-card" style={{ backgroundColor: palette.white, borderRadius: radius.card, padding: space[4], gap: space[3], boxShadow: shadow.card, borderWidth: refund.is_overdue ? 1.5 : 0, borderColor: palette.dangerBorder }}>
      <Pressable onPress={onOpenBooking} accessibilityRole="button" accessibilityLabel={`${who} refund`} style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: space[3] }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong">{who}</Text>
          <Text variant="meta" tone="muted">{`${court} · ${formatWhen(refund.starts_at)} · KH-${refund.booking_id.replace(/-/g, "").slice(0, 8).toUpperCase()}`}</Text>
        </View>
        <View style={{ alignItems: "flex-end", gap: space[1] }}>
          <Text variant="title">{pkr(b.remaining)}</Text>
          {b.status === "partial" ? <Pill testID="chip-partial" size="sm" tone="waiting" label="Hissa wapas" /> : null}
          {b.alreadyRefunded > 0 ? <Text variant="caption" tone="muted">{`PKR ${formatPKR(b.refundDue)} mein se baqi`}</Text> : null}
        </View>
      </Pressable>
      {refund.reason ? (
        <View style={{ backgroundColor: palette.ground, borderRadius: radius.md, paddingHorizontal: space[3], paddingVertical: 10 }}>
          <Text variant="meta" tone="body">{`Wajah: ${REFUND_REASON_RU[refund.reason] ?? refund.reason.replace(/_/g, " ")}`}</Text>
        </View>
      ) : null}
      {refund.player_note ? <Text variant="meta" tone="body" testID="refund-player-note">{`Player ki wajah: ${refund.player_note}`}</Text> : null}
      {refund.duplicate_proof && refund.duplicate_proof.used_on_bookings > 0 ? (
        <View testID="refund-dup-chip" style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: palette.dangerTint }}>
          <TriangleAlert size={13} color={palette.danger} />
          <Text variant="caption" weight="bold" tone="danger" style={{ flexShrink: 1 }}>{duplicateCreditText(refund.duplicate_proof.used_on_bookings)}</Text>
        </View>
      ) : null}
      {refund.is_overdue ? <Text variant="caption" weight="bold" tone="danger">{`Der ho gayi - ${formatWhen(refund.created_at)} se baqi`}</Text> : null}
      {refund.player_phone ? (
        <View style={{ backgroundColor: palette.ground, borderRadius: radius.md, paddingHorizontal: space[3], paddingVertical: 10, gap: 2 }}>
          <Text variant="caption" tone="muted">{t("paisa.detail.phone")}</Text>
          <Text variant="bodyBold" selectable>{refund.player_phone}</Text>
        </View>
      ) : null}
      <RefundPayoutBlock refund={refund} onChanged={() => void qc.invalidateQueries({ queryKey: ["paisa-tasks"] })} />
      {b.remaining > 0 && canMark ? <Button label={t("paisa.act.refund")} block size="md" onPress={onMark} testID="paisa-refund-mark" /> : null}
    </View>
  );
}
