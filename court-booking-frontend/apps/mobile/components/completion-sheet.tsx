import { useState } from "react";
import { View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { CircleAlert, CircleCheck } from "lucide-react-native";
import type { OwnerBookingRow } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";
import { palette, radius, space } from "@court-booking/ui-tokens";
import { Banner, Input, Text } from "@/components/ui";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR, formatTimeRange } from "@/lib/format";
import { parsePkr } from "@/lib/round2-format";
import { BottomSheet, DangerButton, OutlineButton, PrimaryButton } from "@/components/overview/ui";

/** Stage 2 (C.3): the error line for a refused no-show (Roman Urdu, never the raw server text). */
export function noShowErrorText(e: unknown): string {
  if (e instanceof ApiError && e.status === 403) return "Aapke paas no-show mark karne ki ijazat nahi hai.";
  if (e instanceof ApiError && e.code === "TOO_EARLY_FOR_NO_SHOW") return "Slot abhi khatam nahi hua. Slot khatam hone ke baad No-show mark karein.";
  if (e instanceof ApiError && e.code === "INVALID_BOOKING_STATE") return "Is booking ka status badal chuka hai. Page refresh karke dekhein.";
  return friendlyErrorMessage(e);
}

function sub(row: OwnerBookingRow) {
  return `${row.player_name ?? "Player"} · ${row.court_name} · ${formatTimeRange(row.starts_at, row.ends_at)} · ${row.short_code}`;
}

/** Stage 2 (C.3): "Nahi aaye (No-show)" confirm (a sheet, never Alert.alert: that is a no-op on Expo web). The server
 * records who/when; a mistake is fixed later with Haan/Nahi (no_show -> completed). */
export function NoShowSheet({ row, onClose, onSaved }: { row: OwnerBookingRow; onClose: () => void; onSaved: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api.bookings.noShow(row.booking_id),
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (e) => setError(noShowErrorText(e)),
  });
  return (
    <BottomSheet
      title="Nahi aaye (No-show)?"
      subtitle={sub(row)}
      onClose={onClose}
      footer={
        <View style={{ flexDirection: "row", gap: space[3] }}>
          <OutlineButton flex label="Wapas" onPress={onClose} />
          <DangerButton flex label={save.isPending ? "Save ho raha hai" : "No-show mark karein"} disabled={save.isPending} onPress={() => save.mutate()} />
        </View>
      }
    >
      <View testID="no-show-confirm">
        <Banner tone="danger" body="Player khelne nahi aaya? Booking No-show mark ho jayegi." />
      </View>
      <Text variant="meta" tone="muted">
        {'Ye record ke saath save hoga (kis ne, kab). Ghalti ho to baad mein "No-show hatayein" se theek kar sakte hain.'}
      </Text>
      {error ? (
        <Text variant="meta" weight="bold" tone="danger">
          {error}
        </Text>
      ) : null}
    </BottomSheet>
  );
}

/** Total / Advance-or-Mila / Baqi strip at the top of the OSheets "Booking adhoora?" sheet. */
function MoneyStrip({ items }: { items: { label: string; value: string }[] }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: space[3], backgroundColor: palette.ground, borderRadius: radius.input, paddingHorizontal: space[4], paddingVertical: 14 }}>
      {items.map((i) => (
        <Text key={i.label} variant="body" tone="muted">
          {`${i.label} `}
          <Text variant="bodyStrong">{i.value}</Text>
        </Text>
      ))}
    </View>
  );
}

/** Round 2 (A8) "Nahi" (OSheets "Booking adhoora?"): how much of the REMAINING due came in now. Adds a positive payment
 * (never lowers what was paid); entering the whole due makes the booking Mukammal; a reason is needed only while some due
 * remains (REASON_REQUIRED). POST /owners/bookings/{id}/completion {result:"no", received_now, reason}. Stage 2 (C.3):
 * saving marks the booking Completed either way (also from No-show). */
export function CompletionSheet({ row, onClose, onSaved }: { row: OwnerBookingRow; onClose: () => void; onSaved: () => void }) {
  const due = Math.max(0, Math.round(row.due));
  const [amount, setAmount] = useState("0");
  const [reason, setReason] = useState(row.completion?.reason ?? "");
  const [error, setError] = useState<string | null>(null);
  const received = parsePkr(amount);
  const inRange = received !== null && received >= 0 && received <= due;
  const dueAfter = inRange ? due - (received as number) : null;
  const full = dueAfter === 0;
  const needsReason = dueAfter !== null && dueAfter > 0;
  const valid = inRange && (!needsReason || reason.trim().length > 0);

  const save = useMutation({
    mutationFn: () =>
      api.owners.markCompletion(row.booking_id, {
        result: "no",
        received_now: received as number,
        reason: reason.trim() || undefined,
      }),
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (e) =>
      setError(
        e instanceof ApiError && e.status === 403
          ? "Aapke paas payments record karne ki ijazat nahi hai."
          : e instanceof ApiError && e.code === "REASON_REQUIRED"
            ? "Baqi Due ki wajah likhein."
            : e instanceof ApiError && e.code === "COMPLETION_TOO_EARLY"
              ? "Slot abhi khatam nahi hua. Khatam hone ke baad save karein."
              : friendlyErrorMessage(e),
      ),
  });

  return (
    <BottomSheet
      title="Booking adhoora?"
      subtitle={sub(row)}
      onClose={onClose}
      footer={
        <View style={{ gap: space[2] }}>
          <View style={{ flexDirection: "row", gap: space[3] }}>
            <OutlineButton flex label="Cancel" onPress={onClose} />
            <PrimaryButton flex label={save.isPending ? "Save ho raha hai" : "Save karein"} disabled={!valid || save.isPending} onPress={() => save.mutate()} />
          </View>
          <Text variant="caption" tone="subtle">
            Save karne par booking Completed ho jayegi. Ye record ke saath save hoga (kis ne, kab). Ghalti ho to payment correction se theek karein.
          </Text>
        </View>
      }
    >
      <MoneyStrip
        items={[
          { label: "Total", value: formatPKR(row.total) },
          { label: "Mila", value: formatPKR(row.total_paid) },
          { label: "Baqi", value: formatPKR(due) },
        ]}
      />

      <Input
        label="Baqi mein se kitna mila? (PKR)"
        value={amount}
        onChangeText={(t) => {
          setAmount(t);
          setError(null);
        }}
        keyboardType="number-pad"
        accessibilityLabel="Baqi mein se kitna mila, PKR"
        help={`0 se ${formatPKR(due)} tak. Pehle se mila hua paisa kam nahi hoga.`}
        error={!inRange && amount !== "" ? `Sirf 0 se PKR ${formatPKR(due)} tak likhein.` : null}
      />

      {dueAfter !== null ? (
        <View testID="completion-live">
          {full ? (
            <Banner tone="open" icon={CircleCheck} body="Save karne par Due PKR 0 rahega. Booking Mukammal ho jayegi." />
          ) : (
            <Banner tone="danger" icon={CircleAlert} body={`Save karne par Due PKR ${formatPKR(dueAfter)} rahega.`} />
          )}
        </View>
      ) : null}

      {!full ? (
        <Input
          label={needsReason ? "Wajah (zaroori)" : "Wajah"}
          value={reason}
          onChangeText={setReason}
          multiline
          accessibilityLabel="Wajah"
          placeholder="Customer ne kaha baqi paisa kal dega."
          help="Keyboard ke mic se bolein"
        />
      ) : null}

      {error ? (
        <Text variant="meta" weight="bold" tone="danger">
          {error}
        </Text>
      ) : null}
    </BottomSheet>
  );
}
