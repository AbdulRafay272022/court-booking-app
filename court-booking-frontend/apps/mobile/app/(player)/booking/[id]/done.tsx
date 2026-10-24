import { useState, type ReactNode } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useIsFocused, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Clock3, MessageCircle, Navigation, QrCode, Share2, X } from "lucide-react-native";
import { ApiError } from "@court-booking/api-client";
import { formatDate, formatTime, formatTimeRange } from "@court-booking/types";
import { formatPkr, isConfirmed, journeySteps, palette, radius, space } from "@court-booking/ui-tokens";

import {
  Banner,
  Button,
  Card,
  ErrorState,
  Hero,
  IconButton,
  MoneyRows,
  Screen,
  Sheet,
  Skeleton,
  StatusPill,
  Text,
  Ticket,
  Timeline,
  useCopy,
  useLang,
} from "@/components/ui";
import { api } from "@/lib/api";
import { doneCopy, donePaidAmount, donePollMs } from "@/lib/booking-done";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { safeBack } from "@/lib/safe-back";
import { cancelErrorCopy, cancelPolicySentence, cancelState, shownStatus } from "@/lib/player-flow";
import { DateTile, PlayerOfflineBanner, openDirections, shareText, sportLabel, useBookingPlace, useLightStatusBar, useNow } from "../../_components";

/**
 * Status board + PBookings booking detail. Honest timeline Hold -> Screenshot bheja -> Venue check -> Pakki (journeySteps:
 * "Pakki" can only be done when the backend says booked), celebration + QR ticket ONLY for booked, the reject reason /
 * expiry and the next step, Total / Mila / Baqi from BookingOut, the venue's real cancel policy and the cancel sheet.
 * Polls while the venue or the player still has to act (focus-gated).
 */
export default function BookingStatusScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const copy = useCopy();
  const lang = useLang();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const queryClient = useQueryClient();
  const now = useNow(30_000);
  useLightStatusBar();

  const bookingQuery = useQuery({
    queryKey: ["booking", id],
    queryFn: () => api.bookings.get(id),
    refetchInterval: (q) => donePollMs(q.state.data?.status),
    subscribed: focused,
  });
  const booking = bookingQuery.data;
  const place = useBookingPlace(booking);
  const paymentsQuery = useQuery({
    queryKey: ["booking-payments", id, booking?.status],
    queryFn: () => api.payments.listForBooking(id),
    enabled: !!booking && booking.status !== "held",
  });
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  if (!booking && bookingQuery.isError) {
    return (
      <Screen>
        <ErrorState
          showTopBack
          title={copy("Booking load nahi hui", "Couldn't load your booking")}
          message={friendlyErrorMessage(bookingQuery.error)}
          reassurance={copy("Aap ki booking aur paisa mehfooz hain.", "Your booking and money are safe.")}
          onRetry={() => bookingQuery.refetch()}
          onBack={() => safeBack()}
          backLabel={copy("Meri bookings", "My bookings")}
        />
      </Screen>
    );
  }
  if (!booking) {
    return (
      <Screen gutter={false} edgeToEdgeTop>
        <Hero topInset={insets.top} roundedBottom>
          <View style={{ alignItems: "center", gap: space[3], paddingTop: space[6] }} accessibilityLabel={copy("Load ho raha hai", "Loading")}>
            <Skeleton width={72} height={72} r={36} />
            <Skeleton width={200} height={30} />
          </View>
        </Hero>
        <View style={{ paddingHorizontal: space[5] }}>
          <Skeleton height={260} r={radius.cardL} />
        </View>
      </Screen>
    );
  }

  // A hold whose held_until has passed is over even if the expiry job has not cancelled it yet: say so (real timestamp).
  const shown = shownStatus(booking, now);
  const heldExpired = booking.status === "held" && shown.status === "cancelled";
  const c = doneCopy(shown.status, shown.cancelled_by, lang);
  const booked = isConfirmed(booking.status);
  const payments = paymentsQuery.data ?? [];
  const proof = [...payments].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  const rejected = payments.find((p) => p.review_verdict === "rejected");
  const proofSent = payments.length > 0 || booking.status === "payment_submitted";
  const steps = journeySteps({ ...shown, proofSent }, lang).map((s) => ({
    ...s,
    sub:
      s.key === "hold"
        ? formatTime(booking.created_at)
        : s.key === "proof" && proof
          ? `${formatTime(proof.created_at)}${proof.expected_amount != null ? ` · ${formatPkr(proof.expected_amount)}` : ""}`
          : s.key === "check" && s.state === "now"
            ? copy("Abhi", "Now")
            : s.key === "booked" && s.state === "next"
              ? copy("Hote hi notification aayega", "You'll get a notification")
              : undefined,
  }));
  const venueName = place.venue?.name ?? copy("Venue", "Venue");
  const courtLine = place.court ? `${place.court.name} · ${sportLabel(place.court.sport)}` : "";
  const when = `${formatDate(booking.starts_at, new Date(), lang)}`;
  const time = formatTimeRange(booking.starts_at, booking.ends_at, lang);
  const policy = place.venue ? cancelPolicySentence(place.venue, lang) : null;
  const cancel = cancelState(booking, place.venue, now);
  const paid = donePaidAmount(booking);
  const isOver = Date.parse(booking.ends_at) <= now;

  // Why it stopped, in the venue's own words where there are some.
  const stopReason =
    booking.status === "cancelled" && booking.cancelled_by === "owner"
      ? rejected?.rejection_reason ?? (booking.cancellation_reason && !/_/.test(booking.cancellation_reason) ? booking.cancellation_reason : null)
      : null;
  const systemReason =
    shown.status === "cancelled" && shown.cancelled_by === "system"
      ? shown.cancellation_reason === "payment_review_expired"
        ? copy("Venue ne waqt par screenshot check nahi kiya, is liye booking khatam ho gayi.", "The venue didn't check the screenshot in time, so the booking ended.")
        : copy("Waqt par screenshot nahi aaya, is liye slot dobara khul gaya.", "The screenshot didn't arrive in time, so the slot opened again.")
      : null;

  async function doCancel() {
    if (cancelling) return;
    setCancelling(true);
    setCancelError(null);
    try {
      const { booking: b } = await api.bookings.cancel(id);
      queryClient.setQueryData(["booking", id], b);
      void queryClient.invalidateQueries({ queryKey: ["bookings-mine"] });
      setCancelOpen(false);
    } catch (e) {
      setCancelError(cancelErrorCopy(e instanceof ApiError ? e.code : null, lang, friendlyErrorMessage(e)));
    } finally {
      setCancelling(false);
    }
  }

  const HeroIcon = c.icon === "check" ? Check : c.icon === "clock" ? Clock3 : X;
  const heroBadge = c.tone === "confirmed" ? palette.teal : c.tone === "waiting" ? palette.waitingTint : palette.dangerTint;
  const heroIconColor = c.tone === "confirmed" ? palette.white : c.tone === "waiting" ? palette.waiting : palette.danger;

  return (
    <Screen gutter={false} edgeToEdgeTop testID="status-screen" refreshing={bookingQuery.isRefetching} onRefresh={() => bookingQuery.refetch()}>
      <Hero topInset={insets.top} roundedBottom>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <IconButton icon={ArrowLeft} variant="onDark" accessibilityLabel={copy("Wapas", "Back")} onPress={() => safeBack()} testID="status-back" />
          <StatusPill booking={shown} />
        </View>
        <View style={{ alignItems: "center", gap: space[3], paddingTop: space[2] }}>
          <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: heroBadge, alignItems: "center", justifyContent: "center" }} accessibilityElementsHidden importantForAccessibility="no">
            <HeroIcon size={34} color={heroIconColor} strokeWidth={2.6} />
          </View>
          <Text variant="h1" tone="hero" align="center" accessibilityRole="header" testID="status-title">
            {c.title}
          </Text>
          <Text variant="bodyL" tone="heroMuted" align="center">
            {booking.status === "payment_submitted" && place.venue ? copy(`${place.venue.name} abhi check kar raha hai. Tab tak ye slot kisi aur ko nahi milega.`, `${place.venue.name} is checking it now. Until then nobody else can take this slot.`) : c.subtitle}
          </Text>
        </View>
      </Hero>

      <View style={{ paddingHorizontal: space[5], gap: space[4] }}>
        <PlayerOfflineBanner />
        {booked ? (
          <Ticket
            testID="status-ticket"
            bookingId={booking.id}
            booking={booking}
            venueName={venueName}
            eyebrow={place.court ? `${sportLabel(place.court.sport).toUpperCase()} · ${place.court.name.toUpperCase()}` : undefined}
            fields={[
              { label: copy("Din", "Day"), value: when },
              { label: copy("Waqt", "Time"), value: time },
              { label: copy("Total", "Total"), value: formatPkr(booking.price) },
              { label: copy("Venue par baqi", "Due at venue"), value: booking.balance_due > 0 ? formatPkr(booking.balance_due) : copy("Kuch nahi", "Nothing") },
            ]}
            footer={
              booking.checked_in_at ? (
                <Banner tone="open" body={copy(`Check-in ho gaya · ${formatTime(booking.checked_in_at)}`, `Checked in · ${formatTime(booking.checked_in_at)}`)} icon={Check} />
              ) : null
            }
          />
        ) : (
          <>
            <Card padding={5} radiusSize="cardL" testID="status-timeline">
              <Timeline steps={steps} />
            </Card>
            <Card padding={4} radiusSize="cardL" style={{ flexDirection: "row", alignItems: "center", gap: space[3] }}>
              <DateTile iso={booking.starts_at} variant="orange" />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong">{[venueName, place.court?.name].filter(Boolean).join(" · ")}</Text>
                <Text variant="meta" tone="muted">
                  {[time, paid != null ? copy(`${formatPkr(paid)} mila`, `${formatPkr(paid)} received`) : proof?.expected_amount != null ? copy(`${formatPkr(proof.expected_amount)} bheje`, `${formatPkr(proof.expected_amount)} sent`) : null].filter(Boolean).join(" · ")}
                </Text>
              </View>
            </Card>
          </>
        )}

        {stopReason ? <Banner tone="danger" title={copy("Venue ne kaha", "What the venue said")} body={`“${stopReason}”`} testID="status-reason" /> : null}
        {systemReason ? <Banner tone="danger" body={systemReason} testID="status-reason" /> : null}

        {booking.status === "held" && !heldExpired ? (
          <Button label={c.actionLabel} block onPress={() => router.replace({ pathname: "/(player)/booking/[id]/pay", params: { id } })} testID="status-pay" />
        ) : shown.status === "cancelled" ? (
          <Button
            label={copy("Naya slot dhoondein", "Find another slot")}
            block
            onPress={() => (place.venue ? router.replace({ pathname: "/(player)/venue/[slug]", params: { slug: place.venue.slug } }) : router.replace("/(player)/search"))}
            testID="status-rebook"
          />
        ) : null}

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
          {booked && !isOver ? (
            <QuickButton label={copy("Check-in", "Check in")} icon={<QrCode size={16} color={palette.night} />} onPress={() => router.push({ pathname: "/(player)/booking/[id]/checkin", params: { id } })} />
          ) : null}
          {place.venue ? <QuickButton label={copy("Raasta", "Directions")} icon={<Navigation size={16} color={palette.night} />} onPress={() => openDirections(place.venue!)} /> : null}
          <QuickButton label={copy("Venue se baat", "Talk to venue")} icon={<MessageCircle size={16} color={palette.night} />} onPress={() => router.push({ pathname: "/(player)/booking/[id]/chat", params: { id } })} />
          {booked ? (
            <QuickButton
              label={copy("Team ko batao", "Tell the team")}
              icon={<Share2 size={16} color={palette.night} />}
              onPress={() => shareText(copy(`${venueName}, ${when}, ${time}. Booking pakki hai.`, `${venueName}, ${when}, ${time}. The booking is confirmed.`))}
            />
          ) : null}
        </View>

        <Card padding={4} radiusSize="cardL" style={{ gap: space[3] }} testID="status-money">
          <Text variant="title" accessibilityRole="header">
            {copy("Paisa", "Money")}
          </Text>
          <MoneyRows
            rows={[
              { label: copy("Total", "Total"), value: formatPkr(booking.price) },
              { label: copy("Advance", "Advance"), value: formatPkr(booking.advance_amount) },
              { label: copy("Mila (venue ne darj kiya)", "Received (recorded by the venue)"), value: formatPkr(booking.amount_paid), tone: booking.amount_paid > 0 ? "open" : "default" },
              { label: copy("Baqi", "Balance"), value: formatPkr(booking.balance_due), strong: true, tone: booking.balance_due > 0 ? "waiting" : "default" },
            ]}
          />
        </Card>

        {policy ? (
          <Card padding={4} radiusSize="cardL" style={{ gap: space[2] }} testID="status-policy">
            <Text variant="title" accessibilityRole="header">
              {copy("Cancel policy", "Cancellation policy")}
            </Text>
            <Text variant="body" tone="muted">
              {policy}
            </Text>
            {!heldExpired && (booking.status === "held" || booking.status === "payment_submitted") ? (
              <Text variant="meta" tone="muted">
                {copy("Venue ke approve karne se pehle aap kabhi bhi cancel kar sakte hain.", "Until the venue approves you can cancel any time.")}
              </Text>
            ) : null}
            {cancel.canCancel && !heldExpired ? (
              <Button label={copy("Booking cancel karein", "Cancel booking")} variant="danger" size="md" block onPress={() => setCancelOpen(true)} testID="status-cancel" />
            ) : booking.status === "booked" && cancel.blocked === "window_closed" ? (
              <Text variant="meta" tone="danger">
                {copy("Cancel ka waqt guzar gaya.", "The cancellation window has closed.")}
              </Text>
            ) : null}
          </Card>
        ) : null}

        {booking.status === "payment_submitted" ? (
          <Text variant="meta" tone="muted" align="center">
            {copy("Venue ke approve karte hi ye screen khud update ho jayegi.", "This screen updates by itself as soon as the venue approves.")}
          </Text>
        ) : null}
        <Button label={copy("Meri bookings", "My bookings")} variant="secondary" size="md" block onPress={() => router.replace("/bookings")} testID="status-bookings" />
      </View>

      <Sheet
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={copy("Booking cancel karein?", "Cancel this booking?")}
        testID="cancel-sheet"
        footer={
          <View style={{ gap: space[3] }}>
            <Button label={copy("Haan, cancel karein", "Yes, cancel")} variant="dangerSolid" block loading={cancelling} onPress={doCancel} testID="cancel-confirm" />
            <Button label={copy("Nahi, booking rakhein", "No, keep it")} variant="soft" size="md" block onPress={() => setCancelOpen(false)} />
          </View>
        }
      >
        {cancelError ? <Banner tone="danger" body={cancelError} /> : null}
        <MoneyRows
          rows={[
            { label: copy("Booking", "Booking"), value: `${venueName} · ${when}, ${formatTime(booking.starts_at)}` },
            { label: copy("Venue ne darj kiya", "Recorded as paid"), value: formatPkr(booking.amount_paid) },
            ...(booking.status === "booked" ? [{ label: copy("Wapas milega", "Refund due"), value: formatPkr(booking.amount_paid), strong: true }] : []),
          ]}
        />
        <Text variant="meta" tone="muted">
          {booking.status === "booked"
            ? copy("Refund venue khud bhejta hai (JazzCash / bank); app apne aap paisa nahi bhejti. Slot dobara khul jayega.", "The venue sends the refund itself (JazzCash / bank); the app doesn't send money. The slot opens again.")
            : copy("Slot dobara khul jayega. Agar aap paisa bhej chuke hain to venue se baat karein.", "The slot opens again. If you already sent money, talk to the venue.")}
        </Text>
      </Sheet>
    </Screen>
  );
}

function QuickButton({ label, icon, onPress }: { label: string; icon: ReactNode; onPress: () => void }) {
  return (
    <View style={{ flexGrow: 1, flexBasis: 140 }}>
      <Button label={label} variant="soft" size="sm" block icon={icon} onPress={onPress} />
    </View>
  );
}
