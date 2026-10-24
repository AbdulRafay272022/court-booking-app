import { useState } from "react";
import type { LedgerEntry } from "@court-booking/types";
import { Banner, Input, Text } from "@/components/ui";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR, formatWhen } from "@/lib/format";
import { BottomSheet, DangerButton } from "@/components/overview/ui";
import { KeyValue, KeyValueBlock } from "@/app/(owner)/_fl";

const METHOD: Record<string, string> = { bank_transfer_proof: "Bank transfer", cash_at_venue: "Cash", other: "Kuch aur" };

/**
 * OPaisa "Theek karein" (Section 32 Part 5): POST /payment-entries/{id}/reverse {reason}. It adds a REVERSING row, never
 * edits or deletes the original. Touches real money, so it is a sheet with the entry read back and a required reason.
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
    <BottomSheet
      title="Payment theek karein"
      subtitle={entry.player ?? "Walk-in"}
      onClose={onClose}
      testID="correct-payment-sheet"
      footer={<DangerButton label={submitting ? "Ho raha hai" : "Haan, ulti entry karein"} onPress={handleConfirm} disabled={!valid || submitting} testID="correct-confirm" />}
    >
      <KeyValueBlock>
        <KeyValue label="Raqam" value={`PKR ${formatPKR(entry.amount_pkr)}`} />
        <KeyValue label="Kab record hua" value={formatWhen(entry.recorded_at)} />
        <KeyValue label="Court" value={entry.court} />
        <KeyValue label="Booking" value={formatWhen(entry.starts_at)} />
        <KeyValue label="Tareeqa" value={METHOD[entry.method] ?? entry.method} last />
      </KeyValueBlock>
      <Banner
        tone="waiting"
        body={`Ek nayi entry -PKR ${formatPKR(entry.amount_pkr)} ki banegi. Asal entry ledger mein nazar aati rahegi, kuch delete nahi hota. Booking ka baqi foran badal jayega; sahi raqam phir "Payment record karein" se dalein.`}
      />
      <Input label="Kyun theek kar rahe hain? (zaroori)" value={reason} onChangeText={setReason} placeholder="Maslan: ghalat raqam likh di thi" multiline testID="correct-reason" />
      {error ? (
        <Text variant="meta" weight="bold" tone="danger">
          {error}
        </Text>
      ) : null}
    </BottomSheet>
  );
}
