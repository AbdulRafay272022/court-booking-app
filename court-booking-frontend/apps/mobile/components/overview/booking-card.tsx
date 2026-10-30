import { useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, CircleAlert, Clock } from "lucide-react-native";
import type { OwnerBookingRow } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";
import { palette, radius, space, type Tone } from "@court-booking/ui-tokens";
import { Avatar, Button, Text } from "@/components/ui";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR, formatTimeRange } from "@/lib/format";
import { PERM, canOfferNoShow, courtNumber, durationLabel, isStatusPending, rowStatusLabel, rowTone, statusChipLabel } from "@/lib/overview";
import { useMyPermissions } from "@/lib/use-my-permissions";
import { BottomSheet, SmallChip } from "./ui";
import { CompletionSheet, NoShowSheet } from "@/components/completion-sheet";
import { NoShowReverseSheet } from "@/components/money-sheets";

/** Stage 2 (C.3): booked, slot over, not marked yet (icon + text, never colour alone). */
export function StatusPendingChip() {
  return (
    <View testID="status-pending-chip">
      <SmallChip label="Status baqi" tone="waiting" icon={<Clock size={12} color={palette.waiting} />} />
    </View>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return (
    <View style={{ flexGrow: 1, flexBasis: 64, gap: 2 }}>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <Text variant="bodyStrong" tone={tone ?? "primary"}>
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
  const tone: Tone = row.kind === "refund" ? "waiting" : row.kind === "cancelled" ? "danger" : "info";
  const label = row.kind === "refund" ? statusChipLabel(row.refund_status === "paid" ? "refunded" : "refund_owed") : rowStatusLabel(row);
  return <SmallChip label={label} tone={tone} />;
}

const CARD_TONE = {
  green: { bg: palette.openTint, border: palette.openTint },
  red: { bg: palette.dangerTint, border: palette.dangerBorder },
  amber: { bg: palette.waitingTint, border: palette.waitingTint },
  neutral: { bg: palette.white, border: palette.white },
} as const;

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
  const tone = CARD_TONE[rowTone(row)];
  const [picking, setPicking] = useState(false);
  // "Nahi" hands over to the adhoora sheet only after the picker has animated out (two @gorhom modals must not stack).
  const [pickerOpen, setPickerOpen] = useState(true);
  // a ref, not state: @gorhom may call the sheet's onDismiss through the closure from when it was presented
  const afterPick = useRef(false);
  const [adhoora, setAdhoora] = useState(false);
  const [noShow, setNoShow] = useState(false);
  // audit fixes 2026-10-31: on a no-show row "Booking completed?" opens "No-show hatayein" (price / received / method)
  const [reverse, setReverse] = useState(false);
  // Stage 2 (B.b): staff without the permission never see these buttons (the 403 message stays as the fallback).
  const { can } = useMyPermissions();
  const mayComplete = canComplete && can(PERM.recordPayments);
  // "Nahi aaye": the backend allows check_in OR record_payments (stage2-contract section 5).
  const mayNoShow = (can(PERM.checkIn) || can(PERM.recordPayments)) && canOfferNoShow(row);
  const [error, setError] = useState<string | null>(null);
  const invalidate = useInvalidateOverview();
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
      style={{
        backgroundColor: tone.bg,
        borderRadius: radius.card,
        borderWidth: highlighted ? 2.5 : 1,
        borderColor: highlighted ? palette.teal : tone.border === palette.white ? palette.line : tone.border,
      }}
    >
      <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${row.player_name ?? "Booking"}, ${row.short_code}`} style={{ padding: space[4], gap: 14 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space[3] }}>
          <Avatar name={row.player_name ?? "?"} size={44} tone={row.kind === "refund" ? "waiting" : "info"} uri={row.player_avatar_url} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong">
              {row.player_name ?? "Player"}
              {row.kind === "refund" ? " · refund" : ""}
            </Text>
            <Text variant="meta" tone="muted">
              {refundLine ?? `${formatTimeRange(row.starts_at, row.ends_at)} · ${durationLabel(row.duration_minutes)}`}
            </Text>
          </View>
          <View style={{ alignItems: "flex-end", gap: space[1] }}>
            {statusChip(row)}
            {row.checked_in ? <SmallChip label="Checked in" tone="open" /> : null}
            {isStatusPending(row) ? <StatusPendingChip /> : null}
          </View>
        </View>

        {row.kind !== "refund" ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
            <Stat label="Court" value={courtNumber(row.court_name)} />
            <Stat label="Total" value={formatPKR(row.total)} />
            <Stat label="Advance" value={formatPKR(row.advance)} />
            <Stat label="Due" value={formatPKR(row.due)} tone={row.due > 0 ? "danger" : undefined} />
          </View>
        ) : null}
      </Pressable>

      {isBooked && (mayComplete || mayNoShow || row.completion) ? (
        <View style={{ paddingHorizontal: space[4], paddingBottom: space[4], flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[3] }}>
          {mayComplete ? (
            <Pressable
              onPress={() => {
              if (row.status_key === "no_show") {
                setReverse(true);
                return;
              }
              setPickerOpen(true);
              setPicking(true);
            }}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={`Booking completed: ${current}`}
              accessibilityState={{ disabled }}
              aria-disabled={disabled}
              style={{
                minHeight: 48,
                minWidth: 130,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: space[2],
                paddingHorizontal: space[4],
                borderRadius: radius.md,
                backgroundColor: palette.white,
                borderWidth: 1.5,
                borderColor: disabled ? palette.line : palette.lineStrong,
                opacity: disabled ? 0.7 : 1,
              }}
            >
              <Text variant="bodyBold">{current}</Text>
              <ChevronDown size={18} color={palette.night} />
            </Pressable>
          ) : null}
          {mayNoShow ? <Button label="Nahi aaye (No-show)" variant="danger" size="sm" onPress={() => setNoShow(true)} style={{ minHeight: 48 }} /> : null}
          {!row.slot_ended && mayComplete ? (
            <Text variant="caption" tone="muted" align="right" style={{ flex: 1 }}>
              Slot khatam hone ke baad
            </Text>
          ) : row.completion?.result === "yes" ? (
            <SmallChip label="Mukammal" tone="open" icon={<Check size={13} color={palette.open} strokeWidth={2.6} />} />
          ) : row.completion?.result === "no" ? (
            <SmallChip label="Adhoora" tone="danger" icon={<CircleAlert size={13} color={palette.danger} />} />
          ) : null}
        </View>
      ) : null}

      {row.kind !== "booked" ? (
        <View style={{ paddingHorizontal: space[4], paddingBottom: space[4], flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
          <Text variant="meta" tone="muted">
            {row.short_code}
          </Text>
          {row.original_booking_id ? <SmallChip label="Original booking dekhein" tone="info" onPress={onOpenOriginal} /> : null}
        </View>
      ) : null}

      {error ? (
        <Text variant="meta" tone="danger" style={{ paddingHorizontal: space[4], paddingBottom: space[3] }}>
          {error}
        </Text>
      ) : null}

      {picking ? (
        <BottomSheet
          open={pickerOpen}
          title="Booking completed?"
          subtitle={`${row.player_name ?? "Player"} · ${row.short_code}`}
          onClose={() => {
            setPicking(false);
            if (afterPick.current) {
              afterPick.current = false;
              setAdhoora(true);
            }
          }}
        >
          <View style={{ gap: 10, paddingBottom: space[2] }}>
            <Text testID="completion-hint" variant="meta" tone="muted">
              {row.status_key === "no_show"
                ? "Abhi No-show hai."
                : "Khel ho gaya? Haan ya Nahi, dono se booking Completed ho jayegi."}
            </Text>
            {[
              { v: "yes", label: "Haan", sub: "Khel hua, poora paisa mil gaya" },
              { v: "no", label: "Nahi", sub: "Khel hua, kuch paisa baqi hai" },
            ].map((o) => (
              <Pressable
                key={o.v}
                onPress={() => {
                  if (o.v === "yes") {
                    setPicking(false);
                    // A no_show row with an old "yes" still needs the call: it is what makes the booking completed.
                    if (row.completion?.result !== "yes" || row.status_key === "no_show") yes.mutate();
                  } else {
                    afterPick.current = true;
                    setPickerOpen(false);
                  }
                }}
                accessibilityRole="button"
                style={{ minHeight: 56, justifyContent: "center", paddingHorizontal: space[4], paddingVertical: space[2], borderRadius: radius.md, backgroundColor: palette.ground }}
              >
                <Text variant="bodyStrong">{o.label}</Text>
                <Text variant="caption" tone="muted">
                  {o.sub}
                </Text>
              </Pressable>
            ))}
          </View>
        </BottomSheet>
      ) : null}
      {noShow ? <NoShowSheet row={row} onClose={() => setNoShow(false)} onSaved={invalidate} /> : null}
      {adhoora ? <CompletionSheet row={row} onClose={() => setAdhoora(false)} onSaved={invalidate} /> : null}
      {reverse ? (
        <NoShowReverseSheet
          target={{ bookingId: row.booking_id, subtitle: `${row.player_name ?? "Player"} · ${row.short_code}`, total: row.total, paid: row.total_paid }}
          onClose={() => setReverse(false)}
          onSaved={invalidate}
        />
      ) : null}
    </View>
  );
}

