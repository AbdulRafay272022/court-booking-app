import { useState } from "react";
import { Pressable, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react-native";
import { refundBreakdown, type OwnerRefund } from "@court-booking/types";
import { palette, radius, shadow, space } from "@court-booking/ui-tokens";
import { Banner, Button, Input, Pill, Text } from "@/components/ui";

import { api } from "@/lib/api";
import { formatPKR } from "@/lib/format";
import { duplicateCreditText } from "@/lib/overview";
import { RefundPayoutBlock } from "@/components/refund-payout-block";
import { BottomSheet, PrimaryButton } from "@/components/overview/ui";
import { invalidatePaisa } from "./booking-sheet";
import { moneyError, pf, pkr, type PT } from "./kit";

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

/** One refund in Paisa -> Kaam, compact (founder 14 Nov): name, court · slot · KH-id, reason, what is still owed and the
 * buttons. The player's number and note, the payout account and every refund sent ("Mil gaya / Nahi mila" + the reply box)
 * sit under "Details"; in the "Refund Nahi mila" group Details starts open so the reply box is right there. */
export function RefundCard({ refund, court, t, canMark, canCredit, notGot, onMark, onOpenBooking }: {
  refund: OwnerRefund;
  court: string;
  t: PT;
  canMark: boolean;
  canCredit: boolean;
  notGot?: boolean;
  onMark: () => void;
  onOpenBooking: () => void;
}) {
  const qc = useQueryClient();
  const b = refundBreakdown(refund);
  const who = refund.player_name ?? refund.player_phone ?? "Player";
  const [details, setDetails] = useState(!!notGot);
  const [credit, setCredit] = useState(false);
  return (
    <View testID="paisa-refund-card" style={{ backgroundColor: palette.white, borderRadius: radius.card, padding: space[4], gap: space[3], boxShadow: shadow.card, borderWidth: refund.is_overdue ? 1.5 : 0, borderColor: palette.dangerBorder }}>
      <Pressable onPress={onOpenBooking} accessibilityRole="button" accessibilityLabel={`${who} refund`} style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: space[3] }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong">{who}</Text>
          <Text variant="meta" tone="muted">{`${court} · ${pf.when(refund.starts_at)} · KH-${refund.booking_id.replace(/-/g, "").slice(0, 8).toUpperCase()}`}</Text>
          {refund.reason ? <Text variant="meta" tone="body">{`Wajah: ${REFUND_REASON_RU[refund.reason] ?? refund.reason.replace(/_/g, " ")}`}</Text> : null}
        </View>
        <View style={{ alignItems: "flex-end", gap: space[1] }}>
          <Text variant="title">{pkr(b.remaining)}</Text>
          {b.status === "partial" ? <Pill testID="chip-partial" size="sm" tone="waiting" label="Hissa wapas" /> : null}
          {b.alreadyRefunded > 0 ? <Text variant="caption" tone="muted">{`PKR ${formatPKR(b.refundDue)} mein se baqi`}</Text> : null}
        </View>
      </Pressable>
      {refund.duplicate_proof && refund.duplicate_proof.used_on_bookings > 0 ? (
        <View testID="refund-dup-chip" style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: palette.dangerTint }}>
          <TriangleAlert size={13} color={palette.danger} />
          <Text variant="caption" weight="bold" tone="danger" style={{ flexShrink: 1 }}>{duplicateCreditText(refund.duplicate_proof.used_on_bookings)}</Text>
        </View>
      ) : null}
      {refund.is_overdue ? <Text variant="caption" weight="bold" tone="danger">{`Der ho gayi - ${pf.when(refund.created_at)} se baqi`}</Text> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
        {b.remaining > 0 && canMark ? <Button label={t("paisa.act.refund")} size="sm" onPress={onMark} testID="paisa-refund-mark" /> : null}
        {b.remaining > 0 && canCredit ? <Button label={t("paisa.act.credit")} size="sm" variant="soft" onPress={() => setCredit(true)} testID="refund-keep-credit" /> : null}
        <Button label={t("paisa.act.openBooking")} size="sm" variant="soft" onPress={onOpenBooking} testID="refund-open-booking" />
        <Button label={t("paisa.kaam.details")} size="sm" variant="soft" onPress={() => setDetails((v) => !v)} testID="refund-details" />
      </View>
      {details ? (
        <View style={{ gap: space[3] }} testID="refund-details-body">
          {refund.player_note ? <Text variant="meta" tone="body" testID="refund-player-note">{`Player ki wajah: ${refund.player_note}`}</Text> : null}
          {refund.player_phone ? (
            <View style={{ backgroundColor: palette.ground, borderRadius: radius.md, paddingHorizontal: space[3], paddingVertical: 10, gap: 2 }}>
              <Text variant="caption" tone="muted">{t("paisa.detail.phone")}</Text>
              <Text variant="bodyBold" selectable>{refund.player_phone}</Text>
            </View>
          ) : null}
          <RefundPayoutBlock refund={refund} onChanged={() => void qc.invalidateQueries({ queryKey: ["paisa-tasks"] })} />
        </View>
      ) : null}
      {credit ? <KeepAsCreditSheet refund={refund} t={t} onClose={() => setCredit(false)} onDone={() => { setCredit(false); void invalidatePaisa(qc); }} /> : null}
    </View>
  );
}

/** "Jama rakhein" (owner): what is still owed stays with the player as credit at this venue instead of a refund (same as web). */
function KeepAsCreditSheet({ refund, t, onClose, onDone }: { refund: OwnerRefund; t: PT; onClose: () => void; onDone: () => void }) {
  const max = Math.max(0, refundBreakdown(refund).remaining);
  const [amount, setAmount] = useState(String(max));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const typed = Number(amount.replace(/[^\d]/g, ""));
  const ok = amount.trim() !== "" && typed > 0 && typed <= max;
  async function save() {
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await api.paisa.keepRefundAsCredit(refund.id, typed);
      onDone();
    } catch (e) {
      setError(moneyError(e, t));
    } finally {
      setBusy(false);
    }
  }
  return (
    <BottomSheet title={t("paisa.act.credit")} subtitle={refund.player_name ?? refund.player_phone ?? undefined} onClose={onClose} testID="refund-credit-sheet"
      footer={<PrimaryButton label={t("paisa.act.save")} disabled={!ok} loading={busy} onPress={save} testID="refund-credit-save" />}>
      <Input label={t("paisa.rec.amount")} value={amount} onChangeText={setAmount} keyboardType="number-pad"
        error={typed > max ? t("paisa.adj.max", { amount: pkr(max) }) : null} testID="refund-credit-amount" />
      {error ? <Banner tone="danger" body={error} /> : null}
    </BottomSheet>
  );
}
