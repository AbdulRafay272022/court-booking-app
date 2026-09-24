import { useState } from "react";
import { ActivityIndicator, Modal, Pressable, Text, TextInput, View } from "react-native";
import type { LedgerEntry } from "@court-booking/types";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR, formatWhen } from "@/lib/format";

/**
 * "Correct a payment" (Section 32 Part 5): reverses a mistaken ledger entry -- never edits or deletes it.
 * Touches real money, so this is a two-step confirm (open the sheet, read the entry back, type a reason,
 * then tap Confirm) rather than a single-tap action. A venue owner can correct their own venue's entries;
 * an admin can correct any (enforced server-side, same accessible-booking check as recording one).
 */
export function CorrectPaymentSheet({
  entry,
  onClose,
  onReversed,
}: {
  entry: LedgerEntry;
  onClose: () => void;
  onReversed: () => void;
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = reason.trim().length > 0;

  async function handleConfirm() {
    if (!valid) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.payments.reverseEntry(entry.entry_id, reason.trim());
      onReversed();
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
              <Text className="font-plex-bold text-[11px] tracking-[0.1em]" style={{ color: "#8C3823" }}>
                CORRECT A PAYMENT
              </Text>
              <Text className="font-plex-bold text-owner-ink text-[17px]">{entry.player ?? "Walk-in"}</Text>
            </View>
            <Pressable onPress={onClose} accessibilityLabel="Close" className="w-11 h-11 rounded-xl bg-owner-bg items-center justify-center">
              <Text className="font-plex-bold text-owner-ink text-base">✕</Text>
            </Pressable>
          </View>

          <View className="rounded-xl p-3.5 gap-1.5" style={{ backgroundColor: "#F4F6F7" }}>
            <Row label="Amount" value={`PKR ${formatPKR(entry.amount_pkr)}`} />
            <Row label="Recorded" value={formatWhen(entry.recorded_at)} />
            <Row label="Court" value={entry.court} />
            <Row label="Booking" value={formatWhen(entry.starts_at)} />
            <Row label="Method" value={entry.method.replace(/_/g, " ")} />
          </View>

          <Text className="font-plex-medium text-owner-ink-faint text-[12.5px]">
            This will record a new entry for -PKR {formatPKR(entry.amount_pkr)}, so the original stays visible in the
            ledger -- nothing is edited or deleted. The booking&apos;s balance updates immediately.
          </Text>

          <View className="gap-2">
            <Text className="font-plex-semibold text-owner-ink text-[13px]">Why is this being corrected?</Text>
            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder="e.g. entered the wrong amount"
              className="font-plex-medium text-owner-ink text-[14px] px-4 rounded-xl border border-owner-border"
              style={{ height: 48 }}
              multiline
            />
          </View>

          {error ? (
            <Text className="font-plex-semibold text-[13px]" style={{ color: "#8C3823" }}>
              {error}
            </Text>
          ) : null}

          <Pressable
            onPress={handleConfirm}
            disabled={!valid || submitting}
            className="rounded-xl items-center justify-center flex-row gap-2"
            style={{ minHeight: 50, backgroundColor: "#8C3823", opacity: valid && !submitting ? 1 : 0.5 }}
          >
            {submitting ? <ActivityIndicator color="#FFFFFF" /> : null}
            <Text className="font-plex-bold text-white text-[15px]">Confirm reversal</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between">
      <Text className="font-plex-medium text-owner-ink-faint text-[12.5px]">{label}</Text>
      <Text className="font-mono-semibold text-owner-ink text-[12.5px]">{value}</Text>
    </View>
  );
}
