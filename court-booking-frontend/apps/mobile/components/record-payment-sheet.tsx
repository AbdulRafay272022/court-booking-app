import { useState } from "react";
import { View } from "react-native";
import type { PaymentMethod } from "@court-booking/types";
import { space } from "@court-booking/ui-tokens";
import { Chip, Input, Text } from "@/components/ui";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR } from "@/lib/format";
import { BottomSheet, PrimaryButton } from "@/components/overview/ui";

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash_at_venue", label: "Cash" },
  { value: "bank_transfer_proof", label: "Bank transfer" },
  { value: "other", label: "Kuch aur" },
];

/**
 * "Payment record karein" (Section 32 Part 5, flag split_payments): the owner records money actually received against a
 * booking's remaining balance before the slot is over (POST /bookings/{id}/payment-entries). Refuses more than what is
 * still owed. After the slot, "Baqi mil gaye" uses the completion call instead.
 */
export function RecordPaymentSheet({
  bookingId,
  playerLabel,
  balanceDue,
  onClose,
  onRecorded,
}: {
  bookingId: string;
  playerLabel: string;
  balanceDue: number;
  onClose: () => void;
  onRecorded: (result: { amount_paid: number; balance_due: number }) => void;
}) {
  const [amount, setAmount] = useState(String(Math.round(balanceDue)));
  const [method, setMethod] = useState<PaymentMethod>("cash_at_venue");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountNum = Number(amount);
  const valid = Number.isFinite(amountNum) && amountNum > 0 && amountNum <= balanceDue;

  async function handleSubmit() {
    if (!valid) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.payments.recordEntry(bookingId, {
        amount_pkr: Math.round(amountNum),
        method,
        note: note.trim() || undefined,
      });
      onRecorded({ amount_paid: result.amount_paid, balance_due: result.balance_due });
    } catch (e) {
      setError(friendlyErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <BottomSheet
      title="Payment record karein"
      subtitle={`${playerLabel} · PKR ${formatPKR(balanceDue)} baqi`}
      onClose={onClose}
      footer={<PrimaryButton label={`PKR ${valid ? formatPKR(amountNum) : "0"} record karein`} onPress={handleSubmit} disabled={!valid} loading={submitting} />}
    >
      <Input
        label="Kitna mila (PKR)"
        value={amount}
        onChangeText={setAmount}
        keyboardType="number-pad"
        error={!valid && amount.length > 0 ? (amountNum > balanceDue ? `PKR ${formatPKR(balanceDue)} se zyada nahi` : "Zero se zyada likhein") : null}
      />
      <View style={{ gap: space[2] }}>
        <Text variant="label">Kaise mila?</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
          {METHODS.map((m) => (
            <Chip key={m.value} label={m.label} shape="tile" selected={m.value === method} onPress={() => setMethod(m.value)} />
          ))}
        </View>
      </View>
      <Input label="Note (optional)" value={note} onChangeText={setNote} placeholder="Maslan: counter par diya" />
      {error ? (
        <Text variant="meta" weight="bold" tone="danger">
          {error}
        </Text>
      ) : null}
    </BottomSheet>
  );
}
