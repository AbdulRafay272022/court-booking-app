import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { OwnerBookingRow } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR, formatTimeRange } from "@/lib/format";
import { OV, PERM, TONE_STYLE, canOfferNoShow, courtNumber, durationLabel, isStatusPending, rowStatusLabel, rowTone, statusChipLabel } from "@/lib/overview";
import { useMyPermissions } from "@/lib/use-my-permissions";
import { CheckIcon, ChevronDownIcon, ClockIcon } from "@/components/icons";
import { AlertCircleIcon } from "./icons";
import { BottomSheet, SmallChip } from "./ui";
import { CompletionSheet, NoShowSheet } from "@/components/completion-sheet";

/** Stage 2 (C.3): booked, slot over, not marked yet (icon + text, never colour alone). */
export function StatusPendingChip() {
  return (
    <View testID="status-pending-chip">
      <SmallChip label="Status baqi" bg={OV.amberBg} fg={OV.amberDark} icon={<ClockIcon size={12} color={OV.amberDark} />} />
    </View>
  );
}

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
  const label = row.kind === "refund" ? statusChipLabel(row.refund_status === "paid" ? "refunded" : "refund_owed") : rowStatusLabel({ ...row, status_key: key });
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
  const [noShow, setNoShow] = useState(false);
  // Stage 2 (B.b): staff without the permission never see these buttons (the 403 message stays as the fallback).
  const { can } = useMyPermissions();
  const mayComplete = canComplete && can(PERM.recordPayments);
  // "Nahi aaye": the backend allows check_in OR record_payments (stage2-contract section 5).
  const mayNoShow = (can(PERM.checkIn) || can(PERM.recordPayments)) && canOfferNoShow(row);
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
  const disabled = !row.slot_ended || !mayComplete || yes.isPending;

  return (
    <View
      onLayout={(e) => onLayoutY?.(e.nativeEvent.layout.y)}
      testID={`booking-card-${row.booking_id}-${row.kind}`}
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
            {isStatusPending(row) ? <StatusPendingChip /> : null}
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

      {isBooked && (mayComplete || mayNoShow || row.completion) ? (
        <View className="px-4 pb-4 flex-row flex-wrap items-center gap-3">
          {mayComplete ? (
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
          ) : null}
          {mayNoShow ? (
            <Pressable
              onPress={() => setNoShow(true)}
              accessibilityRole="button"
              accessibilityLabel="Nahi aaye (No-show)"
              className="flex-row items-center justify-center rounded-xl px-3.5"
              style={{ minHeight: 48, borderWidth: 1.5, borderColor: OV.redBorder, backgroundColor: "#FFFFFF" }}
            >
              <Text className="font-plex-semibold text-[14px]" style={{ color: OV.red }}>
                Nahi aaye (No-show)
              </Text>
            </Pressable>
          ) : null}
          {!row.slot_ended && mayComplete ? (
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
            <Text testID="completion-hint" className="font-plex-medium text-owner-ink-muted text-[12.5px]">
              {row.status_key === "no_show"
                ? "Abhi No-show hai. Haan ya Nahi chunne se booking Completed ho jayegi."
                : "Khel ho gaya? Haan ya Nahi, dono se booking Completed ho jayegi."}
            </Text>
            {[
              { v: "yes", label: "Haan", sub: "Khel hua, poora paisa mil gaya" },
              { v: "no", label: "Nahi", sub: "Khel hua, kuch paisa baqi hai" },
            ].map((o) => (
              <Pressable
                key={o.v}
                onPress={() => {
                  setPicking(false);
                  if (o.v === "yes") {
                    // A no_show row with an old "yes" still needs the call: it is what makes the booking completed.
                    if (row.completion?.result !== "yes" || row.status_key === "no_show") yes.mutate();
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
      {noShow ? <NoShowSheet row={row} onClose={() => setNoShow(false)} onSaved={invalidate} /> : null}
      {adhoora ? <CompletionSheet row={row} onClose={() => setAdhoora(false)} onSaved={invalidate} /> : null}
    </View>
  );
}
