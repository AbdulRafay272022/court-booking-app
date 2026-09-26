import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { ErrorState } from "@/components/error-state";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatDate, formatPKR, formatTimeRange } from "@/lib/format";
import { BanIcon, CheckIcon, ClockIcon, StarIcon, XIcon } from "@/components/icons";
import type { Booking, BookingStatus, Review } from "@court-booking/types";
import { cancellationPolicyText } from "@court-booking/api-client";
import { EmptyState } from "../_components";

const SEVEN_DAYS_MS = 7 * 24 * 3_600_000;

// Backlog #7: every status gets a colored icon matching its label color; no_show's
// icon (circle + diagonal slash) is deliberately distinct from cancelled's X.
type StatusIconName = "check" | "clock" | "x" | "ban";
const STATUS_META: Record<BookingStatus, { label: string; tone: "confirmed" | "waiting" | "neutral" | "danger"; icon: StatusIconName }> = {
  held: { label: "HOLDING", tone: "waiting", icon: "clock" },
  payment_submitted: { label: "WAITING FOR APPROVAL", tone: "waiting", icon: "clock" },
  booked: { label: "CONFIRMED", tone: "confirmed", icon: "check" },
  completed: { label: "COMPLETED", tone: "neutral", icon: "check" },
  no_show: { label: "NO-SHOW", tone: "danger", icon: "ban" },
  cancelled: { label: "CANCELLED", tone: "danger", icon: "x" },
};

function StatusIcon({ name, color }: { name: StatusIconName; color: string }) {
  if (name === "check") return <CheckIcon size={13} color={color} strokeWidth={2.6} />;
  if (name === "clock") return <ClockIcon size={13} color={color} />;
  if (name === "x") return <XIcon size={13} color={color} />;
  return <BanIcon size={13} color={color} />;
}

function BookingCard({ booking, review, onChanged }: { booking: Booking; review?: Review | null; onChanged: () => void }) {
  const courtQuery = useQuery({ queryKey: ["court", booking.court_id], queryFn: () => api.courts.get(booking.court_id) });
  const venueQuery = useQuery({
    queryKey: ["venue", courtQuery.data?.venue_id],
    queryFn: () => api.venues.get(courtQuery.data!.venue_id),
    enabled: !!courtQuery.data?.venue_id,
  });
  const [cancelling, setCancelling] = useState(false);
  const meta = STATUS_META[booking.status];
  const isDark = booking.status === "booked" || booking.status === "completed";
  const statusColor = meta.tone === "waiting" ? "#8A5A0A" : meta.tone === "danger" ? "#A8432C" : isDark ? "#5FBF95" : "#7A7068";
  const canResumePay = booking.status === "held" || booking.status === "payment_submitted";

  // Section 29 Part C: a paid (booked) booking is only cancellable if this specific court's
  // policy allows it -- and, if it has a cutoff, only while enough time remains before start.
  // Computed client-side from the same court data already fetched for this card (a cutoff only
  // ever gets MORE restrictive as start approaches, never less, so this can't go stale the way
  // a one-shot fetch elsewhere might). The server re-checks this at cancel time regardless --
  // this is a UX convenience, not the source of truth.
  const court = courtQuery.data;
  const withinCutoff =
    court?.cancellation_cutoff_hours != null &&
    new Date(booking.starts_at).getTime() - Date.now() < court.cancellation_cutoff_hours * 3_600_000;
  const canCancelBooked = booking.status === "booked" && !!court?.cancellation_allowed && !withinCutoff;
  const canCancel = booking.status === "held" || booking.status === "payment_submitted" || canCancelBooked;
  const bookedNotCancellable = booking.status === "booked" && !canCancelBooked && !!court;

  async function handleCancel() {
    const isPaid = booking.status === "booked";
    // Section 32 Part 10: show the refundable amount BEFORE confirming, in plain words. A cancel
    // that's actually allowed to go through (canCancelBooked already gates on the cutoff/policy
    // above) is always fully refundable -- there's no partial/non-refundable-inside-the-cutoff
    // case, since the cutoff blocks the cancel outright instead of allowing a reduced refund.
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

  return (
    <Pressable
      onPress={() => canResumePay && router.push({ pathname: "/(player)/booking/[id]/pay", params: { id: booking.id } })}
      className="rounded-[20px] p-5 gap-3.5"
      style={{
        backgroundColor: isDark ? "#141A1D" : meta.tone === "waiting" ? "#FDF6E9" : "#FFFFFF",
        borderWidth: isDark ? 0 : 1,
        borderColor: meta.tone === "waiting" ? "#F0DFBC" : "#EBE5E1",
      }}
    >
      <View className="gap-1">
        <View className="flex-row items-center gap-1.5">
          <StatusIcon name={meta.icon} color={statusColor} />
          <Text className="font-figtree-bold text-[11px] tracking-[0.11em]" style={{ color: statusColor }}>
            {meta.label}
          </Text>
        </View>
        <Text className="font-figtree-bold text-[17px] -tracking-[0.2px]" style={{ color: isDark ? "#FFFFFF" : "#141A1D" }}>
          {venueQuery.data?.name ?? "…"}
        </Text>
        <Text className="font-figtree-medium text-[13px]" style={{ color: isDark ? "#9A928B" : "#7A7068" }}>
          {courtQuery.data?.name ? `${courtQuery.data.name} · ` : ""}
          {formatDate(booking.starts_at)} · {formatTimeRange(booking.starts_at, booking.ends_at)}
        </Text>
      </View>

      <View className="h-px" style={{ backgroundColor: isDark ? "#2A3238" : "#F0EBE7" }} />

      <View className="flex-row">
        <View className="flex-1 gap-0.5">
          <Text className="font-figtree-bold text-[10.5px] tracking-[0.1em]" style={{ color: isDark ? "#6E7A80" : "#9A9791" }}>
            PAID
          </Text>
          <Text className="font-mono-semibold text-[14.5px]" style={{ color: isDark ? "#FFFFFF" : "#141A1D" }}>
            {formatPKR(booking.amount_paid)}
          </Text>
        </View>
        {booking.balance_due > 0 ? (
          <View className="flex-1 gap-0.5">
            <Text className="font-figtree-bold text-[10.5px] tracking-[0.1em]" style={{ color: isDark ? "#6E7A80" : "#9A9791" }}>
              AT GATE
            </Text>
            <Text className="font-mono-semibold text-[14.5px]" style={{ color: "#F0A05C" }}>
              {formatPKR(booking.balance_due)}
            </Text>
          </View>
        ) : null}
      </View>

      {booking.status === "booked" ? (
        <Pressable
          onPress={() => router.push({ pathname: "/(player)/booking/[id]/checkin", params: { id: booking.id } })}
          className="self-start"
        >
          <Text className="font-figtree-semibold text-[13px]" style={{ color: isDark ? "#5FBF95" : "#0E6274" }}>
            Check in
          </Text>
        </Pressable>
      ) : null}

      {canCancel ? (
        <Pressable onPress={handleCancel} disabled={cancelling} className="self-start">
          <Text className="font-figtree-semibold text-[13px]" style={{ color: isDark ? "#E29B8A" : "#A8432C" }}>
            {cancelling ? "Cancelling…" : "Cancel booking"}
          </Text>
        </Pressable>
      ) : bookedNotCancellable ? (
        <Text className="font-figtree-medium text-[12px]" style={{ color: isDark ? "#6E7A80" : "#9A9791" }}>
          {withinCutoff ? "The cancellation window for this booking has closed." : cancellationPolicyText(court)}
        </Text>
      ) : null}

      {booking.status === "completed" ? <RateGame booking={booking} review={review ?? null} onSaved={onChanged} /> : null}
    </Pressable>
  );
}

/** Section 32 Part 6: "Rate your game" on a completed booking -- create, or edit within 7 days. */
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

  // Collapsed: show existing rating (if any) + a button to rate/edit.
  if (!open) {
    return (
      <View className="mt-1 pt-3 border-t border-player-border-light gap-2">
        {review ? (
          <View className="flex-row items-center gap-2">
            <View className="flex-row" accessibilityLabel={`Your rating: ${review.rating} of 5`}>
              {[1, 2, 3, 4, 5].map((n) => (
                <StarIcon key={n} size={15} color={n <= review.rating ? "#EF5A2C" : "#D8D2CB"} />
              ))}
            </View>
            <Text className="font-figtree-medium text-player-ink-faint text-[12px]">Your review</Text>
          </View>
        ) : (
          <Text className="font-figtree-semibold text-player-ink text-[13px]">How was your game?</Text>
        )}
        {editable ? (
          <Pressable accessibilityLabel={review ? "Edit your review" : "Rate your game"} onPress={() => setOpen(true)} className="self-start px-3.5 h-9 rounded-full items-center justify-center bg-player-accent">
            <Text className="font-figtree-bold text-white text-[12.5px]">{review ? "Edit review" : "Rate your game"}</Text>
          </Pressable>
        ) : (
          <Text className="font-figtree-medium text-player-ink-faint text-[11.5px]">Reviews can be edited within 7 days of posting.</Text>
        )}
      </View>
    );
  }

  return (
    <View className="mt-1 pt-3 border-t border-player-border-light gap-2.5">
      <Text className="font-figtree-semibold text-player-ink text-[13px]">Rate your game</Text>
      <View className="flex-row gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable key={n} accessibilityLabel={`${n} star${n > 1 ? "s" : ""}`} onPress={() => setRating(n)} hitSlop={6}>
            <StarIcon size={30} color={n <= rating ? "#EF5A2C" : "#D8D2CB"} />
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
        <Pressable onPress={() => setOpen(false)} className="flex-1 h-11 rounded-full border border-player-border-light items-center justify-center">
          <Text className="font-figtree-semibold text-player-ink text-[13px]">Cancel</Text>
        </Pressable>
        <Pressable onPress={submit} disabled={saving} className="flex-1 h-11 rounded-full items-center justify-center bg-player-accent" style={{ opacity: saving ? 0.6 : 1 }}>
          <Text className="font-figtree-bold text-white text-[13px]">{saving ? "Saving…" : review ? "Save changes" : "Submit review"}</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function PlayerBookingsScreen() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const query = useQuery({
    queryKey: ["bookings-mine", tab],
    queryFn: () => api.bookings.mine(tab),
  });
  // Section 32 Part 6: the player's own reviews, to show "Rate your game" vs "Edit review"
  // per completed booking. Only needed on the Past tab (that's where completed bookings live).
  const reviewsQuery = useQuery({ queryKey: ["my-reviews"], queryFn: () => api.reviews.mine(), enabled: tab === "past" });
  const reviewByBooking = new Map((reviewsQuery.data ?? []).map((r) => [r.booking_id, r]));

  const bookings = query.data ?? [];
  const refetchAll = () => {
    query.refetch();
    queryClient.invalidateQueries({ queryKey: ["my-reviews"] });
  };

  return (
    <SafeAreaView className="flex-1 bg-player-bg" edges={["top", "bottom"]}>
      <View className="px-5 pt-6.5 pb-4 bg-player-surface border-b border-player-border-light gap-4">
        <Text className="font-figtree-extrabold text-player-ink text-2xl -tracking-[0.03em]">Your bookings</Text>
        <View className="flex-row gap-2">
          {(["upcoming", "past"] as const).map((t) => (
            <Pressable
              key={t}
              onPress={() => setTab(t)}
              className="px-4 rounded-full items-center justify-center"
              style={{ minHeight: 44, backgroundColor: tab === t ? "#141A1D" : "#F4EFEC" }}
            >
              <Text className="font-figtree-bold text-[13.5px]" style={{ color: tab === t ? "#FFFFFF" : "#5C544D" }}>
                {t === "upcoming" ? "Upcoming" : "Past"}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {query.isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#EF5A2C" />
        </View>
      ) : query.isError && bookings.length === 0 ? (
        <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} tone="player" />
      ) : bookings.length === 0 ? (
        <EmptyState
          title={tab === "upcoming" ? "Nothing booked yet" : "No past bookings"}
          subtitle={tab === "upcoming" ? "Find a court and book your first slot." : "Bookings you've played show up here."}
          action={tab === "upcoming" ? { label: "Find a court", onPress: () => router.push("/(player)/search") } : undefined}
        />
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="px-5 pt-4.5 pb-8 gap-3.5">
          {bookings.map((b) => (
            <BookingCard key={b.id} booking={b} review={reviewByBooking.get(b.id)} onChanged={refetchAll} />
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
