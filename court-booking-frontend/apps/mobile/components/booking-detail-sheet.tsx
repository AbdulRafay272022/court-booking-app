import { useState } from "react";
import { ActivityIndicator, Dimensions, Image, Modal, Platform, Pressable, ScrollView, Share, Text, View } from "react-native";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { BookingTimelineEvent, OwnerBookingDetail } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";

import { api } from "@/lib/api";
import { confirmAction } from "@/lib/confirm";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR, formatTime, formatWhen, formatWhenRange, pktDateString } from "@/lib/format";
import { OV, SOURCE_LABEL, durationLabel, statusChipLabel } from "@/lib/overview";
import { CheckIcon } from "@/components/icons";
import { AlertCircleIcon, CloseIcon, CopyIcon } from "@/components/overview/icons";
import { RecordPaymentSheet } from "@/components/record-payment-sheet";
import { BottomSheet, OrangeButton, OutlineButton, SmallChip } from "@/components/overview/ui";

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
};

function timelineText(e: BookingTimelineEvent): string {
  return TIMELINE_LABEL[e.kind] ?? e.kind.replace(/_/g, " ");
}

function timelineDetail(e: BookingTimelineEvent): string {
  return [e.amount != null ? `PKR ${formatPKR(e.amount)}` : null, e.actor_name, e.note].filter(Boolean).join(" · ");
}

function Line({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View className="flex-row items-start justify-between gap-4 py-2.5 border-b border-owner-border-light">
      <Text className="font-plex-medium text-owner-ink-muted text-[13.5px]">{label}</Text>
      <Text className="font-plex-semibold text-[13.5px] flex-1 text-right" style={{ color: valueColor ?? OV.ink }}>
        {value}
      </Text>
    </View>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <Text className="font-plex-bold text-owner-ink-muted text-[11.5px] tracking-[1.2px] mt-2">{children.toUpperCase()}</Text>;
}

async function copyText(text: string): Promise<"copied" | "shared"> {
  if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return "copied";
  }
  // No clipboard module is installed (adding one needs a native build); the share sheet offers "Copy".
  await Share.share({ message: text });
  return "shared";
}

/** The shared booking detail bottom sheet (Overview, History): spec 2.6. */
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
  const [copyNote, setCopyNote] = useState<string | null>(null);
  const [proofOpen, setProofOpen] = useState(false);
  const d = query.data;
  const forbidden = query.error instanceof ApiError && query.error.status === 403;

  async function copyId() {
    try {
      const r = await copyText(bookingId);
      setCopyNote(r === "copied" ? "ID copy ho gayi" : null);
    } catch {
      setCopyNote("Copy nahi ho saka");
    }
  }

  return (
    <BottomSheet title={d ? d.row.short_code : "Booking"} onClose={onClose} tall>
      {query.isLoading ? (
        <View className="py-16 items-center">
          <ActivityIndicator color={OV.accent} />
        </View>
      ) : forbidden ? (
        <Text className="font-plex-medium text-owner-danger text-[14px] py-6">
          Aapke paas booking ki detail dekhne ki ijazat nahi hai.
        </Text>
      ) : query.isError || !d ? (
        <View className="gap-3 py-6">
          <Text className="font-plex-medium text-owner-danger text-[14px]">{friendlyErrorMessage(query.error)}</Text>
          <OutlineButton label="Dobara koshish karein" onPress={() => query.refetch()} />
        </View>
      ) : (
        <DetailBody
          d={d}
          copyNote={copyNote}
          onCopy={copyId}
          onProof={() => setProofOpen(true)}
          onOpenBooking={onOpenBooking}
          hideHistoryLink={hideHistoryLink}
          onClose={onClose}
        />
      )}
      {proofOpen && d?.payment_id ? <ProofModal paymentId={d.payment_id} onClose={() => setProofOpen(false)} /> : null}
    </BottomSheet>
  );
}

function DetailBody({
  d,
  copyNote,
  onCopy,
  onProof,
  onOpenBooking,
  hideHistoryLink,
  onClose,
}: {
  d: OwnerBookingDetail;
  copyNote: string | null;
  onCopy: () => void;
  onProof: () => void;
  onOpenBooking: (id: string) => void;
  hideHistoryLink?: boolean;
  onClose: () => void;
}) {
  const r = d.row;
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const live = r.kind === "booked" && r.status_key === "booked";
  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["owner-overview"] });
    qc.invalidateQueries({ queryKey: ["owner-history"] });
    qc.invalidateQueries({ queryKey: ["owner-booking-detail"] });
  };
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
  const slots = r.slot_count ? ` (${r.slot_count} slots)` : "";
  const completion = d.completion ?? r.completion;
  return (
    <View className="gap-1">
      <View className="flex-row flex-wrap items-center gap-2">
        <Pressable
          onPress={onCopy}
          accessibilityRole="button"
          accessibilityLabel="Poora ID copy karein"
          className="flex-row items-center gap-1.5 px-3 rounded-xl"
          style={{ minHeight: 44, borderWidth: 1.5, borderColor: OV.border }}
        >
          <CopyIcon />
          <Text className="font-plex-semibold text-owner-ink text-[13px]">Poora ID copy karein</Text>
        </Pressable>
        {copyNote ? <Text className="font-plex-medium text-owner-success text-[12.5px]">{copyNote}</Text> : null}
      </View>
      <View className="flex-row flex-wrap gap-2 mt-1">
        <SmallChip label={statusChipLabel(r.status_key)} bg={OV.accentSoft} fg={OV.accent} />
        {completion?.result === "yes" ? (
          <SmallChip label="Mukammal" bg={OV.greenBg} fg={OV.greenDark} icon={<CheckIcon size={12} color={OV.greenDark} strokeWidth={2.6} />} />
        ) : completion?.result === "no" ? (
          <SmallChip label="Adhoora" bg={OV.redBg} fg={OV.red} icon={<AlertCircleIcon size={12} />} />
        ) : null}
        {r.checked_in ? <SmallChip label="Checked in" bg={OV.greenBg} fg={OV.greenDark} /> : null}
      </View>

      {r.kind !== "booked" && r.original_booking_id ? (
        <Pressable
          onPress={() => onOpenBooking(r.original_booking_id as string)}
          accessibilityRole="button"
          className="self-start mt-2 px-3 rounded-full"
          style={{ minHeight: 40, justifyContent: "center", backgroundColor: OV.accentSoft }}
        >
          <Text className="font-plex-semibold text-owner-accent text-[13px]">Original booking dekhein</Text>
        </Pressable>
      ) : null}

      <SectionLabel>Player aur slot</SectionLabel>
      <Line label="Player" value={r.player_name ?? "-"} />
      {r.player_phone ? <Line label="Phone" value={r.player_phone} /> : null}
      <Line label="Court" value={r.court_name} />
      <Line label="Slot" value={formatWhenRange(r.starts_at, r.ends_at)} />
      <Line label="Muddat" value={`${durationLabel(r.duration_minutes)}${slots}`} />
      <Line label="Booking kab hui" value={formatWhen(d.booked_at)} />
      <Line label="Zariya" value={SOURCE_LABEL[r.source] ?? r.source} />
      {d.hold_expires_at ? <Line label="Hold khatam" value={formatWhen(d.hold_expires_at)} /> : null}

      <SectionLabel>Paisa</SectionLabel>
      <Line label="Total amount" value={`PKR ${formatPKR(r.total)}`} />
      <Line label="Advance zaroori tha" value={`PKR ${formatPKR(d.advance_required)}`} />
      <Line label="Ab tak mila" value={`PKR ${formatPKR(r.total_paid)}`} />
      <Line label="Baqi" value={`PKR ${formatPKR(r.due)}`} valueColor={r.due > 0 ? OV.red : OV.green} />
      {d.refund ? (
        <Line
          label="Refund"
          value={`PKR ${formatPKR(d.refund.amount)} (${d.refund.status === "paid" ? `bheja gaya${d.refund.paid_at ? `, ${formatWhen(d.refund.paid_at)}` : ""}` : "bhejna baqi hai"})`}
        />
      ) : null}

      {d.payment_id ? (
        <>
          <SectionLabel>Payment screenshot</SectionLabel>
          <Pressable
            onPress={onProof}
            accessibilityRole="button"
            className="items-center justify-center rounded-2xl bg-owner-bg"
            style={{ minHeight: 88, borderWidth: 1.5, borderStyle: "dashed", borderColor: OV.faint }}
          >
            <Text className="font-plex-medium text-owner-ink-muted text-[13px]">Screenshot yahan dikhega (dabane par bara)</Text>
          </Pressable>
          {d.ocr_verdict ? (
            <View className="flex-row mt-1">
              <SmallChip
                label={`${d.ocr_verdict}${d.ocr_amount != null ? `: PKR ${formatPKR(d.ocr_amount)}` : ""}`}
                bg={OV.accentSoft}
                fg={OV.accent}
              />
            </View>
          ) : null}
        </>
      ) : null}

      {d.approval?.verdict ? (
        <>
          <SectionLabel>Approval</SectionLabel>
          <Line
            label={d.approval.verdict === "approved" ? "Approve hui" : "Reject hui"}
            value={[d.approval.auto ? "Khud ba khud" : d.approval.by_name, d.approval.at ? formatWhen(d.approval.at) : null].filter(Boolean).join(" · ")}
          />
          {d.approval.reason ? <Line label="Wajah" value={d.approval.reason} /> : null}
        </>
      ) : null}

      {d.cancellation ? (
        <>
          <SectionLabel>Cancellation</SectionLabel>
          <Line
            label="Cancel kisne kiya"
            value={[{ player: "Player", owner: "Owner", system: "System" }[d.cancellation.by], d.cancellation.at ? formatWhen(d.cancellation.at) : null]
              .filter(Boolean)
              .join(" · ")}
          />
          {d.cancellation.reason ? <Line label="Wajah" value={d.cancellation.reason} /> : null}
        </>
      ) : null}

      {completion ? (
        <>
          <SectionLabel>Booking completed</SectionLabel>
          <Line
            label={completion.result === "yes" ? "Mukammal" : "Adhoora"}
            value={[completion.marked_by_name, formatWhen(completion.marked_at)].filter(Boolean).join(" · ")}
          />
          <Line label="Kitna mila" value={`PKR ${formatPKR(completion.received_pkr)}`} />
          {completion.reason ? <Line label="Wajah" value={completion.reason} /> : null}
        </>
      ) : null}

      {d.timeline.length ? (
        <>
          <SectionLabel>Waqt-nama</SectionLabel>
          <View className="gap-3 mt-1">
            {d.timeline.map((e, i) => (
              <View key={`${e.kind}-${e.at}-${i}`} className="flex-row gap-3">
                <View className="w-2.5 h-2.5 rounded-full mt-1.5" style={{ backgroundColor: e.kind === "completion_marked" ? OV.orange : OV.accent }} />
                <View className="flex-1">
                  <Text className="font-plex-semibold text-owner-ink text-[13.5px]">
                    {formatTime(e.at)}
                    <Text className="font-plex-medium">{` · ${timelineText(e)}`}</Text>
                  </Text>
                  {timelineDetail(e) ? (
                    <Text className="font-plex-medium text-owner-ink-faint text-[12.5px]">{timelineDetail(e)}</Text>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        </>
      ) : null}

      {live ? (
        <View className="gap-2 mt-3">
          <View className="flex-row gap-3">
            {!r.checked_in ? <OutlineButton flex label={busy ? "..." : "Check in"} onPress={() => run(() => api.bookings.checkin(r.booking_id))} /> : null}
            {!r.checked_in ? (
              <OutlineButton
                flex
                label="No-show"
                onPress={() =>
                  confirmAction({
                    title: "No-show mark karein?",
                    message: "Ye record hoga ke player aaya nahi.",
                    confirmLabel: "No-show",
                    destructive: true,
                    onConfirm: () => run(() => api.bookings.noShow(r.booking_id)),
                  })
                }
              />
            ) : null}
          </View>
          {r.due > 0 ? <OutlineButton label={`Payment record karein (PKR ${formatPKR(r.due)} baqi)`} onPress={() => setRecording(true)} /> : null}
          {actionError ? <Text className="font-plex-medium text-owner-danger text-[12.5px]">{actionError}</Text> : null}
        </View>
      ) : null}
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

      <Text className="font-plex-medium text-owner-ink-faint text-[12px] mt-3">
        Phone aur screenshot sirf owner aur ijazat wale staff ko nazar aate hain.
      </Text>
      <View className="flex-row gap-3 mt-2 pb-2">
        {!hideHistoryLink ? (
          <OutlineButton
            flex
            label="History mein dekhein"
            onPress={() => {
              const day = pktDateString(r.starts_at);
              onClose();
              router.push({ pathname: "/(owner)/history", params: { from: day, to: day, booking: r.booking_id } });
            }}
          />
        ) : null}
        <OrangeButton flex label="Band karein" onPress={onClose} />
      </View>
    </View>
  );
}

/** The payment screenshot via the existing short-lived signed URL. The URL lives only in component state while open. */
function ProofModal({ paymentId, onClose }: { paymentId: string; onClose: () => void }) {
  const query = useQuery({
    queryKey: ["owner-proof-url", paymentId],
    queryFn: () => api.payments.proofUrl(paymentId),
    gcTime: 0,
    staleTime: 0,
  });
  const { width, height } = Dimensions.get("window");
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1" style={{ backgroundColor: "rgba(0,0,0,0.92)" }}>
        <Pressable
          onPress={onClose}
          accessibilityLabel="Close"
          accessibilityRole="button"
          className="absolute right-4 top-12 z-10 w-11 h-11 rounded-xl items-center justify-center"
          style={{ backgroundColor: "rgba(255,255,255,0.18)" }}
        >
          <CloseIcon color="#FFFFFF" />
        </Pressable>
        {query.isLoading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color="#FFFFFF" />
          </View>
        ) : query.isError || !query.data ? (
          <View className="flex-1 items-center justify-center px-8">
            <Text className="font-plex-medium text-white text-[14px] text-center">{friendlyErrorMessage(query.error)}</Text>
          </View>
        ) : (
          <ScrollView
            maximumZoomScale={4}
            minimumZoomScale={1}
            centerContent
            contentContainerStyle={{ alignItems: "center", justifyContent: "center", minHeight: height }}
          >
            <Image source={{ uri: query.data.url }} style={{ width, height: height * 0.8 }} resizeMode="contain" accessibilityLabel="Payment screenshot" />
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}
