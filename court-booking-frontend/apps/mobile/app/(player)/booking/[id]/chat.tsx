import { useEffect, useRef, useState } from "react";
import { courtLabel } from "@/components/court-label";
import { ActivityIndicator, Animated, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import Svg, { Path } from "react-native-svg";

import { api } from "@/lib/api";
import { ApiError } from "@court-booking/api-client";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatDate, formatPKR, formatTime, formatTimeRange } from "@/lib/format";
import { formatDuration } from "@court-booking/types";
import { useBookingFlowStore } from "@/lib/booking-flow-store";
import { ChevronLeftIcon } from "@/components/icons";
import { chatActionLabel, type ChatAction } from "@court-booking/types";

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

/** Offered under an assistant reply that carries no buttons, so a player is never stuck typing from scratch. */
const QUICK_REPLIES = ["What other times are free?", "Show me tomorrow", "Is another court open then?"];

function AssistantAvatar() {
  return (
    <View
      className="w-8 h-8 rounded-full items-center justify-center border border-player-accent-soft-border bg-player-accent-soft"
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <Svg width={17} height={17} viewBox="0 0 24 24" fill="none">
        <Path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" stroke="#EF5A2C" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M8.5 12h.01M12 12h.01M15.5 12h.01" stroke="#EF5A2C" strokeWidth={2.2} strokeLinecap="round" />
      </Svg>
    </View>
  );
}

/** Three bouncing dots in an assistant bubble while a reply is on its way. */
function TypingBubble() {
  const dots = useRef([new Animated.Value(0), new Animated.Value(0), new Animated.Value(0)]).current;
  useEffect(() => {
    const loops = dots.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 150),
          Animated.timing(v, { toValue: 1, duration: 280, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0, duration: 280, useNativeDriver: true }),
          Animated.delay(450 - i * 150),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [dots]);
  return (
    <View className="flex-row items-end gap-2" accessibilityLabel="The assistant is typing">
      <AssistantAvatar />
      <View
        className="flex-row items-center gap-1.5 px-4 py-3.5 bg-player-surface border border-player-border-light"
        style={{ borderRadius: 18, borderBottomLeftRadius: 6 }}
      >
        {dots.map((v, i) => (
          // explicit sizes: NativeWind does not style an Animated.View from className
          <Animated.View
            key={i}
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: "#9A9791",
              transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -5] }) }],
            }}
          />
        ))}
      </View>
    </View>
  );
}

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
    // How long the player chose in the duration sheet (Section 32 Part 4); absent means one slot.
    slotCount?: string;
    minutes?: string;
  }>();
  const slotCount = Math.max(1, Number(params.slotCount ?? 1) || 1);
  const minutes = Number(params.minutes ?? 0) || undefined;
  const isNew = params.id === "new";
  const setPaymentInstructions = useBookingFlowStore((s) => s.setPaymentInstructions);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
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
          setTurns(
            history.map((h) => ({
              id: h.id,
              sender: h.sender_type === "player" ? "player" : "ai",
              content: h.content,
              at: new Date(h.created_at).getTime(),
            })),
          );
        } catch (e) {
          setBootError(friendlyErrorMessage(e));
        }
        return;
      }
      // Fresh context from a slot tap -- ask the AI about this exact slot rather than
      // faking a canned opening line, so the reply (and its actions[]) is real. venue_id
      // is only used for chat-history filtering, not fed to the model, so the venue name
      // has to be spelled out in the message itself or the AI can't resolve which venue.
      // A relative phrase like "Wednesday" is ambiguous to the model (it isn't told
      // today's date) and can resolve to the wrong week entirely -- spell out the exact
      // calendar date instead.
      const when = params.startsAt ? new Date(params.startsAt) : null;
      const question = when
        ? `Is ${params.courtName || "a court"} at ${params.venueName || "this venue"} available on ${formatDate(when)} at ${formatTime(when)}${
            minutes ? ` for ${formatDuration(minutes)}` : ""
          }?`
        : "What's available?";
      setTurns([{ id: "local-0", sender: "player", content: question, at: Date.now() }]);
      setSending(true);
      try {
        const res = await api.chat.send({ message: question, venue_id: params.venueId, channel: "app" });
        setTurns((t) => [...t, { id: "local-1", sender: "ai", content: res.reply, actions: res.actions, at: Date.now() }]);
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
    setTurns((t) => [...t, { id: `local-${Date.now()}`, sender: "player", content: text, at: Date.now() }]);
    setSending(true);
    try {
      const res = await api.chat.send({
        message: text,
        venue_id: params.venueId,
        booking_id: isNew ? undefined : params.id,
        channel: "app",
      });
      setTurns((t) => [...t, { id: `local-${Date.now()}-ai`, sender: "ai", content: res.reply, actions: res.actions, at: Date.now() }]);
    } catch (e) {
      setTurns((t) => [...t, { id: `local-${Date.now()}-err`, sender: "ai", content: friendlyErrorMessage(e), at: Date.now() }]);
    } finally {
      setSending(false);
    }
  }

  async function handleAction(turnId: string, action: ChatAction) {
    if (action.type === "decline") {
      setTurns((t) => [
        ...t,
        { id: `local-${Date.now()}`, sender: "ai", content: "No problem — let me know if you want to look at another time.", at: Date.now() },
      ]);
      return;
    }
    if (action.type !== "confirm_booking") return;
    const key = `${turnId}-${action.label}`;
    setHoldingActionKey(key);
    try {
      const courtId = String(action.data.court_id ?? params.courtId);
      const startsAt = String(action.data.starts_at ?? params.startsAt);
      // The Yes button the assistant showed carries the length it quoted; fall back to what was picked before the chat.
      const holdSlotCount = Number(action.data.slot_count ?? slotCount) || 1;
      // A name the player gave in the chat (their own or a friend's) rides on the Yes button; the server tidies it.
      const holdPlayerName = typeof action.data.player_name === "string" ? action.data.player_name.trim() : "";
      const { booking, payment_instructions } = await api.bookings.hold({
        court_id: courtId,
        starts_at: startsAt,
        slot_count: holdSlotCount,
        ...(holdPlayerName ? { player_name: holdPlayerName } : {}),
        // The server saves the name on the account only when this hold is created AND it is the player's own name.
        ...(holdPlayerName && action.data.name_is_players_own === true ? { name_is_own: true } : {}),
      });
      if (payment_instructions) setPaymentInstructions(booking.id, payment_instructions);
      router.replace({ pathname: "/(player)/booking/[id]/pay", params: { id: booking.id } });
    } catch (e) {
      const message =
        e instanceof ApiError && e.code === "SLOT_ALREADY_TAKEN"
          ? "Someone just booked this slot first — pick another time."
          : friendlyErrorMessage(e);
      setTurns((t) => [...t, { id: `local-${Date.now()}-holderr`, sender: "ai", content: message, at: Date.now() }]);
    } finally {
      setHoldingActionKey(null);
    }
  }

  const when = params.startsAt ? new Date(params.startsAt) : null;
  const last = turns[turns.length - 1];
  const showQuickReplies = !sending && !holdingActionKey && !bootError && last?.sender === "ai" && !(last.actions && last.actions.length > 0);
  const canSend = !sending && input.trim().length > 0;

  return (
    <SafeAreaView className="flex-1 bg-player-bg" edges={["top", "bottom"]}>
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View className="px-5 py-3.5 bg-player-surface border-b border-player-border-light flex-row items-center gap-3">
          <Pressable
            onPress={() => router.back()}
            accessibilityLabel="Back"
            className="w-11 h-11 rounded-xl bg-player-surface-2 items-center justify-center active:opacity-70"
          >
            <ChevronLeftIcon />
          </Pressable>
          <AssistantAvatar />
          <View className="flex-1 gap-0.5">
            <Text className="font-figtree-bold text-player-ink text-base" numberOfLines={1}>
              {params.venueName ?? "Booking assistant"}
            </Text>
            <View className="flex-row items-center gap-1.5">
              <View className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#1F7A52" }} />
              <Text className="font-figtree-medium text-player-ink-faint text-[12.5px]">Booking assistant · replies instantly</Text>
            </View>
          </View>
        </View>

        {params.courtName && when ? (
          <View className="px-5 py-3 bg-player-accent-soft border-b border-player-accent-soft-border flex-row items-center justify-between gap-3">
            <View className="flex-1 gap-0.5">
              <Text className="font-figtree-bold text-[11px] tracking-[0.1em]" style={{ color: "#C8431C" }}>
                SELECTED SLOT
              </Text>
              <Text className="font-mono-semibold text-player-ink text-[13.5px]">
                {courtLabel(params.courtName, params.courtSport)} · {formatDate(when)}, {minutes ? formatTimeRange(when, new Date(when.getTime() + minutes * 60_000)) : formatTime(when)}
                {minutes ? ` · ${formatDuration(minutes)}` : ""}
              </Text>
            </View>
            {params.price ? (
              <View className="px-3 py-1 rounded-full bg-player-surface">
                <Text className="font-mono-semibold text-player-ink text-[13.5px]">PKR {formatPKR(Number(params.price))}</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        <ScrollView ref={scrollRef} className="flex-1" contentContainerClassName="px-5 py-5 gap-4" keyboardShouldPersistTaps="handled">
          {turns.map((turn) => {
            const mine = turn.sender === "player";
            return (
              <View key={turn.id} style={{ alignItems: mine ? "flex-end" : "flex-start" }} className="gap-1.5" accessibilityLabel={mine ? "Your message" : "Assistant message"}>
                <View className="flex-row items-end gap-2" style={{ maxWidth: "88%", flexDirection: mine ? "row-reverse" : "row" }}>
                  {mine ? null : <AssistantAvatar />}
                  <View
                    className="px-4 py-2.5"
                    style={{
                      backgroundColor: mine ? "#EF5A2C" : "#FFFFFF",
                      borderRadius: 18,
                      borderBottomRightRadius: mine ? 6 : 18,
                      borderBottomLeftRadius: mine ? 18 : 6,
                      borderWidth: mine ? 0 : 1,
                      borderColor: "#EBE5E1",
                      flexShrink: 1,
                    }}
                  >
                    <Text className="font-figtree-medium text-[15px] leading-[22px]" style={{ color: mine ? "#FFFFFF" : "#141A1D" }}>
                      {turn.content}
                    </Text>
                  </View>
                </View>
                <Text className="font-figtree-medium text-player-ink-fainter text-[11.5px]" style={{ paddingLeft: mine ? 0 : 40, paddingRight: mine ? 4 : 0 }}>
                  {stamp(turn.at)}
                </Text>
                {turn.actions && turn.actions.length > 0 ? (
                  <View className="flex-row flex-wrap gap-2 mt-1" style={{ paddingLeft: 40 }}>
                    {turn.actions.map((action) => {
                      const key = `${turn.id}-${action.label}`;
                      const isHolding = holdingActionKey === key;
                      const confirm = action.type === "confirm_booking";
                      return (
                        <Pressable
                          key={key}
                          onPress={() => handleAction(turn.id, action)}
                          disabled={!!holdingActionKey}
                          className="px-4 min-h-11 py-2 rounded-xl items-center justify-center flex-row gap-2 active:opacity-80"
                          style={{
                            backgroundColor: confirm ? "#EF5A2C" : "#FFFFFF",
                            borderWidth: confirm ? 0 : 1,
                            borderColor: "#E0D9D4",
                            opacity: holdingActionKey && !isHolding ? 0.5 : 1,
                            ...(confirm ? { shadowColor: "#EF5A2C", shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 4 } : null),
                          }}
                        >
                          {isHolding ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
                          <Text className="font-figtree-bold text-[13.5px]" style={{ color: confirm ? "#FFFFFF" : "#5C544D" }}>
                            {isHolding ? "Holding…" : chatActionLabel(action)}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            );
          })}
          {sending ? <TypingBubble /> : null}
          {showQuickReplies ? (
            <View className="flex-row flex-wrap gap-2" style={{ paddingLeft: 40 }} accessibilityLabel="Quick replies">
              {QUICK_REPLIES.map((q) => (
                <Pressable
                  key={q}
                  onPress={() => sendMessage(q)}
                  className="px-3.5 py-2 rounded-full bg-player-surface border border-player-accent-soft-border active:bg-player-accent-soft"
                >
                  <Text className="font-figtree-semibold text-[13px]" style={{ color: "#C8431C" }}>
                    {q}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {bootError ? <Text className="font-figtree-medium text-player-danger text-sm text-center">{bootError}</Text> : null}
        </ScrollView>

        <View className="px-4 pt-3 pb-3 bg-player-surface border-t border-player-border-light">
          <View className="flex-row items-center gap-2 rounded-full border border-player-border bg-player-bg pl-5 pr-1.5 py-1.5">
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder="Ask about times, courts or prices…"
              placeholderTextColor="#9A9791"
              accessibilityLabel="Message"
              className="flex-1 font-figtree-medium"
              style={{ height: 40, fontSize: 15, color: "#141A1D" }}
              onSubmitEditing={() => sendMessage()}
              editable={!sending}
              returnKeyType="send"
            />
            <Pressable
              onPress={() => sendMessage()}
              disabled={!canSend}
              accessibilityLabel="Send message"
              className="w-10 h-10 rounded-full items-center justify-center active:opacity-80"
              style={{ backgroundColor: canSend ? "#EF5A2C" : "#E5DED8" }}
            >
              <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                <Path d="M5 12h14M13 6l6 6-6 6" stroke="#FFFFFF" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
