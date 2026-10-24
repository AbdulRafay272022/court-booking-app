import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { router, useIsFocused, useLocalSearchParams } from "expo-router";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Heart, Info, MapPin, MessageCircle, Navigation, Share2, Star } from "lucide-react-native";
import { ApiError } from "@court-booking/api-client";
import { amenityLabel, formatDate, formatDuration, formatTime, formatTimeRange, minSlotsFor, monthOf, pktDateString, type Court, type Review, type Venue } from "@court-booking/types";
import { formatPkr, palette, radius, slot as slotLook, space } from "@court-booking/ui-tokens";

import {
  GlassBar,
  Banner,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  IconButton,
  MoneyRows,
  NotFound,
  Pill,
  Screen,
  SegmentedToggle,
  Sheet,
  Skeleton,
  SlotChip,
  Text,
  useCopy,
  useLang,
  useToast,
} from "@/components/ui";
import { api } from "@/lib/api";
import { useBookingFlowStore } from "@/lib/booking-flow-store";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { safeBack } from "@/lib/safe-back";
import { PLAYER_HOME_HREF } from "@/lib/safe-back-rules";
import { decodeSportParam, sameSport } from "@/lib/sport";
import { cancelPolicySentence, cancelPolicyShort, durationOptions, holdErrorCopy, pickerModel, venueDays } from "@/lib/player-flow";
import { BlockTitle, DayChip, PhotoHero, StepHeading, openDirections, openVenueWhatsApp, shareText, sportLabel, useFavoriteToggle, useNow, venueWhatsApp, type DayState } from "../_components";

/**
 * Venue board: real photos, Raasta / WhatsApp / Tafseel, booking first in 4 numbered steps (1 Court, 2 Din, 3 Kitni der,
 * 4 Kab shuru) with SlotChip states that are never colour-only, a floating bar with the live total + chat + "Book karo",
 * and a confirm sheet whose money comes from GET /courts/:id/quote. "Book karo" calls the direct hold (POST /bookings/hold);
 * the chat path stays available from the bar and the sheet.
 */
export default function VenueScreen() {
  const { slug, sport: sportParam } = useLocalSearchParams<{ slug: string; sport?: string }>();
  const copy = useCopy();
  const lang = useLang();
  const venueQuery = useQuery({ queryKey: ["venue-detail", slug], queryFn: () => api.venues.getBySlug(slug!), enabled: !!slug });
  const venue = venueQuery.data;

  if (venueQuery.isLoading) return <VenueSkeleton />;
  if (!venue) {
    const notFound = venueQuery.error instanceof ApiError && (venueQuery.error.status === 404 || venueQuery.error.code === "VENUE_NOT_FOUND" || venueQuery.error.code === "NOT_FOUND");
    if (notFound || !venueQuery.isError) return <NotFound onHome={() => router.replace(PLAYER_HOME_HREF)} />;
    return (
      <Screen>
        <ErrorState
          showTopBack
          title={copy("Venue load nahi ho saka", "Couldn't load this venue")}
          message={friendlyErrorMessage(venueQuery.error)}
          onRetry={() => venueQuery.refetch()}
          onBack={() => safeBack(PLAYER_HOME_HREF)}
          backLabel={copy("Home par jayein", "Go home")}
        />
      </Screen>
    );
  }
  return <VenueBody venue={venue} sportParam={decodeSportParam(sportParam)} lang={lang} />;
}

function VenueSkeleton() {
  return (
    <Screen gutter={false} edgeToEdgeTop>
      <Skeleton height={300} r={0} shade="photo" />
      <View style={{ paddingHorizontal: space[5], gap: space[3] }}>
        <Skeleton width="70%" height={34} shade="strong" />
        <Skeleton width="50%" height={16} />
        <Skeleton height={46} r={radius.md} />
        <Skeleton height={320} r={radius.cardL} />
      </View>
    </Screen>
  );
}

function VenueBody({ venue, sportParam, lang }: { venue: Venue; sportParam: string | undefined; lang: "ru" | "en" }) {
  const copy = useCopy();
  const toast = useToast();
  const queryClient = useQueryClient();
  const focused = useIsFocused();
  const now = useNow(30_000);
  const fav = useFavoriteToggle();
  const setPaymentInstructions = useBookingFlowStore((s) => s.setPaymentInstructions);

  const courts = useMemo(() => [...(venue.courts ?? [])].filter((c) => c.is_active).sort((a, b) => a.sort_order - b.sort_order), [venue.courts]);
  const preferred = courts.find((c) => sameSport(c.sport, sportParam)) ?? courts[0];
  const [courtId, setCourtId] = useState<string | undefined>(preferred?.id);
  const court: Court | undefined = courts.find((c) => c.id === courtId) ?? preferred;

  const today = pktDateString(now);
  const days = useMemo(() => venueDays(today, venue.booking_horizon_days, 7), [today, venue.booking_horizon_days]);
  const [date, setDate] = useState(days[0]);

  // Day dots: the court's month summary for the month(s) the 7-day strip covers (same cache key as before).
  const months = useMemo(() => [...new Set(days.map(monthOf))], [days]);
  const monthQueries = useQueries({
    queries: months.map((m) => ({
      queryKey: ["court-month-summary", court?.id, m],
      queryFn: () => api.availability.monthSummary(court!.id, m),
      enabled: !!court,
    })),
  });
  const dayState = new Map<string, DayState>();
  for (const q of monthQueries) for (const d of q.data?.days ?? []) dayState.set(d.date, d.state as DayState);

  // The day's slots. No placeholder from the previous day: an old day's slots must never show under a new date.
  const availQuery = useQuery({
    queryKey: ["court-availability", court?.id, date],
    queryFn: () => api.availability.forCourtOnDate(court!.id, date),
    enabled: !!court,
    placeholderData: undefined,
    refetchInterval: 30_000,
    subscribed: focused,
  });
  const minSlots = availQuery.data?.min_slots ?? minSlotsFor(court?.slot_minutes ?? 60);
  const durations = durationOptions(minSlots);
  const [slotCount, setSlotCount] = useState(minSlots);
  useEffect(() => {
    if (!durations.includes(slotCount)) setSlotCount(durations[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minSlots]);
  const [start, setStart] = useState<string | null>(null);
  const slots = availQuery.data?.slots ?? [];
  const model = pickerModel(slots, slotCount, start, now);

  const quoteQuery = useQuery({
    queryKey: ["booking-quote", court?.id, model.start, slotCount],
    queryFn: () => api.availability.quote(court!.id, model.start!, slotCount),
    enabled: !!court && !!model.start,
  });
  const quote = model.start ? quoteQuery.data : undefined;

  const [sheetOpen, setSheetOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [holding, setHolding] = useState(false);
  const [holdError, setHoldError] = useState<{ title: string; body: string } | null>(null);

  const openPrices = slots.filter((s) => s.status === "available" && Date.parse(s.starts_at) > now).map((s) => s.price);
  const fromPrice = openPrices.length ? Math.min(...openPrices) : null;
  const wa = venueWhatsApp(venue);
  const durationLabel = formatDuration(slotCount * 30, lang);
  const whenLabel = model.startsAt && model.endsAt ? `${formatDate(model.startsAt, new Date(), lang)} · ${formatTimeRange(model.startsAt, model.endsAt, lang)}` : null;

  function chooseCourt(id: string) {
    setCourtId(id);
    setStart(null);
  }
  function chooseDate(d: string) {
    setDate(d);
    setStart(null);
  }

  function openChat() {
    router.push({
      pathname: "/(player)/booking/[id]/chat",
      params: {
        id: "new",
        venueId: venue.id,
        venueName: venue.name,
        ...(court && model.startsAt
          ? {
              courtId: court.id,
              courtName: court.name,
              courtSport: court.sport,
              startsAt: model.startsAt,
              slotCount: String(slotCount),
              minutes: String(slotCount * 30),
              ...(quote ? { price: String(quote.price) } : {}),
            }
          : {}),
      },
    });
  }

  function tapSlot(s: (typeof model.items)[number]) {
    if (s.state === "mine" && s.slot.booking_id) {
      router.push({ pathname: s.slot.status === "booked" ? "/(player)/booking/[id]/done" : "/(player)/booking/[id]/pay", params: { id: s.slot.booking_id } });
      return;
    }
    if (s.state === "open") setStart(s.slot.starts_at);
    else if (s.state === "selected" || s.state === "inRange") setStart(null);
  }

  async function bookNow() {
    if (!court || !model.startsAt || holding) return;
    setHolding(true);
    setHoldError(null);
    try {
      // starts_at straight from the availability slot (it carries the UTC offset the server requires).
      const { booking, payment_instructions } = await api.bookings.hold({ court_id: court.id, starts_at: model.startsAt, slot_count: slotCount });
      if (payment_instructions) setPaymentInstructions(booking.id, payment_instructions);
      queryClient.setQueryData(["booking", booking.id], booking);
      void queryClient.invalidateQueries({ queryKey: ["court-availability", court.id] });
      void queryClient.invalidateQueries({ queryKey: ["bookings-mine"] });
      setSheetOpen(false);
      setStart(null);
      router.push({ pathname: "/(player)/booking/[id]/pay", params: { id: booking.id } });
    } catch (e) {
      const code = e instanceof ApiError ? e.code : null;
      const c = holdErrorCopy(code, lang, friendlyErrorMessage(e));
      setHoldError({ title: c.title, body: c.body });
      if (c.refreshSlots) {
        setStart(null);
        void availQuery.refetch();
        void queryClient.invalidateQueries({ queryKey: ["court-month-summary", court.id] });
      }
    } finally {
      setHolding(false);
    }
  }

  const saved = fav.isSaved(venue.id);
  const meta = [venue.area ?? venue.city, venue.distance_meters != null ? `${(venue.distance_meters / 1000).toFixed(1)} km` : null].filter(Boolean).join(" · ");
  const amenities = venue.amenities ?? [];

  return (
    <Screen
      gutter={false}
      edgeToEdgeTop
      floatingBar="bar"
      testID="venue-screen"
      overlay={
        <GlassBar solid testID="venue-book-bar">
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], padding: space[3], paddingLeft: space[4], flexWrap: "wrap" }}>
          <View style={{ flex: 1, minWidth: 130, gap: 1 }}>
            {model.startsAt ? (
              <>
                {quote ? (
                  <Text variant="title" testID="venue-bar-total">
                    {formatPkr(quote.price)}
                  </Text>
                ) : quoteQuery.isError ? (
                  <Text variant="meta" tone="danger">
                    {copy("Qeemat nahi mili", "Price unavailable")}
                  </Text>
                ) : (
                  <Skeleton width={96} height={22} />
                )}
                <Text variant="caption" tone="muted">
                  {[court?.name, durationLabel].filter(Boolean).join(" · ")}
                </Text>
                {whenLabel ? (
                  <Text variant="caption" tone="muted">
                    {whenLabel}
                  </Text>
                ) : null}
              </>
            ) : (
              <>
                <Text variant="bodyBold" weight="black">
                  {copy("Shuru ka waqt chunein", "Pick a start time")}
                </Text>
                <Text variant="caption" tone="muted">
                  {copy("Chunte hi qeemat nazar aayegi", "The price shows once you pick")}
                </Text>
              </>
            )}
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[2], marginLeft: "auto" }}>
          <IconButton icon={MessageCircle} variant="mist" diameter={52} accessibilityLabel={copy("Is slot ke baare mein chat mein poochein", "Ask about this slot in chat")} onPress={openChat} testID="venue-chat" />
          <Button
            label={copy("Book karo", "Book")}
            size="md"
            disabled={!model.startsAt || !quote}
            onPress={() => {
              setHoldError(null);
              setSheetOpen(true);
            }}
            testID="venue-book"
          />
          </View>
          </View>
        </GlassBar>
      }
    >
      <PhotoHero
        photos={venue.photo_urls ?? []}
        name={venue.name}
        seed={venue.id}
        top={
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <IconButton icon={ArrowLeft} variant="onPhoto" accessibilityLabel={copy("Wapas", "Back")} onPress={() => safeBack(PLAYER_HOME_HREF)} testID="venue-back" />
            <View style={{ flexDirection: "row", gap: space[2] }}>
              <IconButton
                icon={Share2}
                variant="onPhoto"
                accessibilityLabel={copy("Venue share karein", "Share venue")}
                onPress={() => shareText(`${venue.name}${venue.area ? `, ${venue.area}` : ""} · Khelo`)}
              />
              {fav.enabled ? (
                <IconButton
                  icon={saved ? HeartFilled : Heart}
                  variant="onPhoto"
                  selected={saved}
                  accessibilityLabel={saved ? copy(`${venue.name} saved se hatayein`, `Remove ${venue.name} from saved`) : copy(`${venue.name} save karein`, `Save ${venue.name}`)}
                  onPress={() => fav.toggle(venue.id)}
                  testID="venue-save"
                />
              ) : null}
            </View>
          </View>
        }
      />

      <View style={{ marginTop: -44, backgroundColor: palette.ground, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, paddingTop: space[5], paddingHorizontal: space[5], gap: space[4] }}>
        <View style={{ gap: space[2] }}>
          <Text variant="h1" accessibilityRole="header" testID="venue-name">
            {venue.name}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {venue.review_count > 0 && venue.average_rating != null ? (
              <>
                <Star size={14} color={palette.orange} fill={palette.orange} />
                <Text variant="body" weight="black">
                  {venue.average_rating.toFixed(1)}
                </Text>
                <Text variant="body" tone="muted">
                  ({venue.review_count}){meta ? " ·" : ""}
                </Text>
              </>
            ) : null}
            {meta ? (
              <Text variant="body" tone="muted">
                {meta}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={{ flexDirection: "row", gap: space[2], flexWrap: "wrap" }}>
          <QuickAction icon={Navigation} label={copy("Raasta", "Directions")} onPress={() => openDirections(venue)} />
          {wa ? <QuickAction icon={MessageCircle} label="WhatsApp" onPress={() => openVenueWhatsApp(wa, copy(`Salam, ${venue.name} ke baare mein poochna tha.`, `Hi, a question about ${venue.name}.`))} /> : null}
          <QuickAction icon={Info} label={copy("Tafseel", "Details")} onPress={() => setInfoOpen(true)} testID="venue-details" />
        </View>

        <Card variant="raised" padding={4} radiusSize="cardL" style={{ gap: space[5] }} testID="venue-picker">
          <Text variant="h3" accessibilityRole="header">
            {copy("Slot book karo", "Book a slot")}
          </Text>

          {courts.length === 0 ? (
            <EmptyState title={copy("Abhi koi court live nahi", "No courts are live yet")} body={copy("Ye venue abhi booking nahi le raha.", "This venue isn't taking bookings yet.")} />
          ) : (
            <>
              <View style={{ gap: space[2] }}>
                <StepHeading n={1} label={copy("Court chunein", "Pick a court")} />
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
                  {courts.map((c) => (
                    <View key={c.id} style={{ flexGrow: 1, flexBasis: 140 }}>
                      <Chip
                        shape="tile"
                        block
                        label={c.name}
                        meta={[sportLabel(c.sport), c.is_indoor ? copy("Indoor", "Indoor") : copy("Outdoor", "Outdoor")].join(" · ")}
                        selected={c.id === court?.id}
                        onPress={() => chooseCourt(c.id)}
                        testID={`court-${c.id}`}
                      />
                    </View>
                  ))}
                </View>
              </View>

              <View style={{ gap: space[2] }}>
                <StepHeading n={2} label={copy("Din", "Day")} />
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>
                  {days.map((d) => (
                    <DayChip key={d} date={d} selected={d === date} state={dayState.get(d) ?? null} onPress={() => chooseDate(d)} testID={`day-${d}`} />
                  ))}
                </View>
              </View>

              <View style={{ gap: space[2] }}>
                <StepHeading n={3} label={copy("Kitni der", "How long")} />
                <SegmentedToggle
                  accessibilityLabel={copy("Kitni der", "How long")}
                  value={String(slotCount)}
                  onChange={(v) => setSlotCount(Number(v))}
                  options={durations.map((n) => ({ value: String(n), label: formatDuration(n * 30, lang) }))}
                  testID="venue-duration"
                />
              </View>

              <View style={{ gap: space[2] }}>
                <StepHeading
                  n={4}
                  label={copy("Kab shuru", "Start time")}
                  right={
                    fromPrice != null ? (
                      <Text variant="meta" tone="muted">
                        {copy(`${formatPkr(fromPrice)} se / 30 min`, `from ${formatPkr(fromPrice)} / 30 min`)}
                      </Text>
                    ) : null
                  }
                />
                {availQuery.isLoading ? (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }} accessibilityLabel={copy("Slots load ho rahe hain", "Loading slots")}>
                    {Array.from({ length: 9 }, (_, i) => (
                      <View key={i} style={{ flexGrow: 1, flexBasis: 90 }}>
                        <Skeleton height={48} r={radius.md} />
                      </View>
                    ))}
                  </View>
                ) : availQuery.isError ? (
                  <Banner
                    tone="danger"
                    title={copy("Slots load nahi hue", "Couldn't load the slots")}
                    body={friendlyErrorMessage(availQuery.error)}
                    action={<Button label={copy("Dobara koshish", "Try again")} size="sm" variant="soft" onPress={() => availQuery.refetch()} />}
                  />
                ) : model.items.length === 0 ? (
                  <Banner
                    tone="neutral"
                    title={slots.length > 0 ? copy("Aaj ke slots khatam", "No more times today") : copy("Is din band hai", "Closed this day")}
                    body={copy("Doosra din chunein.", "Pick another day.")}
                  />
                ) : (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }} testID="venue-slots">
                    {model.items.map((it, i) => {
                      const prev = model.items[i - 1];
                      const divider = it.slot.after_midnight && !prev?.slot.after_midnight;
                      return (
                        <View key={it.slot.starts_at} style={{ flexGrow: 1, flexBasis: 90, maxWidth: "100%" }}>
                          {divider ? (
                            <Text variant="eyebrow" tone="muted" style={{ paddingBottom: 4 }}>
                              {copy("RAAT 12 KE BAAD", "AFTER MIDNIGHT")}
                            </Text>
                          ) : null}
                          <SlotChip state={it.state} label={formatTime(it.slot.starts_at)} reason={it.slot.reason} onPress={() => tapSlot(it)} testID={`slot-${it.state}`} />
                        </View>
                      );
                    })}
                  </View>
                )}
                <SlotLegend />
              </View>
            </>
          )}
        </Card>

        <View style={{ gap: space[3] }}>
          <BlockTitle>{copy("Venue par", "At the venue")}</BlockTitle>
          {amenities.length > 0 ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
              {amenities.map((a) => (
                <Pill key={a} label={amenityLabel(a, lang)} tone="neutral" />
              ))}
            </View>
          ) : (
            <Text variant="meta" tone="muted">
              {copy("Venue ne abhi amenities nahi daali.", "The venue hasn't listed amenities yet.")}
            </Text>
          )}
          <Banner
            tone="info"
            body={copy(
              `${cancelPolicySentence(venue, lang) ?? ""} Pay karne tak slot aap ke liye hold rehta hai; kitni der, wo Pay screen par dikhega.`.trim(),
              `${cancelPolicySentence(venue, lang) ?? ""} The slot is held for you while you pay; the Pay screen shows how long.`.trim(),
            )}
          />
        </View>

        <ReviewsBlock venueId={venue.id} />
      </View>

      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={copy("Ek nazar dekh lein", "Check your booking")}
        testID="confirm-sheet"
        footer={
          <View style={{ gap: space[3] }}>
            <Button label={copy("Hold karo, phir pay", "Hold it, then pay")} block loading={holding} disabled={!quote} onPress={bookNow} testID="confirm-hold" />
            <Button
              label={copy("Pehle sawal poochna hai", "I have a question first")}
              variant="soft"
              size="md"
              block
              onPress={() => {
                setSheetOpen(false);
                openChat();
              }}
            />
          </View>
        }
      >
        {holdError ? <Banner tone="danger" title={holdError.title} body={holdError.body} testID="hold-error" /> : null}
        <MoneyRows
          testID="confirm-rows"
          rows={[
            { label: copy("Venue", "Venue"), value: venue.name },
            { label: copy("Court", "Court"), value: court ? `${court.name} · ${sportLabel(court.sport)}` : "" },
            { label: copy("Kab", "When"), value: whenLabel ?? "" },
            { label: copy("Kitni der", "Length"), value: quote ? formatDuration(quote.duration_minutes, lang) : durationLabel },
            ...(quote
              ? [
                  { label: copy("Total", "Total"), value: formatPkr(quote.price) },
                  { label: copy("Abhi bhejna (advance)", "Pay now (advance)"), value: formatPkr(quote.advance_amount), strong: true },
                  { label: copy("Venue par baqi", "Due at the venue"), value: formatPkr(quote.balance_due) },
                ]
              : []),
            ...(cancelPolicyShort(venue, lang) ? [{ label: copy("Cancel", "Cancel"), value: cancelPolicyShort(venue, lang)! }] : []),
          ]}
        />
        <Text variant="meta" tone="muted">
          {copy(
            "Hold hote hi bank details aur waqt Pay screen par milenge. Screenshot bhejne ke baad venue check karega; booking tab pakki hogi jab venue approve kare.",
            "Once held, the Pay screen shows the bank details and how long you have. After you send the screenshot the venue checks it; the booking is confirmed only when the venue approves.",
          )}
        </Text>
      </Sheet>

      <Sheet open={infoOpen} onClose={() => setInfoOpen(false)} title={venue.name} subtitle={venue.area ?? venue.city} testID="venue-info-sheet">
        {venue.description ? <Text variant="body">{venue.description}</Text> : null}
        <View style={{ flexDirection: "row", gap: space[3], alignItems: "flex-start" }}>
          <MapPin size={18} color={palette.muted} />
          <Text variant="body" style={{ flex: 1 }}>
            {[venue.address, venue.area, venue.city].filter(Boolean).join(", ")}
          </Text>
        </View>
        {venue.sports.length ? (
          <Text variant="meta" tone="muted">
            {venue.sports.map(sportLabel).join(" · ")}
          </Text>
        ) : null}
        {cancelPolicySentence(venue, lang) ? <Banner tone="info" title={copy("Cancel policy", "Cancellation policy")} body={cancelPolicySentence(venue, lang)!} /> : null}
        <Button label={copy("Raasta dekhein", "Get directions")} variant="soft" size="md" block onPress={() => openDirections(venue)} />
      </Sheet>
    </Screen>
  );
}

function HeartFilled(p: { size?: number; color?: string; strokeWidth?: number }) {
  return <Heart {...p} fill={p.color} />;
}

function QuickAction({ icon: Icon, label, onPress, testID }: { icon: typeof Info; label: string; onPress: () => void; testID?: string }) {
  return (
    <View style={{ flexGrow: 1, flexBasis: 90 }}>
      <Button label={label} variant="soft" size="sm" block onPress={onPress} icon={<Icon size={16} color={palette.night} />} testID={testID} />
    </View>
  );
}

/** Legend under the slot grid: each state shown with its own non-colour cue (tick, strike, dashed border). */
function SlotLegend() {
  const copy = useCopy();
  const items: { key: string; label: string; look: { bg: string; border: string; borderStyle: "solid" | "dashed"; borderWidth: number }; mark?: string; strike?: boolean }[] = [
    { key: "open", label: copy("Khaali", "Free"), look: slotLook.open },
    { key: "sel", label: copy("Aap ka", "Yours"), look: { bg: palette.orange, border: palette.night, borderStyle: "solid", borderWidth: 2 }, mark: "✓" },
    { key: "booked", label: copy("Booked", "Booked"), look: slotLook.booked, strike: true },
    { key: "held", label: copy("Kisi ne hold kiya", "Held by someone"), look: slotLook.held },
  ];
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[3], paddingTop: 2 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {items.map((it) => (
        <View key={it.key} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ width: 14, height: 14, borderRadius: 4, backgroundColor: it.look.bg, borderColor: it.look.border, borderWidth: Math.max(1, it.look.borderWidth), borderStyle: it.look.borderStyle, alignItems: "center", justifyContent: "center" }}>
            {it.mark ? (
              <Text variant="tab" style={{ fontSize: 9, lineHeight: 11 }}>
                {it.mark}
              </Text>
            ) : null}
          </View>
          <Text variant="caption" tone="muted" strike={it.strike}>
            {it.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

function ReviewsBlock({ venueId }: { venueId: string }) {
  const copy = useCopy();
  const lang = useLang();
  const [all, setAll] = useState(false);
  const q = useQuery({ queryKey: ["venue-reviews", venueId], queryFn: () => api.reviews.listForVenue(venueId) });
  const reviews: Review[] = (q.data ?? []).filter((r) => !r.is_hidden);
  const shown = all ? reviews : reviews.slice(0, 3);
  return (
    <View style={{ gap: space[3] }} testID="venue-reviews">
      <BlockTitle>{reviews.length ? copy(`Reviews (${reviews.length})`, `Reviews (${reviews.length})`) : copy("Reviews", "Reviews")}</BlockTitle>
      {q.isLoading ? (
        <Skeleton height={80} r={radius.tile} />
      ) : reviews.length === 0 ? (
        <Text variant="meta" tone="muted">
          {copy("Abhi koi review nahi. Khelne ke baad Bookings se review de sakte hain.", "No reviews yet. After you play, you can rate it from Bookings.")}
        </Text>
      ) : (
        <>
          {shown.map((r) => (
            <Card key={r.id} variant="flat" padding={4} radiusSize="tile" style={{ gap: space[2] }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space[2], flexWrap: "wrap" }}>
                <Text variant="bodyBold">{r.player_first_name ?? copy("Player", "Player")}</Text>
                <Text variant="meta" tone="muted" accessibilityLabel={copy(`${r.rating} mein se 5`, `${r.rating} of 5`)}>
                  {"★".repeat(r.rating)} · {formatDate(r.created_at, new Date(), lang)}
                </Text>
              </View>
              {r.comment ? <Text variant="body">{r.comment}</Text> : null}
              {r.owner_reply ? (
                <View style={{ backgroundColor: palette.ground, borderRadius: radius.sm, padding: space[3], gap: 2 }}>
                  <Text variant="caption" weight="bold" tone="muted">
                    {copy("Venue ka jawab", "Venue's reply")}
                  </Text>
                  <Text variant="meta">{r.owner_reply}</Text>
                </View>
              ) : null}
            </Card>
          ))}
          {reviews.length > 3 ? (
            <Button label={all ? copy("Kam dikhao", "Show fewer") : copy(`Sab ${reviews.length} reviews`, `All ${reviews.length} reviews`)} variant="soft" size="sm" onPress={() => setAll((v) => !v)} />
          ) : null}
        </>
      )}
    </View>
  );
}
