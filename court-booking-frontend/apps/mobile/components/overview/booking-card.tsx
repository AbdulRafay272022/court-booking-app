import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { OwnerBookingRow } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR, formatTimeRange } from "@/lib/format";
import { OV, TONE_STYLE, courtNumber, durationLabel, rowTone, statusChipLabel } from "@/lib/overview";
import { CheckIcon, ChevronDownIcon } from "@/components/icons";
import { AlertCircleIcon } from "./icons";
import { BottomSheet, OrangeButton, OutlineButton, SmallChip } from "./ui";

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View className="flex-1 gap-0.5">
      <Text className="font-plex-medium text-owner-ink-muted text-[12.5px]">{label}</Text>
      <Text className="font-mono-semibold text-[15px]" style={{ color: color ?? OV.ink }}>
        {value}
      </Text>
    </View>
  );
}

/** Invalidate everything a completion change touches. */
function useInvalidateOverview() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["owner-overview"] });
    qc.invalidateQueries({ queryKey: ["owner-history"] });
    qc.invalidateQueries({ queryKey: ["owner-booking-detail"] });
    qc.invalidateQueries({ queryKey: ["owner-ledger"] });
  };
}

function statusChip(row: OwnerBookingRow) {
  const key = row.status_key;
  const tone =
    row.kind === "refund" ? { bg: OV.amberBg, fg: OV.amberDark } : row.kind === "cancelled" ? { bg: OV.redBg, fg: OV.red } : { bg: OV.accentSoft, fg: OV.accent };
  const label = row.kind === "refund" ? statusChipLabel(row.refund_status === "paid" ? "refunded" : "refund_owed") : statusChipLabel(key);
  return <SmallChip label={label} bg={tone.bg} fg={tone.fg} />;
}

export function BookingCard({
  row,
  highlighted,
  onOpen,
  onOpenOriginal,
  onLayoutY,
  canComplete = true,
}: {
  row: OwnerBookingRow;
  highlighted?: boolean;
  onOpen: () => void;
  onOpenOriginal: () => void;
  onLayoutY?: (y: number) => void;
  canComplete?: boolean;
}) {
  const tone = TONE_STYLE[rowTone(row)];
  const [picking, setPicking] = useState(false);
  const [adhoora, setAdhoora] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invalidate = useInvalidateOverview();
  const initial = (row.player_name ?? "?").trim().charAt(0).toUpperCase() || "?";
  const isBooked = row.kind === "booked" && ["booked", "no_show"].includes(row.status_key);
  const refundLine =
    row.kind === "refund" && row.refund_amount != null
      ? `${row.refund_status === "paid" ? "Refund bheja gaya" : "Refund bhejna hai"} · PKR ${formatPKR(row.refund_amount)}`
      : null;

  const yes = useMutation({
    mutationFn: () => api.owners.markCompletion(row.booking_id, { result: "yes" }),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (e) => setError(e instanceof ApiError && e.status === 403 ? "Aapke paas payments record karne ki ijazat nahi hai." : friendlyErrorMessage(e)),
  });

  const current = row.completion?.result === "yes" ? "Haan" : row.completion?.result === "no" ? "Nahi" : "Chunein";
  const disabled = !row.slot_ended || !canComplete || yes.isPending;

  return (
    <View
      onLayout={(e) => onLayoutY?.(e.nativeEvent.layout.y)}
      className="rounded-2xl"
      style={{
        backgroundColor: tone.bg,
        borderWidth: highlighted ? 2.5 : 1.5,
        borderColor: highlighted ? OV.orange : tone.border,
      }}
    >
      <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${row.player_name ?? "Booking"}, ${row.short_code}`} className="p-4 gap-3.5">
        <View className="flex-row items-start gap-3">
          <View
            className="w-11 h-11 rounded-full items-center justify-center"
            style={{ backgroundColor: row.kind === "refund" ? OV.amber : OV.accent }}
          >
            <Text className="font-plex-bold text-white text-[18px]">{initial}</Text>
          </View>
          <View className="flex-1 gap-0.5">
            <Text className="font-plex-bold text-owner-ink text-[16.5px]" numberOfLines={1}>
              {row.player_name ?? "Player"}
              {row.kind === "refund" ? " · refund" : ""}
            </Text>
            {refundLine ? (
              <Text className="font-plex-medium text-owner-ink-muted text-[13px]">{refundLine}</Text>
            ) : (
              <Text className="font-plex-medium text-owner-ink-muted text-[13px]">
                {`${formatTimeRange(row.starts_at, row.ends_at)} · ${durationLabel(row.duration_minutes)}`}
              </Text>
            )}
          </View>
          <View className="items-end gap-1">
            {statusChip(row)}
            {row.checked_in ? <SmallChip label="Checked in" bg={OV.greenBg} fg={OV.greenDark} /> : null}
            {row.status_key === "no_show" ? <SmallChip label="No-show" bg={OV.redBg} fg={OV.red} /> : null}
          </View>
        </View>

        {row.kind !== "refund" ? (
          <View className="flex-row gap-2">
            <Stat label="Court" value={courtNumber(row.court_name)} />
            <Stat label="Total" value={formatPKR(row.total)} />
            <Stat label="Advance" value={formatPKR(row.advance)} />
            <Stat label="Due" value={formatPKR(row.due)} color={row.due > 0 ? OV.red : OV.ink} />
          </View>
        ) : null}
      </Pressable>

      {isBooked ? (
        <View className="px-4 pb-4 flex-row items-center gap-3">
          <Pressable
            onPress={() => setPicking(true)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={`Booking completed: ${current}`}
            accessibilityState={{ disabled }}
            className="flex-row items-center justify-between rounded-xl bg-owner-surface px-4"
            style={{
              minHeight: 48,
              minWidth: 130,
              borderWidth: 1.5,
              borderColor: disabled ? OV.border : OV.ink,
              opacity: disabled ? 0.7 : 1,
            }}
          >
            <Text className="font-plex-semibold text-owner-ink text-[15px]">{current}</Text>
            <ChevronDownIcon color={OV.ink} />
          </Pressable>
          {!row.slot_ended ? (
            <Text className="flex-1 font-plex-medium text-owner-ink-muted text-[12.5px] text-right">Slot khatam hone ke baad</Text>
          ) : row.completion?.result === "yes" ? (
            <SmallChip label="Mukammal" bg={OV.greenBg} fg={OV.greenDark} icon={<CheckIcon size={13} color={OV.greenDark} strokeWidth={2.6} />} />
          ) : row.completion?.result === "no" ? (
            <SmallChip label="Adhoora" bg={OV.redBg} fg={OV.red} icon={<AlertCircleIcon size={13} />} />
          ) : null}
        </View>
      ) : null}

      {row.kind !== "booked" ? (
        <View className="px-4 pb-4 flex-row flex-wrap items-center gap-2.5">
          <Text className="font-plex-medium text-owner-ink-muted text-[12.5px]">{row.short_code}</Text>
          {row.original_booking_id ? <SmallChip label="Original booking dekhein" bg="#FFFFFF" fg={OV.ink} onPress={onOpenOriginal} /> : null}
        </View>
      ) : null}

      {error ? <Text className="px-4 pb-3 font-plex-medium text-owner-danger text-[12.5px]">{error}</Text> : null}

      {picking ? (
        <BottomSheet title="Booking completed?" subtitle={`${row.player_name ?? "Player"} · ${row.short_code}`} onClose={() => setPicking(false)}>
          <View className="gap-2.5 pb-2">
            {[
              { v: "yes", label: "Haan", sub: "Poora paisa mil gaya" },
              { v: "no", label: "Nahi", sub: "Kam paisa mila" },
            ].map((o) => (
              <Pressable
                key={o.v}
                onPress={() => {
                  setPicking(false);
                  if (o.v === "yes") {
                    if (row.completion?.result !== "yes") yes.mutate();
                  } else {
                    setAdhoora(true);
                  }
                }}
                accessibilityRole="button"
                className="rounded-xl px-4 justify-center"
                style={{ minHeight: 56, borderWidth: 1.5, borderColor: OV.border }}
              >
                <Text className="font-plex-bold text-owner-ink text-[16px]">{o.label}</Text>
                <Text className="font-plex-medium text-owner-ink-faint text-[12.5px]">{o.sub}</Text>
              </Pressable>
            ))}
          </View>
        </BottomSheet>
      ) : null}
      {adhoora ? <AdhooraSheet row={row} onClose={() => setAdhoora(false)} onSaved={invalidate} /> : null}
    </View>
  );
}

/** "Booking adhoora?": Kitna mila + Wajah. The phone keyboard's own mic does the voice typing (no native module). */
function AdhooraSheet({ row, onClose, onSaved }: { row: OwnerBookingRow; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState(String(Math.round(row.total_paid)));
  const [reason, setReason] = useState(row.completion?.reason ?? "");
  const [error, setError] = useState<string | null>(null);
  const cleaned = amount.replace(/[,\s]/g, "");
  const received = /^\d+$/.test(cleaned) ? Number(cleaned) : null;
  const valid = received !== null && received >= 0 && received <= row.total;
  const dueAfter = valid ? row.total - (received as number) : null;

  const save = useMutation({
    mutationFn: () => api.owners.markCompletion(row.booking_id, { result: "no", received_pkr: received as number, reason: reason.trim() || undefined }),
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError && e.status === 403 ? "Aapke paas payments record karne ki ijazat nahi hai." : friendlyErrorMessage(e)),
  });

  return (
    <BottomSheet
      title="Booking adhoora?"
      subtitle={`${row.player_name ?? "Player"} · ${row.court_name} · ${formatTimeRange(row.starts_at, row.ends_at)} · ${row.short_code}`}
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
          Advance <Text className="font-plex-bold text-owner-ink">{formatPKR(row.advance)}</Text>
        </Text>
        <Text className="font-plex-medium text-owner-ink-muted text-[13.5px]">
          Baqi <Text className="font-plex-bold text-owner-ink">{formatPKR(row.due)}</Text>
        </Text>
      </View>

      <Text className="font-plex-bold text-owner-ink text-[14px] mt-1">Kitna mila? (PKR)</Text>
      <TextInput
        value={amount}
        onChangeText={(t) => {
          setAmount(t);
          setError(null);
        }}
        keyboardType="number-pad"
        accessibilityLabel="Kitna mila, PKR"
        className="rounded-xl px-4 font-plex-medium text-owner-ink text-[17px]"
        style={{ minHeight: 52, borderWidth: 1.5, borderColor: valid || amount === "" ? OV.border : OV.red }}
      />
      <Text className="font-plex-medium text-owner-ink-muted text-[12.5px]">
        {`0 se ${formatPKR(row.total)} ke darmiyan. Baqi due apne aap nikal aayega.`}
      </Text>

      <Text className="font-plex-bold text-owner-ink text-[14px] mt-1">Wajah</Text>
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
      <Text className="font-plex-medium text-owner-ink-muted text-[12.5px]">Keyboard ke mic se bol kar likh sakte hain</Text>

      {dueAfter !== null ? (
        <View className="flex-row items-center gap-2 rounded-xl px-3.5 py-3" style={{ backgroundColor: OV.redBg }}>
          <AlertCircleIcon size={18} />
          <Text className="flex-1 font-plex-semibold text-[13.5px]" style={{ color: OV.red }}>
            {`Save karne par row laal ho jayegi aur Due ${formatPKR(dueAfter)} rahega.`}
          </Text>
        </View>
      ) : null}
      {error ? <Text className="font-plex-medium text-owner-danger text-[13px]">{error}</Text> : null}
      <Text className="font-plex-medium text-owner-ink-faint text-[12px]">
        Ye record ke saath save hoga (kis ne, kab). Baad mein badla bhi ja sakta hai.
      </Text>
    </BottomSheet>
  );
}
