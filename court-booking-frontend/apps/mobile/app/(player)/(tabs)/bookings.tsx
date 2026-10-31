import { useState } from "react";
import { Pressable, View } from "react-native";
import { router, useIsFocused } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Star } from "lucide-react-native";
import { countByGroup, formatTimeRange, refundPolicyShort, statusGroup, type Booking, type Review, type StatusGroup } from "@court-booking/types";
import { palette, radius, size, space, statusPill } from "@court-booking/ui-tokens";

import { Banner, Button, Card, Chip, EmptyState, ErrorState, Input, Screen, SegmentedToggle, Sheet, SkeletonCard, StatusPill, Text, useCopy, useLang, useToast } from "@/components/ui";
import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { bookingAction, shownStatus } from "@/lib/player-flow";
import { DateTile, PlayerOfflineBanner, asList, useBookingPlace } from "../_components";

type Tab = "upcoming" | "past";
type Filter = "all" | StatusGroup;
// The API caps a page at 100; a player's newest bookings come first on "past", so only the oldest could ever drop off.
const PAGE = 100;
const SEVEN_DAYS_MS = 7 * 24 * 3_600_000;

/** PBookings board frame 1: "Meri bookings", Aane wali / Purani, status filters, one card per booking with ONE action. */
export default function PlayerBookingsScreen() {
  const copy = useCopy();
  const lang = useLang();
  const queryClient = useQueryClient();
  const focused = useIsFocused();
  const [tab, setTab] = useState<Tab>("upcoming");
  const [filter, setFilter] = useState<Filter>("all");
  const [rating, setRating] = useState<{ booking: Booking; review: Review | null } | null>(null);

  const upcomingQ = useQuery({ queryKey: ["bookings-mine", "upcoming"], queryFn: () => api.bookings.mine("upcoming", 1, PAGE), subscribed: focused });
  const pastQ = useQuery({ queryKey: ["bookings-mine", "past"], queryFn: () => api.bookings.mine("past", 1, PAGE), subscribed: focused });
  const reviewsQ = useQuery({ queryKey: ["my-reviews"], queryFn: () => api.reviews.mine() });
  const reviewByBooking = new Map((reviewsQ.data ?? []).map((r) => [r.booking_id, r]));

  const query = tab === "upcoming" ? upcomingQ : pastQ;
  const list: Booking[] = asList<Booking>(query.data);
  const counts = countByGroup(list);
  const shown = filter === "all" ? list : list.filter((b) => statusGroup(b.status) === filter);
  const filters: { key: Filter; label: string }[] =
    tab === "upcoming"
      ? [
          { key: "all", label: copy("Sab", "All") },
          { key: "confirmed", label: statusPill({ status: "booked" }, lang).label },
          { key: "pending", label: copy("Baqi kaam", "Pending") },
          { key: "cancelled", label: copy("Cancel", "Cancelled") },
        ]
      : [
          { key: "all", label: copy("Sab", "All") },
          { key: "completed", label: copy("Khel liya", "Played") },
          { key: "cancelled", label: copy("Cancel", "Cancelled") },
        ];

  function refetchAll() {
    void upcomingQ.refetch();
    void pastQ.refetch();
    void queryClient.invalidateQueries({ queryKey: ["my-reviews"] });
  }

  return (
    <Screen floatingBar="tabs" refreshing={upcomingQ.isRefetching || pastQ.isRefetching} onRefresh={refetchAll} testID="bookings-screen">
      <PlayerOfflineBanner />
      <Text variant="h1" accessibilityRole="header">
        {copy("Meri bookings", "My bookings")}
      </Text>
      <SegmentedToggle
        accessibilityLabel={copy("Kaun si bookings", "Which bookings")}
        value={tab}
        onChange={(t) => {
          setTab(t);
          setFilter("all");
        }}
        options={[
          { value: "upcoming", label: copy("Aane wali", "Upcoming"), ...(Array.isArray(upcomingQ.data) ? { count: upcomingQ.data.length } : {}) },
          { value: "past", label: copy("Purani", "Past"), ...(Array.isArray(pastQ.data) ? { count: pastQ.data.length } : {}) },
        ]}
        testID="bookings-tab"
      />
      {list.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }} accessibilityLabel={copy("Status se chhanein", "Filter by status")}>
          {filters.map((f) => (
            <Chip key={f.key} label={`${f.label} · ${counts[f.key]}`} selected={filter === f.key} onPress={() => setFilter(f.key)} testID={`bookings-filter-${f.key}`} />
          ))}
        </View>
      ) : null}

      {query.isLoading ? (
        <View style={{ gap: space[3] }} accessibilityLabel={copy("Bookings load ho rahi hain", "Loading bookings")}>
          <SkeletonCard />
          <SkeletonCard />
        </View>
      ) : query.isError && list.length === 0 ? (
        <ErrorState
          message={friendlyErrorMessage(query.error)}
          reassurance={copy("Aap ki booking aur paisa mehfooz hain.", "Your bookings and money are safe.")}
          onRetry={() => query.refetch()}
        />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title={filter !== "all" ? copy("Is status ki koi booking nahi", "Nothing with this status") : tab === "upcoming" ? copy("Abhi koi booking nahi", "Nothing booked yet") : copy("Purani bookings yahan aayengi", "Past games show up here")}
          body={filter !== "all" ? copy("Doosra status chunein ya sab dekhein.", "Pick another status or show all.") : tab === "upcoming" ? copy("Court dhoondein aur pehla slot book karein.", "Find a court and book your first slot.") : undefined}
          actionLabel={filter !== "all" ? copy("Sab dekhein", "Show all") : tab === "upcoming" ? copy("Court dhoondo", "Find a court") : undefined}
          onAction={filter !== "all" ? () => setFilter("all") : tab === "upcoming" ? () => router.push("/(player)/search") : undefined}
        />
      ) : (
        <View style={{ gap: space[3] }} testID="bookings-list">
          {shown.map((b) => (
            <BookingRow key={b.id} booking={b} review={reviewByBooking.get(b.id) ?? null} onRate={() => setRating({ booking: b, review: reviewByBooking.get(b.id) ?? null })} />
          ))}
        </View>
      )}

      <RateSheet
        target={rating}
        onClose={() => setRating(null)}
        onSaved={() => {
          setRating(null);
          void queryClient.invalidateQueries({ queryKey: ["my-reviews"] });
        }}
      />
    </Screen>
  );
}

function BookingRow({ booking, review, onRate }: { booking: Booking; review: Review | null; onRate: () => void }) {
  const copy = useCopy();
  const lang = useLang();
  const place = useBookingPlace(booking);
  const action = bookingAction(booking);
  const open = () =>
    action === "pay"
      ? router.push({ pathname: "/(player)/booking/[id]/pay", params: { id: booking.id } })
      : router.push({ pathname: "/(player)/booking/[id]/done", params: { id: booking.id } });
  const label =
    action === "pay"
      ? copy("Pay karein", "Pay now")
      : action === "status"
        ? copy("Status dekhein", "See status")
        : action === "ticket"
          ? copy("Ticket / QR", "Ticket / QR")
          : copy("Tafseel", "Details");
  const canRate = booking.status === "completed" && (review == null || Date.now() - Date.parse(review.created_at) <= SEVEN_DAYS_MS);
  return (
    <Card padding={4} radiusSize="tile" style={{ gap: space[3] }} testID={`booking-row-${booking.status}`}>
      <Pressable
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={[place.venue?.name, place.court?.name, formatTimeRange(booking.starts_at, booking.ends_at, lang)].filter(Boolean).join(", ")}
        style={({ pressed }) => ({ flexDirection: "row", gap: space[3], alignItems: "center", opacity: pressed ? 0.85 : 1, minHeight: size.tap })}
      >
        <DateTile iso={booking.starts_at} variant={booking.status === "booked" ? "orange" : "soft"} month />
        <View style={{ flex: 1, gap: 4 }}>
          <StatusPill booking={shownStatus(booking)} size="sm" />
          <Text variant="bodyStrong">{place.venue?.name ?? (place.loading ? " " : copy("Venue", "Venue"))}</Text>
          <Text variant="meta" tone="muted">
            {[place.court?.name, formatTimeRange(booking.starts_at, booking.ends_at, lang)].filter(Boolean).join(" · ")}
          </Text>
          {place.venue ? (
            // audit 2026-10-28 item 14: every booking says its refund rule in one line
            <Text variant="meta" tone="muted" testID="booking-refund-line">
              {refundPolicyShort(place.venue, lang)}
            </Text>
          ) : null}
        </View>
      </Pressable>
      <View style={{ flexDirection: "row", gap: space[2], flexWrap: "wrap" }}>
        <Button label={label} size="sm" variant={action === "pay" ? "primary" : "soft"} onPress={open} testID={`booking-action-${action}`} />
        {booking.status === "completed" && review ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, minHeight: size.tap }} accessibilityLabel={copy(`Aap ki rating ${review.rating} mein se 5`, `Your rating ${review.rating} of 5`)}>
            <Star size={14} color={palette.orange} fill={palette.orange} />
            <Text variant="meta" weight="bold">
              {String(review.rating)}
            </Text>
          </View>
        ) : null}
        {canRate ? <Button label={review ? copy("Review badlein", "Edit review") : copy("Game ko rate karein", "Rate your game")} size="sm" variant="soft" onPress={onRate} /> : null}
      </View>
    </Card>
  );
}

function RateSheet({ target, onClose, onSaved }: { target: { booking: Booking; review: Review | null } | null; onClose: () => void; onSaved: () => void }) {
  const copy = useCopy();
  const toast = useToast();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  if (target && openedFor !== target.booking.id) {
    setOpenedFor(target.booking.id);
    setRating(target.review?.rating ?? 0);
    setComment(target.review?.comment ?? "");
    setError(null);
  }
  async function save() {
    if (!target || rating < 1 || saving) return;
    setSaving(true);
    setError(null);
    try {
      if (target.review) await api.reviews.edit(target.review.id, { rating, comment: comment.trim() || undefined });
      else await api.reviews.create({ booking_id: target.booking.id, rating, comment: comment.trim() || undefined });
      toast.show({ message: copy("Review save ho gaya", "Review saved"), tone: "success" });
      setOpenedFor(null);
      onSaved();
    } catch (e) {
      setError(friendlyErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Sheet
      open={!!target}
      onClose={() => {
        setOpenedFor(null);
        onClose();
      }}
      title={copy("Game kaisa raha?", "How was your game?")}
      footer={<Button label={copy("Save karein", "Save")} block loading={saving} disabled={rating < 1} onPress={save} />}
    >
      {error ? <Banner tone="danger" body={error} /> : null}
      <View style={{ flexDirection: "row", gap: space[2], flexWrap: "wrap" }} accessibilityRole="radiogroup" accessibilityLabel={copy("Rating", "Rating")}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable
            key={n}
            accessibilityRole="radio"
            accessibilityState={{ checked: rating === n }}
            accessibilityLabel={copy(`${n} star`, `${n} star${n > 1 ? "s" : ""}`)}
            onPress={() => setRating(n)}
            style={{ width: size.tap + 4, height: size.tap + 4, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: n <= rating ? palette.orangeTint : palette.ground }}
          >
            <Star size={26} color={n <= rating ? palette.orangeDeep : palette.muted2} fill={n <= rating ? palette.orange : "transparent"} />
          </Pressable>
        ))}
      </View>
      <Input label={copy("Kuch likhna hai? (zaroori nahi)", "Add a comment (optional)")} value={comment} onChangeText={setComment} multiline />
    </Sheet>
  );
}
