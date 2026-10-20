import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import type { OwnerBookingRow } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR, formatTimeRange } from "@/lib/format";
import { OV } from "@/lib/overview";
import { parsePkr } from "@/lib/round2-format";
import { CheckIcon } from "@/components/icons";
import { AlertCircleIcon } from "@/components/overview/icons";
import { BottomSheet, OrangeButton, OutlineButton } from "@/components/overview/ui";

/** Stage 2 (C.3): the error line for a refused no-show (Roman Urdu, never the raw server text). */
export function noShowErrorText(e: unknown): string {
  if (e instanceof ApiError && e.status === 403) return "Aapke paas no-show mark karne ki ijazat nahi hai.";
  if (e instanceof ApiError && e.code === "TOO_EARLY_FOR_NO_SHOW") return "Slot abhi khatam nahi hua. Slot khatam hone ke baad No-show mark karein.";
  if (e instanceof ApiError && e.code === "INVALID_BOOKING_STATE") return "Is booking ka status badal chuka hai. Page refresh karke dekhein.";
  return friendlyErrorMessage(e);
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
      subtitle={`${row.player_name ?? "Player"} - ${row.court_name} - ${formatTimeRange(row.starts_at, row.ends_at)} - ${row.short_code}`}
      onClose={onClose}
      footer={
        <View className="flex-row gap-3">
          <OutlineButton flex label="Wapas" onPress={onClose} />
          <Pressable
            onPress={() => save.mutate()}
            disabled={save.isPending}
            accessibilityRole="button"
            accessibilityLabel="No-show mark karein"
            style={{ flex: 1, minHeight: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: OV.red, opacity: save.isPending ? 0.5 : 1 }}
          >
            <Text className="font-plex-bold text-white text-[14px]">{save.isPending ? "Save ho raha hai" : "No-show mark karein"}</Text>
          </Pressable>
        </View>
      }
    >
      <View testID="no-show-confirm" className="flex-row items-start gap-2 rounded-xl px-3.5 py-3" style={{ backgroundColor: OV.redBg }}>
        <AlertCircleIcon size={18} />
        <Text className="flex-1 font-plex-semibold text-[13.5px]" style={{ color: OV.red }}>
          Player khelne nahi aaya? Booking No-show mark ho jayegi.
        </Text>
      </View>
      <Text className="font-plex-medium text-owner-ink-muted text-[12.5px]">
        Ye record ke saath save hoga (kis ne, kab). Ghalti ho to baad mein Haan/Nahi se booking Completed kar sakte hain.
      </Text>
      {error ? <Text className="font-plex-medium text-owner-danger text-[13px]">{error}</Text> : null}
    </BottomSheet>
  );
}

/** Round 2 (A8) "Nahi": how much of the REMAINING due came in now. Adds a positive payment (never lowers what was
 * paid); entering the whole due makes the booking Mukammal; a reason is needed only while some due remains. Stage 2 (C.3):
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
            : friendlyErrorMessage(e),
      ),
  });

  return (
    <BottomSheet
      title="Booking adhoora?"
      subtitle={`${row.player_name ?? "Player"} - ${row.court_name} - ${formatTimeRange(row.starts_at, row.ends_at)} - ${row.short_code}`}
      onClose={onClose}
      footer={
        <View className="flex-row gap-3">
          <OutlineButton flex label="Cancel" onPress={onClose} />
          <OrangeButton flex label={save.isPending ? "Save ho raha hai" : "Save karein"} disabled={!valid || save.isPending} onPress={() => save.mutate()} />
        </View>
      }
    >
      <View className="flex-row justify-between rounded-2xl px-4 py-3.5" style={{ backgroundColor: "#F4F6F7" }}>
        <Text className="font-plex-medium text-owner-ink-muted text-[13.5px]">
          Total <Text className="font-plex-bold text-owner-ink">{formatPKR(row.total)}</Text>
        </Text>
        <Text className="font-plex-medium text-owner-ink-muted text-[13.5px]">
          Mila <Text className="font-plex-bold text-owner-ink">{formatPKR(row.total_paid)}</Text>
        </Text>
        <Text className="font-plex-medium text-owner-ink-muted text-[13.5px]">
          Due <Text className="font-plex-bold text-owner-ink">{formatPKR(due)}</Text>
        </Text>
      </View>

      <Text className="font-plex-bold text-owner-ink text-[14px] mt-1">Baqi mein se kitna mila? (PKR)</Text>
      <TextInput
        value={amount}
        onChangeText={(t) => {
          setAmount(t);
          setError(null);
        }}
        keyboardType="number-pad"
        accessibilityLabel="Baqi mein se kitna mila, PKR"
        className="rounded-xl px-4 font-plex-medium text-owner-ink text-[17px]"
        style={{ minHeight: 52, borderWidth: 1.5, borderColor: inRange || amount === "" ? OV.border : OV.red }}
      />
      <Text className="font-plex-medium text-owner-ink-muted text-[12.5px]">{`0 se ${formatPKR(due)} tak. Pehle se mila hua paisa kam nahi hoga.`}</Text>
      {!inRange && amount !== "" ? (
        <Text className="font-plex-semibold text-owner-danger text-[12.5px]">{`Sirf 0 se PKR ${formatPKR(due)} tak likhein.`}</Text>
      ) : null}

      {dueAfter !== null ? (
        full ? (
          <View testID="completion-live" className="flex-row items-center gap-2 rounded-xl px-3.5 py-3" style={{ backgroundColor: OV.greenBg }}>
            <CheckIcon size={16} color={OV.greenDark} strokeWidth={2.6} />
            <Text className="flex-1 font-plex-semibold text-[13.5px]" style={{ color: OV.greenDark }}>
              Save karne par Due PKR 0 rahega. Booking Mukammal ho jayegi.
            </Text>
          </View>
        ) : (
          <View testID="completion-live" className="flex-row items-center gap-2 rounded-xl px-3.5 py-3" style={{ backgroundColor: OV.redBg }}>
            <AlertCircleIcon size={18} />
            <Text className="flex-1 font-plex-semibold text-[13.5px]" style={{ color: OV.red }}>
              {`Save karne par Due PKR ${formatPKR(dueAfter)} rahega.`}
            </Text>
          </View>
        )
      ) : null}

      {!full ? (
        <>
          <Text className="font-plex-bold text-owner-ink text-[14px] mt-1">{needsReason ? "Wajah (zaroori)" : "Wajah"}</Text>
          <TextInput
            value={reason}
            onChangeText={setReason}
            multiline
            textAlignVertical="top"
            accessibilityLabel="Wajah"
            placeholder="Customer ne kaha baqi paisa kal dega."
            placeholderTextColor={OV.faint}
            className="rounded-xl px-4 py-3 font-plex-medium text-owner-ink text-[15px]"
            style={{ minHeight: 100, borderWidth: 1.5, borderColor: OV.border }}
          />
          <Text className="font-plex-medium text-owner-ink-muted text-[12.5px]">Keyboard ke mic se bolein</Text>
        </>
      ) : null}

      {error ? <Text className="font-plex-medium text-owner-danger text-[13px]">{error}</Text> : null}
      <Text className="font-plex-medium text-owner-ink-faint text-[12px]">
        Save karne par booking Completed ho jayegi. Ye record ke saath save hoga (kis ne, kab). Ghalti ho to payment correction se theek karein.
      </Text>
    </BottomSheet>
  );
}
