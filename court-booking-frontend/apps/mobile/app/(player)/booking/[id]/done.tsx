import { useRef, useState, type ReactNode } from "react";
import { Linking, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useIsFocused, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarPlus, Check, Clock3, MessageCircle, Navigation, Phone, QrCode, ScanLine, Share2, X } from "lucide-react-native";
import { ApiError } from "@court-booking/api-client";
import { bookingHeader, paisaT, refundSummary, formatDate, formatTime, formatTimeRange, formatWhen, paymentLineLabel, timelineLabel, whatsappLink, type BookingStatus } from "@court-booking/types";
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
import { bookingShortCode, calendarLink, doneCopy, donePaidAmount, donePollMs, doneView, ticketTimeRange } from "@/lib/booking-done";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { LightStatusBar } from "@/components/ui/StatusBarStyle";
import { safeBack } from "@/lib/safe-back";
import { cancelErrorCopy, cancelPolicySentence, cancelState, shownStatus } from "@/lib/player-flow";
import { useLedgerV2 } from "@/lib/use-ledger-v2";
import { RaastQr } from "@/components/raast-qr";
import { BalanceProofUpload } from "@/components/balance-proof-upload";
import { BookingExtrasCard } from "@/components/booking-extras";
import { RefundDisputeCard } from "@/components/refund-dispute";
import { DateTile, PlayerOfflineBanner, openDirections, shareText, sportLabel, useBookingPlace, useNow } from "../../_components";

/**
 * Status board + PBookings booking detail. Honest timeline Hold -> Screenshot bheja -> Venue check -> Pakki (journeySteps:
 * "Pakki" can only be done when the backend says booked), celebration + QR ticket ONLY for booked, the reject reason /
 * expiry and the next step, Total / Mila / Baqi from BookingOut, the venue's real cancel policy and the cancel sheet.
 * Polls while the venue or the player still has to act (focus-gated).
 */
export default function BookingStatusScreen() {
  const { id, celebrate } = useLocalSearchParams<{ id: string; celebrate?: string }>();
  const copy = useCopy();
  const lang = useLang();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const queryClient = useQueryClient();
  const now = useNow(30_000);

  const bookingQuery = useQuery({
    queryKey: ["booking", id],
    queryFn: () => api.bookings.get(id),
    refetchInterval: (q) => donePollMs(q.state.data?.status),
    subscribed: focused,
  });
  const booking = bookingQuery.data;
  // The status the screen opened with decides ticket vs celebration (doneView).
  const firstStatus = useRef<BookingStatus | null>(null);
  if (booking && firstStatus.current === null) firstStatus.current = booking.status;
  const place = useBookingPlace(booking);
  // Audit 2026-10-28 item 4: the money lines, the event history and the venue's contact (one call, same rule as the web page).
  const detailQuery = useQuery({
    queryKey: ["booking-detail", id, booking?.status],
    queryFn: () => api.bookings.detail(id),
    enabled: !!booking,
    subscribed: focused,
  });
  // fix/nov-8: same query (and cache) as BookingExtrasCard; it says whether "Main aaya tha" is open (noshow_reply flag).
  const extrasQuery = useQuery({
    queryKey: ["booking-extras", id],
    queryFn: () => api.phase3.extras(id),
    enabled: booking?.status === "no_show",
    subscribed: focused,
  });
  const [refundBusy, setRefundBusy] = useState(false);
  const balancePay = useQuery({
    queryKey: ["payment-instructions", id, booking?.status],
    queryFn: () => api.bookings.paymentInstructions(id),
    enabled: booking?.status === "booked" && (booking?.balance_due ?? 0) > 0,
  });
  const paymentsQuery = useQuery({
    queryKey: ["booking-payments", id, booking?.status],
    queryFn: () => api.payments.listForBooking(id),
    enabled: !!booking && booking.status !== "held",
  });
  const [cancelOpen, setCancelOpen] = useState(false);
  const { v2: ledgerV2 } = useLedgerV2();
  const cancelPreview = useQuery({
    queryKey: ["cancel-preview", id],
    queryFn: () => api.bookings.cancelPreview(id),
    enabled: ledgerV2 && cancelOpen && !!id,
  });
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
        <LightStatusBar />
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
  // fix/nov-8: the QR area per status (QR only for a booked slot still ahead; no placeholder on a past/ended booking) and
  // "Aap aaye the? Batayein" under a no-show while the player may still reply.
  const header = bookingHeader({ ...shown, ends_at: booking.ends_at }, { now, canReplyNoShow: extrasQuery.data?.arrival.can_reply_noshow === true, lang });
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
  const baseCancel = cancelState(booking, place.venue, now);
  // ledger v2 (contract 6.3, founder 13 Nov): a late cancel is allowed where the venue allows cancelling; the advance is kept
  // and the sheet says so first ("Advance PKR X wapas nahi hoga")
  const lateCancelOk = ledgerV2 && booking.status === "booked" && baseCancel.blocked === "window_closed" && !!place.venue?.cancellation_allowed
    && Date.parse(booking.starts_at) > now;
  const cancel = lateCancelOk ? { ...baseCancel, canCancel: true, blocked: undefined } : baseCancel;
  const preview = cancelPreview.data;
  const keptAdvance = booking.status === "cancelled" ? booking.advance_kept_pkr ?? 0 : 0;
  const paid = donePaidAmount(booking);
  const isOver = Date.parse(booking.ends_at) <= now;
  const detail = detailQuery.data;
  const wa = detail ? whatsappLink(detail.venue.whatsapp ?? detail.venue.phone, copy(`Salam, meri booking ${booking.id.slice(0, 8)} ke baare mein baat karni hai.`, `Hi, I'd like to talk about my booking ${booking.id.slice(0, 8)}.`)) : null;
  const tel = detail?.venue.phone ? `tel:${detail.venue.phone.replace(/[^\d+]/g, "")}` : null;

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
      const { booking: b } = await api.bookings.cancel(id, undefined, { acceptKeepAdvance: ledgerV2 && preview?.mode === "keep" });
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
  // PBookings detail board: an already-pakki booking opens as the "Booking KH-…" ticket screen.
  const ticketView = doneView(firstStatus.current, booking.status, celebrate === "1") === "ticket";
  const indoor = place.court ? (place.court.is_indoor ? "Indoor" : "Outdoor") : null;
  const tileRows: { label: string; icon: ReactNode; onPress: () => void }[][] = [
    [
      ...(place.venue ? [{ label: copy("Raasta", "Directions"), icon: <Navigation size={22} color={palette.night} />, onPress: () => openDirections(place.venue!) }] : []),
      {
        label: "Calendar",
        icon: <CalendarPlus size={22} color={palette.night} />,
        onPress: () => void Linking.openURL(calendarLink([place.court ? sportLabel(place.court.sport) : null, venueName].filter(Boolean).join(" · "), booking.starts_at, booking.ends_at, place.venue?.address)),
      },
      { label: "Chat", icon: <MessageCircle size={22} color={palette.night} />, onPress: () => router.push({ pathname: "/(player)/booking/[id]/chat", params: { id } }) },
    ],
    // the venue's own contacts (not on the board, kept because they are real); only when the venue has them
    [
      ...(wa ? [{ label: "WhatsApp", icon: <MessageCircle size={22} color={palette.night} />, onPress: () => void Linking.openURL(wa) }] : []),
      ...(tel ? [{ label: copy("Call", "Call"), icon: <Phone size={22} color={palette.night} />, onPress: () => void Linking.openURL(tel) }] : []),
    ],
  ].filter((row) => row.length > 0);
  const shareBooking = () => shareText(copy(`${venueName}, ${when}, ${time}. Booking pakki hai.`, `${venueName}, ${when}, ${time}. The booking is confirmed.`));

  const policyCard = policy ? (
          <Card padding={4} radiusSize="cardL" style={{ gap: space[2] }} testID="status-policy">
            <Text variant={ticketView ? "button" : "title"} accessibilityRole="header">
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
              <View style={ticketView ? { alignSelf: "flex-start" } : undefined}>
                <Button label={copy("Booking cancel karein", "Cancel booking")} variant="danger" size="md" block={!ticketView} onPress={() => setCancelOpen(true)} testID="status-cancel" />
              </View>
            ) : booking.status === "booked" && cancel.blocked === "window_closed" ? (
              <Text variant="meta" tone="danger">
                {copy("Cancel ka waqt guzar gaya.", "The cancellation window has closed.")}
              </Text>
            ) : null}
          </Card>
        ) : null;

  return (
    <Screen gutter={false} edgeToEdgeTop={!ticketView} testID="status-screen" refreshing={bookingQuery.isRefetching} onRefresh={() => bookingQuery.refetch()}>
      {ticketView ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: space[4], paddingTop: space[3], paddingBottom: space[4] }}>
          <IconButton icon={ArrowLeft} variant="surface" accessibilityLabel={copy("Wapas", "Back")} onPress={() => safeBack()} testID="status-back" />
          <Text variant="bodyStrong" style={{ flex: 1, fontSize: 18, lineHeight: 24 }} accessibilityRole="header" testID="status-title">
            {`Booking ${bookingShortCode(booking.id)}`}
          </Text>
          <IconButton icon={Share2} variant="surface" accessibilityLabel={copy("Team ko batao", "Tell the team")} onPress={shareBooking} testID="status-share" />
        </View>
      ) : (
      <>
      <LightStatusBar />
      <Hero topInset={insets.top} roundedBottom>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <IconButton icon={ArrowLeft} variant="onDark" accessibilityLabel={copy("Wapas", "Back")} onPress={() => safeBack()} testID="status-back" />
          <StatusPill booking={shown} />
        </View>
        {keptAdvance > 0 ? (
          <Text variant="bodyBold" tone="hero" align="center" testID="status-advance-kept">{paisaT(lang, "paisa.pcancel.keptLine", { amount: formatPkr(keptAdvance) })}</Text>
        ) : null}
        <View style={{ alignItems: "center", gap: space[3], paddingTop: space[2] }}>
          <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: heroBadge, alignItems: "center", justifyContent: "center" }} accessibilityElementsHidden importantForAccessibility="no">
            <HeroIcon size={34} color={heroIconColor} strokeWidth={2.6} />
          </View>
          <Text variant="h1" tone="hero" align="center" accessibilityRole="header" testID="status-title">
            {c.title}
          </Text>
          {header.askNoShow ? (
            <Text variant="bodyStrong" tone="hero" align="center" testID="status-ask-noshow">
              {`${header.askNoShow} ↓`}
            </Text>
          ) : null}
          <Text variant="bodyL" tone="heroMuted" align="center">
            {booking.status === "payment_submitted" && place.venue ? copy(`${place.venue.name} abhi check kar raha hai. Tab tak ye slot kisi aur ko nahi milega.`, `${place.venue.name} is checking it now. Until then nobody else can take this slot.`) : c.subtitle}
          </Text>
        </View>
      </Hero>
      </>
      )}

      <View style={{ paddingHorizontal: ticketView ? space[4] : space[5], gap: ticketView ? 14 : space[4] }}>
        <PlayerOfflineBanner />
        {booking.status === "no_show" && booking.player_id ? <BookingExtrasCard bookingId={id} /> : null}
        {ticketView ? (
          <Ticket
            dark
            qr={header.qr}
            testID="status-ticket"
            bookingId={booking.id}
            booking={booking}
            venueName={venueName}
            subtitle={place.court ? [place.court.name, sportLabel(place.court.sport), indoor].filter(Boolean).join(" · ") : undefined}
            fields={[
              { label: copy("Din", "Day"), value: when },
              { label: copy("Waqt", "Time"), value: ticketTimeRange(booking.starts_at, booking.ends_at, lang) },
            ]}
            footer={
              booking.checked_in_at ? (
                <Banner tone="open" body={copy(`Check-in ho gaya · ${formatTime(booking.checked_in_at)}`, `Checked in · ${formatTime(booking.checked_in_at)}`)} icon={Check} />
              ) : !isOver && booking.status === "booked" ? (
                <Button
                  label={copy("Venue ka QR khud scan karein", "Scan the venue's QR yourself")}
                  variant="soft"
                  size="sm"
                  block
                  icon={<ScanLine size={16} color={palette.night} />}
                  onPress={() => router.push({ pathname: "/(player)/booking/[id]/checkin", params: { id } })}
                  testID="status-self-checkin"
                />
              ) : null
            }
          />
        ) : booked ? (
          <Ticket
            testID="status-ticket"
            qr={header.qr}
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
            {/* fix/nov-9: the journey only while the booking is on its way (on a cancelled one it guessed the wrong step) */}
            {header.kind === "waiting" ? (
              <Card padding={5} radiusSize="cardL" testID="status-timeline">
                <Timeline steps={steps} />
              </Card>
            ) : null}
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

        {ticketView ? (
          <View style={{ gap: space[2] }} testID="status-tiles">
            {tileRows.map((row, r) => (
              <View key={r} style={{ flexDirection: "row", gap: space[2] }}>
                {row.map((t) => (
                  <Tile key={t.label} {...t} />
                ))}
                {Array.from({ length: 3 - row.length }, (_, i) => (
                  <View key={`pad-${i}`} style={{ flex: 1 }} />
                ))}
              </View>
            ))}
          </View>
        ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
          {booked && !isOver ? (
            <QuickButton label={copy("Check-in", "Check in")} icon={<QrCode size={16} color={palette.night} />} onPress={() => router.push({ pathname: "/(player)/booking/[id]/checkin", params: { id } })} />
          ) : null}
          {place.venue ? <QuickButton label={copy("Raasta", "Directions")} icon={<Navigation size={16} color={palette.night} />} onPress={() => openDirections(place.venue!)} /> : null}
          <QuickButton label={copy("Venue se baat", "Talk to venue")} icon={<MessageCircle size={16} color={palette.night} />} onPress={() => router.push({ pathname: "/(player)/booking/[id]/chat", params: { id } })} />
          {wa ? <QuickButton label={copy("WhatsApp karo", "WhatsApp")} icon={<MessageCircle size={16} color={palette.night} />} onPress={() => void Linking.openURL(wa)} /> : null}
          {tel ? <QuickButton label={copy("Call karo", "Call")} icon={<Phone size={16} color={palette.night} />} onPress={() => void Linking.openURL(tel)} /> : null}
          {booked ? (
            <QuickButton
              label={copy("Team ko batao", "Tell the team")}
              icon={<Share2 size={16} color={palette.night} />}
              onPress={() => shareText(copy(`${venueName}, ${when}, ${time}. Booking pakki hai.`, `${venueName}, ${when}, ${time}. The booking is confirmed.`))}
            />
          ) : null}
        </View>
        )}

        <Card padding={4} radiusSize="cardL" style={{ gap: space[3] }} testID="status-money">
          <Text variant={ticketView ? "button" : "title"} accessibilityRole="header">
            {copy("Paisa", "Money")}
          </Text>
          {ticketView ? (
            // PBookings board: three plain rows, no inner box
            [
              { k: copy("Total", "Total"), v: formatPkr(booking.price), tone: "primary" as const },
              { k: copy("Aap ne diye", "You paid"), v: formatPkr(booking.amount_paid), tone: "primary" as const },
              { k: copy("Venue par baqi", "Due at venue"), v: formatPkr(booking.balance_due), tone: booking.balance_due > 0 ? ("waiting" as const) : ("open" as const) },
            ].map((m) => (
              <View key={m.k} style={{ flexDirection: "row", justifyContent: "space-between", gap: space[3] }}>
                <Text variant="body" tone="muted">{m.k}</Text>
                <Text variant="bodyBold" tone={m.tone}>{m.v}</Text>
              </View>
            ))
          ) : (
          <MoneyRows
            rows={[
              { label: copy("Total", "Total"), value: formatPkr(booking.price) },
              { label: copy("Advance", "Advance"), value: formatPkr(booking.advance_amount) },
              { label: copy("Mila (venue ne darj kiya)", "Received (recorded by the venue)"), value: formatPkr(booking.amount_paid), tone: booking.amount_paid > 0 ? "open" : "default" },
              // fix/nov-9: nothing is due on a cancelled booking (the refund line says what comes back)
              { label: copy("Baqi", "Balance"), value: formatPkr(booking.status === "cancelled" ? 0 : booking.balance_due), strong: true, tone: booking.status !== "cancelled" && booking.balance_due > 0 ? "waiting" : "default" },
            ]}
          />
          )}
        </Card>
        {ticketView ? policyCard : null}

        {booking.status === "booked" && booking.balance_due > 0 && balancePay.data && (balancePay.data.account_number || balancePay.data.iban) ? (
          // audit 2026-10-28 item 20: the balance can be sent by transfer too (bank details + Raast QR when switched on)
          <Card padding={4} radiusSize="cardL" style={{ gap: space[2] }} testID="status-balance-pay">
            <Text variant="title" accessibilityRole="header">
              {copy(`Baqi ${formatPkr(balancePay.data.amount)} transfer se bhi de sakte hain`, `You can also send the ${formatPkr(balancePay.data.amount)} balance by transfer`)}
            </Text>
            {balancePay.data.bank ? <Text variant="bodyStrong">{balancePay.data.bank}</Text> : null}
            {balancePay.data.account_title ? <Text variant="body">{copy(`Account ka naam: ${balancePay.data.account_title}`, `Account name: ${balancePay.data.account_title}`)}</Text> : null}
            {balancePay.data.account_number ? <Text variant="body" selectable>{`Account: ${balancePay.data.account_number}`}</Text> : null}
            {balancePay.data.iban ? <Text variant="body" selectable>{`IBAN: ${balancePay.data.iban}`}</Text> : null}
            <Text variant="meta" tone="muted" selectable>{copy(`Transfer note mein likhein: ${balancePay.data.reference}`, `Write in the transfer note: ${balancePay.data.reference}`)}</Text>
            {balancePay.data.qr_payload ? <RaastQr payload={balancePay.data.qr_payload} /> : null}
            <BalanceProofUpload bookingId={id} state={balancePay.data.balance_upload ?? "off"} />
          </Card>
        ) : null}

        {booking.player_id && booking.status !== "no_show" ? <BookingExtrasCard bookingId={id} /> : null}
        {/* fix/nov-9 items 9-12: refund account, refunds sent + check + Mil gaya / Nahi mila, Khelo se shikayat */}
        {booking.player_id ? <RefundDisputeCard bookingId={id} /> : null}

        {detail ? (
          <Card padding={4} radiusSize="cardL" style={{ gap: space[2] }} testID="status-payment-lines">
            <Text variant="title" accessibilityRole="header">
              {copy("Payments", "Payments")}
            </Text>
            {detail.payments.length === 0 ? (
              <Text variant="body" tone="muted">
                {copy("Abhi koi payment record nahi hui.", "No payment recorded yet.")}
              </Text>
            ) : (
              detail.payments.map((p, i) => (
                <View key={`${p.at}-${i}`} style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: space[2] }}>
                  <Text variant="body">{`${paymentLineLabel(p, lang)} · ${formatWhen(p.at, new Date(), lang)}`}</Text>
                  <Text variant="bodyStrong" tone={p.amount < 0 ? "danger" : "open"}>{`${p.amount < 0 ? "−" : ""}${formatPkr(Math.abs(p.amount))}`}</Text>
                </View>
              ))
            )}
            {detail.refund ? (
              <Text variant="bodyStrong" tone={refundSummary(detail.refund, lang).tone === "done" ? "open" : "waiting"} testID="status-refund">
                {refundSummary(detail.refund, lang).text}
              </Text>
            ) : null}
          </Card>
        ) : null}

        {detail && detail.timeline.length > 0 ? (
          <Card padding={4} radiusSize="cardL" style={{ gap: space[2] }} testID="status-history">
            <Text variant="title" accessibilityRole="header">
              {copy("Booking ki kahani", "What happened")}
            </Text>
            {detail.timeline.map((e, i) => (
              <View key={`${e.at}-${e.kind}-${i}`} style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: space[2] }}>
                <Text variant="bodyStrong" style={{ flexShrink: 1 }}>
                  {`${timelineLabel(e.kind, lang)}${e.amount ? ` · ${formatPkr(e.amount)}` : ""}`}
                </Text>
                <Text variant="meta" tone="muted">{formatWhen(e.at, new Date(), lang)}</Text>
              </View>
            ))}
          </Card>
        ) : null}

        {detail?.refund_request?.state === "eligible" ? (
          // audit 2026-10-28 Phase 2 item 3: "Refund maangein" on a cancelled booking the venue's policy refunds
          <Card padding={4} radiusSize="cardL" style={{ gap: space[2] }} testID="status-refund-request">
            <Text variant="title">{copy("Refund maangein", "Ask for a refund")}</Text>
            <Text variant="body" tone="muted">
              {copy(
                `Venue ki policy ke mutabiq aap ${formatPkr(detail.refund_request.amount)} wapas maang sakte hain. Venue khud paisa bhejega.`,
                `Under the venue's policy you can ask for ${formatPkr(detail.refund_request.amount)} back. The venue sends it itself.`,
              )}
            </Text>
            <Button
              label={copy(`${formatPkr(detail.refund_request.amount)} ka refund maangein`, `Ask for ${formatPkr(detail.refund_request.amount)} back`)}
              block
              loading={refundBusy}
              onPress={async () => {
                setRefundBusy(true);
                try {
                  await api.bookings.requestRefund(id);
                  await detailQuery.refetch();
                } catch (e) {
                  setCancelError(friendlyErrorMessage(e));
                } finally {
                  setRefundBusy(false);
                }
              }}
              testID="refund-request"
            />
          </Card>
        ) : null}

        {ticketView ? null : policyCard}

        {booking.status === "payment_submitted" ? (
          <Text variant="meta" tone="muted" align="center">
            {copy("Venue ke approve karte hi ye screen khud update ho jayegi.", "This screen updates by itself as soon as the venue approves.")}
          </Text>
        ) : null}
        {ticketView ? null : <Button label={copy("Meri bookings", "My bookings")} variant="secondary" size="md" block onPress={() => router.replace("/bookings")} testID="status-bookings" />}
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
        {ledgerV2 && booking.status === "booked" && preview ? (
          <View style={{ gap: space[3] }}>
            <MoneyRows
              rows={[
                { label: copy("Booking", "Booking"), value: `${venueName} · ${when}, ${formatTime(booking.starts_at)}` },
                { label: copy("Venue ne darj kiya", "Recorded as paid"), value: formatPkr(preview.paid_pkr) },
                ...(preview.mode === "refund" ? [{ label: copy("Wapas milega", "Refund due"), value: formatPkr(preview.refund_pkr), strong: true }] : []),
              ]}
            />
            {preview.mode === "keep" ? (
              <View testID="cancel-keep-line" style={{ gap: space[2] }}>
                <Banner tone="danger" body={paisaT(lang, "paisa.cancel.keep", { amount: formatPkr(preview.keep_pkr) })} />
                <Text variant="meta" tone="muted">{paisaT(lang, "paisa.pcancel.lateNote")}</Text>
              </View>
            ) : preview.mode === "clear" ? (
              <Text variant="meta" tone="muted">{paisaT(lang, "paisa.pcancel.clear")}</Text>
            ) : null}
          </View>
        ) : (
        <>
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
        </>
        )}
      </Sheet>
    </Screen>
  );
}

/** PBookings detail board: white 72-tall tile, icon over a short label. */
function Tile({ label, icon, onPress }: { label: string; icon: ReactNode; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{ flex: 1, height: 72, borderRadius: 18, backgroundColor: palette.white, alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 4 }}
    >
      {icon}
      <Text variant="label" align="center" numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function QuickButton({ label, icon, onPress }: { label: string; icon: ReactNode; onPress: () => void }) {
  return (
    <View style={{ flexGrow: 1, flexBasis: 140 }}>
      <Button label={label} variant="soft" size="sm" block icon={icon} onPress={onPress} />
    </View>
  );
}
