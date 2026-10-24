import { useState } from "react";
import { Pressable, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CircleAlert, Copy } from "lucide-react-native";
import { CHANNEL_HEADING, bookingChannelLabel, type BookingTimelineEvent, type OwnerBookingDetail } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";
import { palette, radius, size, space } from "@court-booking/ui-tokens";
import { Button, Skeleton, Text, haptic } from "@/components/ui";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR, formatTime, formatWhen, formatWhenRange } from "@/lib/format";
import { PERM, SOURCE_LABEL, canOfferNoShow, durationLabel, isStatusPending, rowStatusLabel } from "@/lib/overview";
import { invalidateOwnerMoney } from "@/lib/owner-cache";
import { settleAction } from "@/lib/owner-floodlight";
import { useFeatureFlags } from "@/lib/use-feature-flags";
import { useMyPermissions } from "@/lib/use-my-permissions";
import { openInHistory } from "@/components/booking-links";
import { ScreenshotThumb } from "@/components/screenshot-viewer";
import { RecordPaymentSheet } from "@/components/record-payment-sheet";
import { CompletionSheet, NoShowSheet } from "@/components/completion-sheet";
import { StatusPendingChip } from "@/components/overview/booking-card";
import { BottomSheet, OutlineButton, SmallChip } from "@/components/overview/ui";
import { KeyValue, KeyValueBlock } from "@/app/(owner)/_fl";

const TIMELINE_LABEL: Record<string, string> = {
  held: "Slot hold kiya",
  proof_submitted: "Advance screenshot bheja",
  approved: "Owner ne approve kiya",
  rejected: "Screenshot reject hua",
  cancelled: "Booking cancel hui",
  refund_owed: "Refund bhejna hai",
  refunded: "Refund bhej diya gaya",
  checked_in: "Check-in hua",
  no_show: "No-show mark hua",
  slot_started: "Slot chala",
  completion_marked: "Booking completed mark hui",
  expired: "Hold khatam ho gaya",
  balance_received: "Baqi se paisa mila",
};

function timelineText(e: BookingTimelineEvent): string {
  // Round 2 (A8): "Baqi se PKR X mila" (who/when is in the detail line and the time).
  if (e.kind === "balance_received" && e.amount != null) return `Baqi se PKR ${formatPKR(e.amount)} mila`;
  return TIMELINE_LABEL[e.kind] ?? e.kind.replace(/_/g, " ");
}

function timelineDetail(e: BookingTimelineEvent): string {
  const amount = e.amount != null && e.kind !== "balance_received" ? `PKR ${formatPKR(e.amount)}` : null;
  return [amount, e.actor_name, e.note].filter(Boolean).join(" - ");
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Text variant="eyebrow" tone="muted" style={{ letterSpacing: 1.2, marginTop: space[2] }}>
      {children.toUpperCase()}
    </Text>
  );
}

/** Total / Mila / Baqi tiles (OSheets frame 1), straight from the overview-detail row. Baqi is amber while money is owed. */
function MoneyTiles({ total, paid, due }: { total: number; paid: number; due: number }) {
  const tiles = [
    { label: "Total", value: formatPKR(total), warn: false },
    { label: "Mila", value: formatPKR(paid), warn: false },
    { label: "Baqi", value: formatPKR(due), warn: due > 0 },
  ];
  return (
    <View testID="detail-money" style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
      {tiles.map((t) => (
        <View key={t.label} style={{ flexGrow: 1, flexBasis: 90, backgroundColor: t.warn ? palette.waitingTint : palette.ground, borderRadius: radius.input, paddingHorizontal: space[3], paddingVertical: 10, gap: 2 }}>
          <Text variant="caption" tone={t.warn ? "waiting" : "muted"}>
            {t.label}
          </Text>
          <Text variant="bodyStrong" tone={t.warn ? "waiting" : "primary"}>{`PKR ${t.value}`}</Text>
        </View>
      ))}
    </View>
  );
}

/** The shared booking detail bottom sheet (Overview, History, Approvals, Refunds): OSheets frame 1. */
export function BookingDetailSheet({
  bookingId,
  onClose,
  onOpenBooking,
  hideHistoryLink,
}: {
  bookingId: string;
  onClose: () => void;
  onOpenBooking: (id: string) => void;
  hideHistoryLink?: boolean;
}) {
  const query = useQuery({
    queryKey: ["owner-booking-detail", bookingId],
    queryFn: () => api.owners.bookingDetail(bookingId),
    // A different booking's data must never flash while this one loads.
    placeholderData: undefined,
  });
  const d = query.data;
  const forbidden = query.error instanceof ApiError && query.error.status === 403;

  return (
    <BottomSheet title={d ? d.row.short_code : "Booking"} subtitle="Booking ID" onClose={onClose} testID="booking-detail-sheet">
      {query.isLoading ? (
        <View style={{ gap: space[3] }} accessibilityLabel="Loading">
          <Skeleton height={44} r={radius.md} />
          <Skeleton height={180} r={18} />
          <Skeleton height={60} r={radius.input} />
        </View>
      ) : forbidden ? (
        <Text variant="body" tone="danger">
          Aapke paas booking ki detail dekhne ki ijazat nahi hai.
        </Text>
      ) : query.isError || !d ? (
        <View style={{ gap: space[3] }}>
          <Text variant="body" tone="danger">
            {friendlyErrorMessage(query.error)}
          </Text>
          <OutlineButton label="Dobara koshish karein" onPress={() => query.refetch()} />
        </View>
      ) : (
        <DetailBody d={d} bookingId={bookingId} onOpenBooking={onOpenBooking} hideHistoryLink={hideHistoryLink} onClose={onClose} />
      )}
    </BottomSheet>
  );
}

function DetailBody({
  d,
  bookingId,
  onOpenBooking,
  hideHistoryLink,
  onClose,
}: {
  d: OwnerBookingDetail;
  bookingId: string;
  onOpenBooking: (id: string) => void;
  hideHistoryLink?: boolean;
  onClose: () => void;
}) {
  const r = d.row;
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [noShow, setNoShow] = useState(false);
  const [short, setShort] = useState(false);
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);
  const live = r.kind === "booked" && r.status_key === "booked";
  // Stage 2 (B.b): buttons this staff member may not use are not shown at all (a 403 still shows its message).
  const { can } = useMyPermissions();
  const flags = useFeatureFlags();
  const refreshAll = () => void invalidateOwnerMoney(qc);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      refreshAll();
    } catch (e) {
      setActionError(friendlyErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function copyId() {
    try {
      // The FULL booking id (the short KH- code cannot be looked up anywhere: contract B2).
      await Clipboard.setStringAsync(bookingId);
      haptic("success");
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
  }
  const settle = useMutation({
    mutationFn: () => api.owners.markCompletion(r.booking_id, { result: "yes" }),
    onSuccess: () => {
      setActionError(null);
      refreshAll();
    },
    onError: (e) =>
      setActionError(
        e instanceof ApiError && e.code === "COMPLETION_TOO_EARLY"
          ? "Slot abhi khatam nahi hua. Khatam hone ke baad \"Baqi mil gaye\" dabayein."
          : e instanceof ApiError && e.status === 403
            ? "Aapke paas payments record karne ki ijazat nahi hai."
            : friendlyErrorMessage(e),
      ),
  });
  const slots = r.slot_count ? ` (${r.slot_count} slots)` : "";
  const completion = d.completion ?? r.completion;
  const mayCheckIn = can(PERM.checkIn) && !r.checked_in && !completion;
  // Stage 2 (C.3): only after the slot ended, never on a booking already marked.
  // The backend allows "Nahi aaye" for check_in OR record_payments (stage2-contract section 5).
  const mayNoShow = (can(PERM.checkIn) || can(PERM.recordPayments)) && canOfferNoShow(r, completion);
  const action = settleAction({ ...r, completion }, { canRecord: can(PERM.recordPayments), splitPayments: flags.on("split_payments") });
  const ocrMatch = d.ocr_verdict === "match";

  return (
    <View style={{ gap: space[3] }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[2] }}>
        <SmallChip label={rowStatusLabel({ ...r, completion })} tone="info" />
        {isStatusPending(r) ? <StatusPendingChip /> : null}
        {completion?.result === "yes" ? (
          <SmallChip label="Mukammal" tone="open" icon={<Check size={12} color={palette.open} strokeWidth={2.6} />} />
        ) : completion?.result === "no" ? (
          <SmallChip label="Adhoora" tone="danger" icon={<CircleAlert size={12} color={palette.danger} />} />
        ) : null}
        {r.checked_in ? <SmallChip label="Checked in" tone="open" /> : null}
        {ocrMatch ? <SmallChip label="✓ Amount match" tone="open" /> : null}
        <Pressable
          onPress={copyId}
          accessibilityRole="button"
          accessibilityLabel={copied === "ok" ? "Poora ID copy ho gaya" : "Poora ID copy karein"}
          testID="detail-copy-id"
          style={{ minHeight: size.tap, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: space[3], borderRadius: radius.pill, borderWidth: 1.5, borderColor: palette.lineStrong, backgroundColor: palette.white }}
        >
          {copied === "ok" ? <Check size={15} color={palette.teal} strokeWidth={2.8} /> : <Copy size={15} color={palette.night} />}
          <Text variant="label">{copied === "ok" ? "Copy ho gaya" : copied === "fail" ? "Copy nahi hua" : "ID copy"}</Text>
        </Pressable>
      </View>

      {r.kind !== "booked" && r.original_booking_id ? <SmallChip label="Original booking dekhein" tone="info" onPress={() => onOpenBooking(r.original_booking_id as string)} /> : null}

      <KeyValueBlock>
        <KeyValue label="Player" value={r.player_name ?? "-"} />
        {r.player_phone ? <KeyValue label="Phone" value={r.player_phone} /> : null}
        <KeyValue label="Court" value={r.court_name} />
        <KeyValue label="Slot" value={formatWhenRange(r.starts_at, r.ends_at)} />
        <KeyValue label="Muddat" value={`${durationLabel(r.duration_minutes)}${slots}`} />
        <KeyValue label="Booking kab hui" value={formatWhen(d.booked_at)} />
        <KeyValue label={CHANNEL_HEADING.ru} value={bookingChannelLabel(r.source, d.channel_detail, "ru") ?? SOURCE_LABEL[r.source] ?? r.source} last={!d.hold_expires_at} />
        {d.hold_expires_at ? <KeyValue label="Hold khatam" value={formatWhen(d.hold_expires_at)} last /> : null}
      </KeyValueBlock>

      <MoneyTiles total={r.total} paid={r.total_paid} due={r.due} />
      <Text variant="caption" tone="muted">{`Advance zaroori tha: PKR ${formatPKR(d.advance_required)}`}</Text>
      {d.refund ? (
        <KeyValueBlock>
          <KeyValue
            label="Refund"
            value={`PKR ${formatPKR(d.refund.amount)} (${d.refund.status === "paid" ? `bheja gaya${d.refund.paid_at ? `, ${formatWhen(d.refund.paid_at)}` : ""}` : "bhejna baqi hai"})`}
            last
          />
        </KeyValueBlock>
      ) : null}

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[3], alignItems: "flex-start" }}>
        {d.payment_id ? (
          <View style={{ gap: space[1] }}>
            <ScreenshotThumb compact paymentId={d.payment_id} alt={`${r.player_name ?? "Player"} ka screenshot`} />
            {d.ocr_verdict && !ocrMatch ? <SmallChip label={`${d.ocr_verdict}${d.ocr_amount != null ? `: PKR ${formatPKR(d.ocr_amount)}` : ""}`} tone="waiting" /> : null}
          </View>
        ) : null}
        {d.timeline.length ? (
          <View style={{ flex: 1, minWidth: 180, gap: 10 }}>
            <Text variant="bodyBold">Waqt-nama</Text>
            {d.timeline.map((e, i) => (
              <View key={`${e.kind}-${e.at}-${i}`} style={{ flexDirection: "row", gap: space[2] }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, marginTop: 5, backgroundColor: e.kind === "slot_started" ? palette.lineStrong : palette.teal }} />
                <View style={{ flex: 1 }}>
                  <Text variant="meta">
                    <Text variant="meta" weight="black">
                      {formatTime(e.at)}
                    </Text>
                    {` · ${timelineText(e)}`}
                  </Text>
                  {timelineDetail(e) ? (
                    <Text variant="caption" tone="muted">
                      {timelineDetail(e)}
                    </Text>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      {d.approval?.verdict ? (
        <>
          <SectionLabel>Approval</SectionLabel>
          <KeyValueBlock>
            <KeyValue
              label={d.approval.verdict === "approved" ? "Approve hui" : "Reject hui"}
              value={[d.approval.auto ? "Khud ba khud" : d.approval.by_name, d.approval.at ? formatWhen(d.approval.at) : null].filter(Boolean).join(" · ")}
              last={!d.approval.reason}
            />
            {d.approval.reason ? <KeyValue label="Wajah" value={d.approval.reason} last /> : null}
          </KeyValueBlock>
        </>
      ) : null}

      {d.cancellation ? (
        <>
          <SectionLabel>Cancellation</SectionLabel>
          <KeyValueBlock>
            <KeyValue
              label="Cancel kisne kiya"
              value={[{ player: "Player", owner: "Owner", system: "System" }[d.cancellation.by], d.cancellation.at ? formatWhen(d.cancellation.at) : null].filter(Boolean).join(" · ")}
              last={!d.cancellation.reason}
            />
            {d.cancellation.reason ? <KeyValue label="Wajah" value={d.cancellation.reason} last /> : null}
          </KeyValueBlock>
        </>
      ) : null}

      {completion ? (
        <>
          <SectionLabel>Booking completed</SectionLabel>
          <KeyValueBlock>
            <KeyValue label={completion.result === "yes" ? "Mukammal" : "Adhoora"} value={[completion.marked_by_name, formatWhen(completion.marked_at)].filter(Boolean).join(" · ")} />
            <KeyValue label="Kitna mila" value={`PKR ${formatPKR(completion.received_pkr)}`} last={!completion.reason} />
            {completion.reason ? <KeyValue label="Wajah" value={completion.reason} last /> : null}
          </KeyValueBlock>
        </>
      ) : null}

      {(live || r.status_key === "no_show") && (mayCheckIn || mayNoShow || action !== "none" || actionError) ? (
        <View testID="detail-actions" style={{ gap: space[2], backgroundColor: palette.ground, borderRadius: radius.tile, padding: space[3] }}>
          {action === "completion" ? (
            <Button
              label={r.due > 0 ? `Baqi PKR ${formatPKR(r.due)} mil gaye` : "Mukammal mark karein"}
              block
              size="md"
              loading={settle.isPending}
              onPress={() => settle.mutate()}
              testID="detail-settle"
            />
          ) : null}
          {action === "record" ? <Button label={`Payment record karein (PKR ${formatPKR(r.due)} baqi)`} variant="soft" block size="md" onPress={() => setRecording(true)} /> : null}
          {action === "wait" ? (
            <Text variant="meta" tone="muted">{`Baqi PKR ${formatPKR(r.due)}: slot khatam hone ke baad "Baqi mil gaye" ya "Kam mila" yahin se mark karein.`}</Text>
          ) : null}
          {action === "completion" || mayNoShow || mayCheckIn ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
              {action === "completion" && r.due > 0 ? <Button label="Kam mila" variant="soft" size="md" onPress={() => setShort(true)} style={{ flexGrow: 1 }} /> : null}
              {mayCheckIn && live ? <Button label={busy ? "Ho raha hai" : "Check in"} variant="soft" size="md" disabled={busy} onPress={() => run(() => api.bookings.checkin(r.booking_id))} style={{ flexGrow: 1 }} /> : null}
              {mayNoShow ? <Button label="Nahi aaye (No-show)" variant="danger" size="md" onPress={() => setNoShow(true)} style={{ flexGrow: 1 }} /> : null}
            </View>
          ) : null}
          {actionError ? (
            <Text variant="meta" weight="bold" tone="danger">
              {actionError}
            </Text>
          ) : null}
        </View>
      ) : null}
      {noShow ? <NoShowSheet row={r} onClose={() => setNoShow(false)} onSaved={refreshAll} /> : null}
      {short ? <CompletionSheet row={r} onClose={() => setShort(false)} onSaved={refreshAll} /> : null}
      {recording ? (
        <RecordPaymentSheet
          bookingId={r.booking_id}
          playerLabel={r.player_name ?? "Player"}
          balanceDue={r.due}
          onClose={() => setRecording(false)}
          onRecorded={() => {
            setRecording(false);
            refreshAll();
          }}
        />
      ) : null}

      <Text variant="caption" tone="subtle">
        Phone aur screenshot sirf owner aur ijazat wale staff ko nazar aate hain.
      </Text>
      <View style={{ flexDirection: "row", gap: space[3], paddingBottom: space[2] }}>
        {!hideHistoryLink ? <OutlineButton flex label="History mein dekhein" onPress={() => openInHistory(r.booking_id, r.starts_at, onClose)} /> : null}
        <OutlineButton flex label="Band karein" onPress={onClose} />
      </View>
    </View>
  );
}
