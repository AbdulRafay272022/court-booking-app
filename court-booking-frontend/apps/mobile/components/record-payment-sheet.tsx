import { useState } from "react";
import { ActivityIndicator, Modal, Pressable, Text, TextInput, View } from "react-native";
import type { PaymentMethod } from "@court-booking/types";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR } from "@/lib/format";

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash_at_venue", label: "Cash" },
  { value: "bank_transfer_proof", label: "Bank transfer" },
  { value: "other", label: "Other" },
];

/**
 * "Record payment" (Section 32 Part 5): the owner records money actually received against a booking's
 * remaining balance -- refuses to record more than what's still owed, and shows the balance remaining
 * after. Booking is marked fully paid server-side (balance_due = 0) once the entries sum to the price.
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
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end" style={{ backgroundColor: "rgba(0,0,0,0.4)" }} onPress={onClose}>
        <Pressable className="bg-owner-surface rounded-t-3xl px-5 pt-5 pb-8 gap-4" onPress={(e) => e.stopPropagation?.()}>
          <View className="flex-row items-start justify-between gap-3">
            <View className="gap-1 flex-1">
              <Text className="font-plex-bold text-[11px] tracking-[0.1em]" style={{ color: "#0E6274" }}>
                RECORD PAYMENT
              </Text>
              <Text className="font-plex-bold text-owner-ink text-[17px]">{playerLabel}</Text>
              <Text className="font-mono-medium text-owner-ink-faint text-[13px]">
                PKR {formatPKR(balanceDue)} still owed
              </Text>
            </View>
            <Pressable onPress={onClose} accessibilityLabel="Close" className="w-11 h-11 rounded-xl bg-owner-bg items-center justify-center">
              <Text className="font-plex-bold text-owner-ink text-base">✕</Text>
            </Pressable>
          </View>

          <View className="gap-2">
            <Text className="font-plex-semibold text-owner-ink text-[13px]">Amount (PKR)</Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              keyboardType="number-pad"
              className="font-mono-semibold text-owner-ink text-[22px] px-4 rounded-xl border border-owner-border"
              style={{ height: 54 }}
            />
            {!valid && amount.length > 0 ? (
              <Text className="font-plex-medium text-[12.5px]" style={{ color: "#8C3823" }}>
                {amountNum > balanceDue ? `Can't be more than PKR ${formatPKR(balanceDue)}` : "Enter an amount greater than zero"}
              </Text>
            ) : null}
          </View>

          <View className="gap-2">
            <Text className="font-plex-semibold text-owner-ink text-[13px]">How was it paid?</Text>
            <View className="flex-row gap-2">
              {METHODS.map((m) => {
                const selected = m.value === method;
                return (
                  <Pressable
                    key={m.value}
                    onPress={() => setMethod(m.value)}
                    className="flex-1 rounded-xl items-center justify-center"
                    style={{
                      minHeight: 44,
                      backgroundColor: selected ? "#0E6274" : "#F4F6F7",
                    }}
                  >
                    <Text className="font-plex-semibold text-[13px]" style={{ color: selected ? "#FFFFFF" : "#5B7079" }}>
                      {m.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View className="gap-2">
            <Text className="font-plex-semibold text-owner-ink text-[13px]">Note (optional)</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="e.g. paid at the counter"
              className="font-plex-medium text-owner-ink text-[14px] px-4 rounded-xl border border-owner-border"
              style={{ height: 48 }}
            />
          </View>

          {error ? (
            <Text className="font-plex-semibold text-[13px]" style={{ color: "#8C3823" }}>
              {error}
            </Text>
          ) : null}

          <Pressable
            onPress={handleSubmit}
            disabled={!valid || submitting}
            className="rounded-xl items-center justify-center flex-row gap-2"
            style={{ minHeight: 50, backgroundColor: "#0E6274", opacity: valid && !submitting ? 1 : 0.5 }}
          >
            {submitting ? <ActivityIndicator color="#FFFFFF" /> : null}
            <Text className="font-plex-bold text-white text-[15px]">Record PKR {valid ? formatPKR(amountNum) : "0"}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
