import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useIsFocused, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Hourglass, MessageCircle, Paperclip, Send } from "lucide-react-native";
import { ApiError } from "@court-booking/api-client";
import { chatActionLabel, formatDate, formatDuration, formatTime, formatTimeRange, type ChatAction } from "@court-booking/types";
import { countdown, fontFamily, formatPkr, palette, radius, shadow, size, space, type as typeScale } from "@court-booking/ui-tokens";

import { Avatar, Banner, Button, Chip, IconButton, Skeleton, Text, useCopy, useFontScale, useLang, useRoleTheme } from "@/components/ui";
import { api } from "@/lib/api";
import { useBookingFlowStore } from "@/lib/booking-flow-store";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { holdErrorCopy } from "@/lib/player-flow";
import { safeBack } from "@/lib/safe-back";
import { DateTile, openVenueWhatsApp, sportLabel, useBookingPlace, useNow, venueWhatsApp } from "../../_components";

interface Turn {
  id: string;
  sender: "player" | "ai";
  content: string;
  actions?: ChatAction[];
  /** When the message was sent/received (ms since epoch), shown under the bubble. */
  at: number;
}

/** "7:42 PM" for today's messages, "Wed, 23 Sep · 7:42 PM" for older ones (history opened days later). */
function stamp(at: number): string {
  const d = new Date(at);
  return formatDate(d) === formatDate(new Date()) ? formatTime(d) : `${formatDate(d)} · ${formatTime(d)}`;
}

/**
 * PChat board frame 2: the booking chat with the AI booking assistant (the same backend chat as the WhatsApp flow, no new
 * chat logic). Slot context bar, hold-proposal card (its Yes calls the direct hold, then Pay), hold timer pill from the
 * booking's real held_until, a "screenshot sent" note only when the booking really has one, quick replies and a
 * keyboard-aware composer. id = "new" starts a fresh question about a slot picked on the venue page.
 */
export default function BookingChatScreen() {
  const params = useLocalSearchParams<{
    id: string;
    venueId?: string;
    venueName?: string;
    courtId?: string;
    courtName?: string;
    courtSport?: string;
    startsAt?: string;
    price?: string;
    // How long the player chose on the venue page; absent means one slot.
    slotCount?: string;
    minutes?: string;
  }>();
  const copy = useCopy();
  const lang = useLang();
  const t = useRoleTheme();
  const scale = useFontScale();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const queryClient = useQueryClient();
  const now = useNow(1000);
  const slotCount = Math.max(1, Number(params.slotCount ?? 1) || 1);
  const minutes = Number(params.minutes ?? 0) || undefined;
  const isNew = params.id === "new";
  const setPaymentInstructions = useBookingFlowStore((s) => s.setPaymentInstructions);

  // An existing booking's chat: its real status / hold / venue for the context bar and the timer pill.
  const bookingQuery = useQuery({
    queryKey: ["booking", params.id],
    queryFn: () => api.bookings.get(params.id),
    enabled: !isNew,
    refetchInterval: (q) => (q.state.data?.status === "held" || q.state.data?.status === "payment_submitted" ? 10_000 : false),
    subscribed: focused,
  });
  const booking = bookingQuery.data;
  const place = useBookingPlace(booking);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(!isNew);
  const [holdingActionKey, setHoldingActionKey] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  // The opening question must be sent ONCE (React's dev mode runs an effect twice on mount, which asked the paid AI
  // twice and showed the answer twice); the ref survives that simulated remount.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      if (!isNew) {
        try {
          const history = await api.chat.history({ booking_id: params.id });
          setTurns(history.map((h) => ({ id: h.id, sender: h.sender_type === "player" ? "player" : "ai", content: h.content, at: new Date(h.created_at).getTime() })));
        } catch (e) {
          setBootError(friendlyErrorMessage(e));
        } finally {
          setHistoryLoading(false);
        }
        return;
      }
      // Fresh context from a slot tap: ask the AI about this exact slot so the reply (and its actions[]) is real. venue_id
      // is only used for history filtering, so the venue name is spelled out; the exact date avoids a wrong "Wednesday".
      const when = params.startsAt ? new Date(params.startsAt) : null;
      const question = when
        ? `Is ${params.courtName || "a court"} at ${params.venueName || "this venue"} available on ${formatDate(when)} at ${formatTime(when)}${minutes ? ` for ${formatDuration(minutes)}` : ""}?`
        : params.venueName
          ? `What's available at ${params.venueName}?`
          : "What's available?";
      setTurns([{ id: "local-0", sender: "player", content: question, at: Date.now() }]);
      setSending(true);
      try {
        const res = await api.chat.send({ message: question, venue_id: params.venueId, channel: "app" });
        setTurns((x) => [...x, { id: "local-1", sender: "ai", content: res.reply, actions: res.actions, at: Date.now() }]);
      } catch (e) {
        setBootError(friendlyErrorMessage(e));
      } finally {
        setSending(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [turns, sending]);

  async function sendMessage(override?: string) {
    const text = (override ?? input).trim();
    if (!text || sending) return;
    setInput("");
    setTurns((x) => [...x, { id: `local-${Date.now()}`, sender: "player", content: text, at: Date.now() }]);
    setSending(true);
    try {
      const res = await api.chat.send({ message: text, venue_id: params.venueId ?? place.venue?.id, booking_id: isNew ? undefined : params.id, channel: "app" });
      setTurns((x) => [...x, { id: `local-${Date.now()}-ai`, sender: "ai", content: res.reply, actions: res.actions, at: Date.now() }]);
      void queryClient.invalidateQueries({ queryKey: ["chat-history", params.id] });
    } catch (e) {
      setTurns((x) => [...x, { id: `local-${Date.now()}-err`, sender: "ai", content: friendlyErrorMessage(e), at: Date.now() }]);
    } finally {
      setSending(false);
    }
  }

  async function handleAction(turnId: string, action: ChatAction) {
    if (action.type === "decline") {
      setTurns((x) => [...x, { id: `local-${Date.now()}`, sender: "ai", content: copy("Koi baat nahi. Koi aur waqt dekhna ho to batayein.", "No problem. Tell me if you want to look at another time."), at: Date.now() }]);
      return;
    }
    if (action.type !== "confirm_booking") return;
    const key = `${turnId}-${action.label}`;
    setHoldingActionKey(key);
    try {
      const courtId = String(action.data.court_id ?? params.courtId);
      const startsAt = String(action.data.starts_at ?? params.startsAt);
      // The Yes button carries the length the assistant quoted; fall back to what was picked before the chat.
      const holdSlotCount = Number(action.data.slot_count ?? slotCount) || 1;
      // A name the player gave in the chat (their own or a friend's) rides on the Yes button; the server tidies it.
      const holdPlayerName = typeof action.data.player_name === "string" ? action.data.player_name.trim() : "";
      const { booking: b, payment_instructions } = await api.bookings.hold({
        court_id: courtId,
        starts_at: startsAt,
        slot_count: holdSlotCount,
        ...(holdPlayerName ? { player_name: holdPlayerName } : {}),
        // The server saves the name on the account only when this hold is created AND it is the player's own name.
        ...(holdPlayerName && action.data.name_is_players_own === true ? { name_is_own: true } : {}),
      });
      if (payment_instructions) setPaymentInstructions(b.id, payment_instructions);
      queryClient.setQueryData(["booking", b.id], b);
      void queryClient.invalidateQueries({ queryKey: ["bookings-mine"] });
      router.replace({ pathname: "/(player)/booking/[id]/pay", params: { id: b.id } });
    } catch (e) {
      const c = holdErrorCopy(e instanceof ApiError ? e.code : null, lang, friendlyErrorMessage(e));
      setTurns((x) => [...x, { id: `local-${Date.now()}-holderr`, sender: "ai", content: `${c.title}. ${c.body}`, at: Date.now() }]);
    } finally {
      setHoldingActionKey(null);
    }
  }

  // Context bar: an existing booking's real slot, or the slot picked on the venue page.
  const ctxStart = booking?.starts_at ?? params.startsAt ?? null;
  const ctxEnd = booking?.ends_at ?? (params.startsAt && minutes ? new Date(Date.parse(params.startsAt) + minutes * 60_000).toISOString() : null);
  const ctxCourt = place.court ? `${place.court.name} · ${sportLabel(place.court.sport)}` : params.courtName ? `${params.courtName}${params.courtSport ? ` · ${sportLabel(params.courtSport)}` : ""}` : null;
  const ctxPrice = booking ? booking.price : params.price ? Number(params.price) : null;
  const venueName = place.venue?.name ?? params.venueName ?? copy("Booking assistant", "Booking assistant");
  const wa = venueWhatsApp(place.venue);
  const hold = booking?.status === "held" && booking.held_until ? countdown(booking.held_until, now) : null;

  const last = turns[turns.length - 1];
  const showQuickReplies = !sending && !holdingActionKey && !bootError && last?.sender === "ai" && !(last.actions && last.actions.length > 0);
  const quickReplies = [copy("Aur kaun se waqt khaali hain?", "What other times are free?"), copy("Kal ka dikhayein", "Show me tomorrow"), copy("Cancel policy kya hai?", "What's the cancel policy?")];
  const canSend = !sending && input.trim().length > 0;

  return (
    <View style={{ flex: 1, backgroundColor: palette.ground }} testID="chat-screen">
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ paddingTop: insets.top + space[2], paddingHorizontal: space[4], paddingBottom: space[3], backgroundColor: palette.white, borderBottomWidth: 1, borderBottomColor: palette.line, gap: space[3] }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space[3] }}>
            <IconButton icon={ArrowLeft} variant="mist" accessibilityLabel={copy("Wapas", "Back")} onPress={() => safeBack()} testID="chat-back" />
            <Avatar name={venueName} size={40} tone="orange" />
            <View style={{ flex: 1, gap: 1 }}>
              <Text variant="bodyStrong" accessibilityRole="header">
                {venueName}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: palette.open }} />
                <Text variant="caption" tone="muted">
                  {copy("Booking assistant · fori jawab", "Booking assistant · replies instantly")}
                </Text>
              </View>
            </View>
            {wa ? <IconButton icon={MessageCircle} variant="mist" accessibilityLabel={copy("Venue ko WhatsApp par likhein", "Message the venue on WhatsApp")} onPress={() => openVenueWhatsApp(wa)} /> : null}
          </View>
          {ctxStart ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: space[3], backgroundColor: palette.ground, borderRadius: radius.input, padding: space[2], flexWrap: "wrap" }} testID="chat-context">
              <DateTile iso={ctxStart} variant="orange" />
              <View style={{ flex: 1, minWidth: 140, gap: 2 }}>
                {ctxCourt ? <Text variant="bodyBold">{ctxCourt}</Text> : null}
                <Text variant="meta" tone="muted">
                  {[ctxEnd ? formatTimeRange(ctxStart, ctxEnd, lang) : formatTime(ctxStart), minutes ? formatDuration(minutes, lang) : null].filter(Boolean).join(" · ")}
                </Text>
              </View>
              {ctxPrice != null && Number.isFinite(ctxPrice) ? <Text variant="bodyStrong">{formatPkr(ctxPrice)}</Text> : null}
            </View>
          ) : null}
        </View>

        <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ padding: space[4], gap: space[3] }} keyboardShouldPersistTaps="handled">
          {historyLoading ? (
            <View style={{ gap: space[3] }}>
              <Skeleton width="70%" height={52} r={radius.button} />
              <Skeleton width="60%" height={52} r={radius.button} style={{ alignSelf: "flex-end" }} />
            </View>
          ) : null}
          {!historyLoading && !isNew && turns.length === 0 && !bootError ? (
            <Text variant="meta" tone="muted" align="center">
              {copy("Is booking ke baare mein abhi koi baat nahi hui. Neeche likh kar poochein.", "No messages about this booking yet. Ask below.")}
            </Text>
          ) : null}
          {turns.map((turn) => {
            const mine = turn.sender === "player";
            return (
              <View key={turn.id} style={{ alignItems: mine ? "flex-end" : "flex-start", gap: 4 }} accessibilityLabel={mine ? copy("Aap ka message", "Your message") : copy("Assistant ka message", "Assistant message")}>
                <View
                  style={{
                    maxWidth: "86%",
                    paddingHorizontal: space[4],
                    paddingVertical: space[3],
                    backgroundColor: mine ? t.primary.bg : palette.white,
                    borderRadius: radius.button,
                    borderBottomRightRadius: mine ? 6 : radius.button,
                    borderBottomLeftRadius: mine ? radius.button : 6,
                    boxShadow: mine ? undefined : shadow.card,
                  }}
                >
                  <Text variant="bodyL" color={mine ? t.primary.fg : palette.night}>
                    {turn.content}
                  </Text>
                </View>
                <Text variant="caption" tone="muted">
                  {stamp(turn.at)}
                </Text>
                {turn.actions && turn.actions.length > 0 ? <ProposalCard turnId={turn.id} actions={turn.actions} holdingKey={holdingActionKey} onAction={handleAction} /> : null}
              </View>
            );
          })}
          {hold && !hold.expired ? (
            <View style={{ alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 6, minHeight: 32, paddingHorizontal: space[3], borderRadius: radius.pill, backgroundColor: palette.waitingTint }} testID="chat-hold-pill">
              <Hourglass size={14} color={palette.waiting} />
              <Text variant="caption" weight="black" tone="waiting">
                {copy(`Slot hold · ${hold.label} baqi`, `Slot held · ${hold.label} left`)}
              </Text>
            </View>
          ) : null}
          {booking && (booking.status === "payment_submitted" || booking.status === "booked") ? (
            <View style={{ alignSelf: "flex-end", flexDirection: "row", alignItems: "center", gap: 6, minHeight: 36, paddingHorizontal: space[3], borderRadius: radius.md, backgroundColor: palette.openTint }} testID="chat-proof-note">
              <Check size={14} color={palette.open} strokeWidth={3} />
              <Text variant="caption" weight="black" tone="open">
                {copy("Screenshot bheja", "Screenshot sent")}
              </Text>
            </View>
          ) : null}
          {sending ? (
            <View style={{ alignSelf: "flex-start", paddingHorizontal: space[4], paddingVertical: space[3], backgroundColor: palette.white, borderRadius: radius.button }} accessibilityLabel={copy("Assistant likh raha hai", "The assistant is typing")}>
              <Skeleton width={46} height={10} r={5} />
            </View>
          ) : null}
          {showQuickReplies ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }} accessibilityLabel={copy("Fori jawab", "Quick replies")}>
              {quickReplies.map((q) => (
                <Chip key={q} label={q} onPress={() => sendMessage(q)} />
              ))}
            </View>
          ) : null}
          {bootError ? <Banner tone="danger" body={bootError} /> : null}
        </ScrollView>

        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: space[2], paddingHorizontal: space[3], paddingTop: space[2], paddingBottom: Math.max(insets.bottom, space[3]), backgroundColor: palette.white, borderTopWidth: 1, borderTopColor: palette.line }}>
          {booking?.status === "held" ? (
            <IconButton icon={Paperclip} variant="mist" accessibilityLabel={copy("Payment screenshot lagayein", "Attach the payment screenshot")} onPress={() => router.push({ pathname: "/(player)/booking/[id]/pay", params: { id: booking.id } })} />
          ) : null}
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={copy("Waqt, court ya qeemat poochein…", "Ask about times, courts or prices…")}
            placeholderTextColor={palette.muted2}
            accessibilityLabel={copy("Message", "Message")}
            onSubmitEditing={() => sendMessage()}
            editable={!sending}
            returnKeyType="send"
            multiline
            testID="chat-input"
            style={{ flex: 1, minHeight: size.tap, maxHeight: 120, borderRadius: radius.button, borderWidth: 1.5, borderColor: palette.lineStrong, backgroundColor: palette.ground, paddingHorizontal: space[4], paddingVertical: 10, fontFamily: fontFamily.mobile.body, fontSize: typeScale.bodyL.size * scale, color: palette.night, outlineStyle: "none" } as never}
          />
          <IconButton icon={Send} variant={canSend ? "primary" : "mist"} disabled={!canSend} accessibilityLabel={copy("Bhejein", "Send")} onPress={() => sendMessage()} testID="chat-send" />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

/** The assistant's hold proposal (confirm_booking action): its own card, honest about what "hold" means. */
function ProposalCard({ turnId, actions, holdingKey, onAction }: { turnId: string; actions: ChatAction[]; holdingKey: string | null; onAction: (turnId: string, a: ChatAction) => void }) {
  const copy = useCopy();
  const confirm = actions.find((a) => a.type === "confirm_booking");
  const others = actions.filter((a) => a !== confirm);
  return (
    <View style={{ maxWidth: "92%", backgroundColor: palette.white, borderRadius: radius.tile, borderWidth: 2, borderColor: palette.orangeTint, padding: space[4], gap: space[3] }} testID="chat-proposal">
      {confirm ? (
        <>
          <Text variant="bodyStrong">{copy("Ye slot hold karein?", "Hold this slot?")}</Text>
          <Text variant="meta" tone="muted">
            {typeof confirm.data.label === "string" && confirm.data.label ? `${confirm.data.label}. ` : ""}
            {copy("Hold ke baad Pay screen par bank details aur waqt milega. Booking tab pakki hogi jab venue approve kare.", "After the hold, the Pay screen shows the bank details and how long you have. It is confirmed only when the venue approves.")}
          </Text>
        </>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
        {confirm ? (
          <Button
            label={copy("Haan, hold karo", "Yes, hold it")}
            accessibilityLabel={chatActionLabel(confirm)}
            size="sm"
            loading={holdingKey === `${turnId}-${confirm.label}`}
            disabled={!!holdingKey && holdingKey !== `${turnId}-${confirm.label}`}
            onPress={() => onAction(turnId, confirm)}
            testID="chat-hold-yes"
          />
        ) : null}
        {others.map((a) => (
          <Button key={a.label} label={a.type === "decline" ? copy("Nahi", "No") : chatActionLabel(a)} variant="soft" size="sm" disabled={!!holdingKey} onPress={() => onAction(turnId, a)} />
        ))}
      </View>
    </View>
  );
}

