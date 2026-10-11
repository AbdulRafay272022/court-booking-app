import { useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { cancellationPolicyText } from "@court-booking/api-client";
import { startsInText, statusGroup, type Booking, type BookingStatus, type Review, type StatusGroup } from "@court-booking/types";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatDate, formatPKR, formatTimeRange } from "@/lib/format";
import { courtLabel } from "@/components/court-label";
import { BanIcon, CheckIcon, ClockIcon, StarIcon, XIcon } from "@/components/icons";

const SEVEN_DAYS_MS = 7 * 24 * 3_600_000;

/* ---------- status ---------- */

type IconName = "check" | "clock" | "x" | "ban";

// Every status gets a coloured icon matching its label colour; no_show's icon (circle + slash) is deliberately
// distinct from cancelled's X.
export const STATUS_META: Record<BookingStatus, { label: string; icon: IconName }> = {
  held: { label: "Holding your slot", icon: "clock" },
  payment_submitted: { label: "Waiting for approval", icon: "clock" },
  booked: { label: "Confirmed", icon: "check" },
  completed: { label: "Completed", icon: "check" },
  no_show: { label: "No-show", icon: "ban" },
  cancelled: { label: "Cancelled", icon: "x" },
};

export const GROUP_STYLE: Record<StatusGroup, { bg: string; fg: string; border: string; strip: string }> = {
  confirmed: { bg: "#E4F0EA", fg: "#14563A", border: "#A9CFBD", strip: "#1F7A52" },
  pending: { bg: "#FDF6E9", fg: "#8A5A0A", border: "#F0DFBC", strip: "#E2A93B" },
  completed: { bg: "#F4EFEC", fg: "#5C544D", border: "#E5DED8", strip: "#9A9791" },
  cancelled: { bg: "#F8E5E0", fg: "#A8432C", border: "#DDBAB1", strip: "#A8432C" },
};

function StatusIcon({ name, color }: { name: IconName; color: string }) {
  if (name === "check") return <CheckIcon size={13} color={color} strokeWidth={2.6} />;
  if (name === "clock") return <ClockIcon size={13} color={color} />;
  if (name === "x") return <XIcon size={13} color={color} />;
  return <BanIcon size={13} color={color} />;
}

export function StatusPill({ status, dark = false }: { status: BookingStatus; dark?: boolean }) {
  const meta = STATUS_META[status];
  const g = GROUP_STYLE[statusGroup(status)];
  const fg = dark ? "#FFFFFF" : g.fg;
  return (
    <View
      className="self-start flex-row items-center gap-1.5 rounded-full border px-2.5 py-1"
      style={{ backgroundColor: dark ? "rgba(255,255,255,0.12)" : g.bg, borderColor: dark ? "rgba(255,255,255,0.25)" : g.border }}
      accessibilityLabel={`Status: ${meta.label}`}
    >
      <StatusIcon name={meta.icon} color={fg} />
      <Text className="font-figtree-bold text-[12px]" style={{ color: fg }}>
        {meta.label}
      </Text>
    </View>
  );
}

/* ---------- shared behaviour ---------- */

/** Court, venue and what the player may do with this booking. Same rules the old My bookings cards used. */
function useBookingView(booking: Booking, onChanged: () => void) {
  const courtQuery = useQuery({ queryKey: ["court", booking.court_id], queryFn: () => api.courts.get(booking.court_id) });
  const venueQuery = useQuery({
    queryKey: ["venue", courtQuery.data?.venue_id],
    queryFn: () => api.venues.get(courtQuery.data!.venue_id),
    enabled: !!courtQuery.data?.venue_id,
  });
  const [cancelling, setCancelling] = useState(false);
  const court = courtQuery.data;
  const canResumePay = booking.status === "held" || booking.status === "payment_submitted";

  // A paid (booked) booking is only cancellable if this specific court's policy allows it -- and, if it has a cutoff,
  // only while enough time remains before start. A cutoff only ever gets MORE restrictive as start approaches, so this
  // can't go stale; the server re-checks at cancel time regardless (this is a UX convenience, not the source of truth).
  const withinCutoff =
    court?.cancellation_cutoff_hours != null && new Date(booking.starts_at).getTime() - Date.now() < court.cancellation_cutoff_hours * 3_600_000;
  const canCancelBooked = booking.status === "booked" && !!court?.cancellation_allowed && !withinCutoff;
  const canCancel = canResumePay || canCancelBooked;
  const bookedNotCancellable = booking.status === "booked" && !canCancelBooked && !!court;
  const policyNote = bookedNotCancellable ? (withinCutoff ? "The cancellation window for this booking has closed." : cancellationPolicyText(court)) : null;

  function handleCancel() {
    const isPaid = booking.status === "booked";
    // The refundable amount is shown BEFORE confirming, in plain words. A cancel that is allowed to go through is
    // always fully refundable: the cutoff blocks the cancel outright instead of allowing a reduced refund.
    Alert.alert(
      "Cancel this booking?",
      isPaid
        ? `You paid PKR ${formatPKR(booking.amount_paid)} -- the venue owes you that amount back. Refunds are sent manually by the venue (JazzCash/bank), not automatically through the app.`
        : "This can't be undone.",
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Cancel booking",
          style: "destructive",
          onPress: async () => {
            setCancelling(true);
            try {
              await api.bookings.cancel(booking.id);
              if (isPaid) {
                Alert.alert(
                  "Booking cancelled",
                  `A refund of PKR ${formatPKR(booking.amount_paid)} has been recorded for this venue to send you -- refunds are handled manually and aren't automatic.`,
                );
              }
              onChanged();
            } catch (e) {
              Alert.alert("Couldn't cancel", friendlyErrorMessage(e));
            } finally {
              setCancelling(false);
            }
          },
        },
      ],
    );
  }

  return {
    court,
    venueName: venueQuery.data?.name,
    canResumePay,
    canCancel,
    cancelling,
    policyNote,
    handleCancel,
    goPay: () => router.push({ pathname: "/(player)/booking/[id]/pay", params: { id: booking.id } }),
    goCheckin: () => router.push({ pathname: "/(player)/booking/[id]/checkin", params: { id: booking.id } }),
  };
}

function courtLine(court: ReturnType<typeof useBookingView>["court"]): string {
  return court?.name ? `${courtLabel(court.name, court.sport)} · ` : "";
}

/* ---------- rate a game ---------- */

/** "Rate your game" on a completed booking -- create, or edit within 7 days. */
function RateGame({ booking, review, onSaved }: { booking: Booking; review: Review | null; onSaved: () => void }) {
  const editable = review == null || Date.now() - new Date(review.created_at).getTime() <= SEVEN_DAYS_MS;
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(review?.rating ?? 0);
  const [comment, setComment] = useState(review?.comment ?? "");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (rating < 1) {
      Alert.alert("Pick a rating", "Tap the stars to rate your game (1 to 5).");
      return;
    }
    setSaving(true);
    try {
      if (review) await api.reviews.edit(review.id, { rating, comment: comment.trim() || undefined });
      else await api.reviews.create({ booking_id: booking.id, rating, comment: comment.trim() || undefined });
      setOpen(false);
      onSaved();
    } catch (e) {
      Alert.alert("Couldn't save your review", friendlyErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  // Collapsed: show the existing rating (if any) + a button to rate/edit.
  if (!open) {
    return (
      <View className="pt-3 border-t border-player-border-light gap-2">
        {review ? (
          <View className="flex-row items-center gap-2">
            <View className="flex-row" accessibilityLabel={`Your rating: ${review.rating} of 5`}>
              {[1, 2, 3, 4, 5].map((n) => (
                <StarIcon key={n} size={15} color={n <= review.rating ? "#EF5A2C" : "#E5DED8"} />
              ))}
            </View>
            <Text className="font-figtree-medium text-player-ink-faint text-[12px]">Your review</Text>
          </View>
        ) : (
          <Text className="font-figtree-semibold text-player-ink text-[13px]">How was your game?</Text>
        )}
        {editable ? (
          <Pressable
            accessibilityLabel={review ? "Edit your review" : "Rate your game"}
            onPress={() => setOpen(true)}
            className="self-start px-3.5 h-9 rounded-full items-center justify-center bg-player-accent active:opacity-80"
          >
            <Text className="font-figtree-bold text-white text-[12.5px]">{review ? "Edit review" : "Rate your game"}</Text>
          </Pressable>
        ) : (
          <Text className="font-figtree-medium text-player-ink-faint text-[11.5px]">Reviews can be edited within 7 days of posting.</Text>
        )}
      </View>
    );
  }

  return (
    <View className="pt-3 border-t border-player-border-light gap-2.5">
      <Text className="font-figtree-semibold text-player-ink text-[13px]">Rate your game</Text>
      <View className="flex-row gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable key={n} accessibilityLabel={`${n} star${n > 1 ? "s" : ""}`} onPress={() => setRating(n)} hitSlop={6}>
            <StarIcon size={30} color={n <= rating ? "#EF5A2C" : "#E5DED8"} />
          </Pressable>
        ))}
      </View>
      <TextInput
        value={comment}
        onChangeText={setComment}
        placeholder="Add a comment (optional)"
        placeholderTextColor="#9A9791"
        multiline
        className="min-h-[64px] border border-player-border-light rounded-[12px] p-3 font-figtree-medium text-player-ink text-[13.5px]"
        style={{ textAlignVertical: "top" }}
      />
      <View className="flex-row gap-2.5">
        <Pressable onPress={() => setOpen(false)} className="flex-1 h-11 rounded-full border border-player-border-light items-center justify-center active:opacity-70">
          <Text className="font-figtree-semibold text-player-ink text-[13px]">Cancel</Text>
        </Pressable>
        <Pressable
          onPress={submit}
          disabled={saving}
          className="flex-1 h-11 rounded-full items-center justify-center bg-player-accent active:opacity-80"
          style={{ opacity: saving ? 0.6 : 1 }}
        >
          <Text className="font-figtree-bold text-white text-[13px]">{saving ? "Saving…" : review ? "Save changes" : "Submit review"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/* ---------- cards ---------- */

/** One booking in the Upcoming / Past lists. */
export function BookingCard({ booking, review, onChanged }: { booking: Booking; review?: Review | null; onChanged: () => void }) {
  const v = useBookingView(booking, onChanged);
  const group = statusGroup(booking.status);
  const g = GROUP_STYLE[group];
  const dateParts = formatDate(booking.starts_at).match(/^(\w+), (\d+) (\w+)/);

  return (
    <Pressable
      onPress={() => v.canResumePay && v.goPay()}
      accessibilityLabel={`Booking at ${v.venueName ?? "venue"}, ${STATUS_META[booking.status].label}`}
      className="flex-row overflow-hidden rounded-[20px] border border-player-border-light bg-player-surface"
      style={{ opacity: group === "cancelled" ? 0.85 : 1 }}
    >
      <View style={{ width: 6, backgroundColor: g.strip }} />
      <View className="flex-1 p-4 gap-3.5">
        <View className="flex-row items-start gap-3.5">
          <View className="w-14 h-14 rounded-xl bg-player-accent-soft items-center justify-center">
            {dateParts ? (
              <>
                <Text className="font-figtree-bold text-[10.5px] tracking-[0.08em] uppercase" style={{ color: "#C8431C" }}>
                  {dateParts[1]}
                </Text>
                <Text className="font-figtree-extrabold text-[22px] leading-[24px]" style={{ color: "#C8431C" }}>
                  {dateParts[2]}
                </Text>
                <Text className="font-figtree-bold text-[10.5px] tracking-[0.08em] uppercase" style={{ color: "#C8431C" }}>
                  {dateParts[3]}
                </Text>
              </>
            ) : null}
          </View>
          <View className="flex-1 gap-1">
            <Text className="font-figtree-extrabold text-player-ink text-[17px] -tracking-[0.2px]" numberOfLines={1}>
              {v.venueName ?? "…"}
            </Text>
            <Text className="font-figtree-medium text-player-ink-faint text-[13px]">
              {courtLine(v.court)}
              {formatDate(booking.starts_at)} · {formatTimeRange(booking.starts_at, booking.ends_at)}
            </Text>
            <View className="mt-1">
              <StatusPill status={booking.status} />
            </View>
          </View>
        </View>

        <View className="flex-row gap-8 pt-3.5 border-t border-player-border-light">
          <View className="gap-0.5">
            <Text className="font-figtree-bold text-player-ink-fainter text-[10.5px] tracking-[0.1em]">PAID</Text>
            <Text className="font-mono-semibold text-player-ink text-[14.5px]">PKR {formatPKR(booking.amount_paid)}</Text>
          </View>
          {booking.balance_due > 0 ? (
            <View className="gap-0.5">
              <Text className="font-figtree-bold text-player-ink-fainter text-[10.5px] tracking-[0.1em]">AT THE VENUE</Text>
              <Text className="font-mono-semibold text-[14.5px]" style={{ color: "#8A5A0A" }}>
                PKR {formatPKR(booking.balance_due)}
              </Text>
            </View>
          ) : null}
        </View>

        <View className="flex-row flex-wrap items-center gap-x-4 gap-y-2">
          {v.canResumePay ? (
            <Pressable onPress={v.goPay} className="h-10 px-4 rounded-lg bg-player-accent items-center justify-center active:opacity-80">
              <Text className="font-figtree-bold text-white text-[13px]">{booking.status === "held" ? "Complete payment" : "View payment"}</Text>
            </Pressable>
          ) : null}
          {booking.status === "booked" ? (
            <Pressable onPress={v.goCheckin} className="h-10 px-4 rounded-lg border border-player-border items-center justify-center active:opacity-70">
              <Text className="font-figtree-bold text-[13px]" style={{ color: "#0E6274" }}>
                Check in
              </Text>
            </Pressable>
          ) : null}
          {v.canCancel ? (
            <Pressable onPress={v.handleCancel} disabled={v.cancelling} className="min-h-11 justify-center active:opacity-70">
              <Text className="font-figtree-semibold text-[13px]" style={{ color: "#A8432C" }}>
                {v.cancelling ? "Cancelling…" : "Cancel booking"}
              </Text>
            </Pressable>
          ) : null}
        </View>
        {v.policyNote ? <Text className="font-figtree-medium text-player-ink-fainter text-[12px]">{v.policyNote}</Text> : null}
        {booking.status === "completed" ? <RateGame booking={booking} review={review ?? null} onSaved={onChanged} /> : null}
      </View>
    </Pressable>
  );
}

/** The featured card at the top of the dashboard: the player's next active booking. */
export function NextBookingCard({ booking, onChanged }: { booking: Booking; onChanged: () => void }) {
  const v = useBookingView(booking, onChanged);

  return (
    <View
      className="overflow-hidden rounded-[24px] p-5 gap-4"
      style={{ backgroundColor: "#141A1D" }}
      accessibilityLabel="Your next booking"
    >
      <View
        pointerEvents="none"
        style={{ position: "absolute", right: -60, top: -60, width: 180, height: 180, borderRadius: 90, backgroundColor: "rgba(239,90,44,0.22)" }}
      />
      <View className="flex-row flex-wrap items-center gap-2.5">
        <Text className="font-figtree-bold text-[11.5px] tracking-[0.16em]" style={{ color: "#EF5A2C" }}>
          NEXT UP
        </Text>
        <View className="rounded-full px-3 py-1" style={{ backgroundColor: "#EF5A2C" }}>
          <Text className="font-figtree-bold text-white text-[12.5px]" accessibilityLabel="Starts in">
            {startsInText(booking.starts_at, booking.ends_at)}
          </Text>
        </View>
        <StatusPill status={booking.status} dark />
      </View>
      <View className="gap-1">
        <Text className="font-figtree-extrabold text-white text-[24px] leading-[28px] -tracking-[0.4px]">{v.venueName ?? "…"}</Text>
        <Text className="font-figtree-medium text-[14.5px]" style={{ color: "rgba(255,255,255,0.7)" }}>
          {courtLine(v.court)}
          {formatDate(booking.starts_at)} · {formatTimeRange(booking.starts_at, booking.ends_at)}
        </Text>
      </View>
      {booking.balance_due > 0 ? (
        <Text className="font-figtree-medium text-[13.5px]" style={{ color: "rgba(255,255,255,0.7)" }}>
          Bring <Text className="font-mono-semibold text-white">PKR {formatPKR(booking.balance_due)}</Text> to pay at the venue.
        </Text>
      ) : null}
      <View className="flex-row flex-wrap items-center gap-3">
        {v.canResumePay ? (
          <Pressable
            onPress={v.goPay}
            className="h-12 px-5 rounded-xl items-center justify-center active:opacity-80"
            style={{ backgroundColor: "#EF5A2C", shadowColor: "#EF5A2C", shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 5 }}
          >
            <Text className="font-figtree-bold text-white text-[14px]">{booking.status === "held" ? "Complete payment" : "View payment"}</Text>
          </Pressable>
        ) : null}
        {booking.status === "booked" ? (
          <Pressable onPress={v.goCheckin} className="h-12 px-5 rounded-xl bg-white items-center justify-center active:opacity-80">
            <Text className="font-figtree-bold text-player-ink text-[14px]">Check in</Text>
          </Pressable>
        ) : null}
        {v.canCancel ? (
          <Pressable onPress={v.handleCancel} disabled={v.cancelling} className="px-2 h-12 justify-center active:opacity-70">
            <Text className="font-figtree-semibold text-[13.5px]" style={{ color: "rgba(255,255,255,0.7)" }}>
              {v.cancelling ? "Cancelling…" : "Cancel booking"}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {v.policyNote ? (
        <Text className="font-figtree-medium text-[12.5px]" style={{ color: "rgba(255,255,255,0.5)" }}>
          {v.policyNote}
        </Text>
      ) : null}
    </View>
  );
}
