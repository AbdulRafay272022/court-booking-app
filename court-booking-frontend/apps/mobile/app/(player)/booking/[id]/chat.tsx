import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";

import { api } from "@/lib/api";
import { ApiError } from "@court-booking/api-client";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatDate, formatPKR, formatTime } from "@/lib/format";
import { useBookingFlowStore } from "@/lib/booking-flow-store";
import { ChevronLeftIcon } from "@/components/icons";
import type { ChatAction } from "@court-booking/types";

interface Turn {
  id: string;
  sender: "player" | "ai";
  content: string;
  actions?: ChatAction[];
}

export default function BookingChatScreen() {
  const params = useLocalSearchParams<{
    id: string;
    venueId?: string;
    venueName?: string;
    courtId?: string;
    courtName?: string;
    startsAt?: string;
    price?: string;
  }>();
  const isNew = params.id === "new";
  const setPaymentInstructions = useBookingFlowStore((s) => s.setPaymentInstructions);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [holdingActionKey, setHoldingActionKey] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    (async () => {
      if (!isNew) {
        try {
          const history = await api.chat.history({ booking_id: params.id });
          setTurns(
            history.map((h) => ({ id: h.id, sender: h.sender_type === "player" ? "player" : "ai", content: h.content })),
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
        ? `Is ${params.courtName || "a court"} at ${params.venueName || "this venue"} available on ${formatDate(when)} at ${formatTime(when)}?`
        : "What's available?";
      setTurns([{ id: "local-0", sender: "player", content: question }]);
      setSending(true);
      try {
        const res = await api.chat.send({ message: question, venue_id: params.venueId, channel: "app" });
        setTurns((t) => [...t, { id: "local-1", sender: "ai", content: res.reply, actions: res.actions }]);
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
  }, [turns]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setTurns((t) => [...t, { id: `local-${Date.now()}`, sender: "player", content: text }]);
    setSending(true);
    try {
      const res = await api.chat.send({
        message: text,
        venue_id: params.venueId,
        booking_id: isNew ? undefined : params.id,
        channel: "app",
      });
      setTurns((t) => [...t, { id: `local-${Date.now()}-ai`, sender: "ai", content: res.reply, actions: res.actions }]);
    } catch (e) {
      setTurns((t) => [...t, { id: `local-${Date.now()}-err`, sender: "ai", content: friendlyErrorMessage(e) }]);
    } finally {
      setSending(false);
    }
  }

  async function handleAction(turnId: string, action: ChatAction) {
    if (action.type === "decline") {
      setTurns((t) => [...t, { id: `local-${Date.now()}`, sender: "ai", content: "No problem — let me know if you want to look at another time." }]);
      return;
    }
    if (action.type !== "confirm_booking") return;
    const key = `${turnId}-${action.label}`;
    setHoldingActionKey(key);
    try {
      const courtId = String(action.data.court_id ?? params.courtId);
      const startsAt = String(action.data.starts_at ?? params.startsAt);
      const { booking, payment_instructions } = await api.bookings.hold({ court_id: courtId, starts_at: startsAt });
      if (payment_instructions) setPaymentInstructions(booking.id, payment_instructions);
      router.replace({ pathname: "/(player)/booking/[id]/pay", params: { id: booking.id } });
    } catch (e) {
      const message =
        e instanceof ApiError && e.code === "SLOT_ALREADY_TAKEN"
          ? "Someone just booked this slot first — pick another time."
          : friendlyErrorMessage(e);
      setTurns((t) => [...t, { id: `local-${Date.now()}-holderr`, sender: "ai", content: message }]);
    } finally {
      setHoldingActionKey(null);
    }
  }

  const when = params.startsAt ? new Date(params.startsAt) : null;

  return (
    <SafeAreaView className="flex-1 bg-player-bg" edges={["top", "bottom"]}>
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View className="px-5 py-4.5 bg-player-surface border-b border-player-border-light flex-row items-center gap-3">
          <Pressable onPress={() => router.back()} className="w-11 h-11 rounded-xl bg-player-surface-2 items-center justify-center">
            <ChevronLeftIcon />
          </Pressable>
          <View className="gap-0.5">
            <Text className="font-figtree-bold text-player-ink text-base">{params.venueName ?? "Booking assistant"}</Text>
            <View className="flex-row items-center gap-1.5">
              <View className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#1F7A52" }} />
              <Text className="font-figtree-medium text-player-ink-faint text-[12.5px]">Booking assistant</Text>
            </View>
          </View>
        </View>

        {params.courtName && when ? (
          <View className="px-5 py-3.5 bg-player-accent-soft border-b border-player-accent-soft-border flex-row items-center justify-between">
            <View className="gap-0.5">
              <Text className="font-figtree-bold text-[11px] tracking-[0.1em]" style={{ color: "#C8431C" }}>
                SELECTED SLOT
              </Text>
              <Text className="font-mono-semibold text-player-ink text-[14.5px]">
                {params.courtName} · {formatDate(when)}, {formatTime(when)}
              </Text>
            </View>
            {params.price ? <Text className="font-mono-semibold text-player-ink text-base">{formatPKR(Number(params.price))}</Text> : null}
          </View>
        ) : null}

        <ScrollView ref={scrollRef} className="flex-1" contentContainerClassName="p-5 gap-3.5">
          {turns.map((turn) => (
            <View key={turn.id} style={{ alignSelf: turn.sender === "player" ? "flex-end" : "flex-start", maxWidth: "82%" }}>
              <View
                className="px-4 py-3"
                style={{
                  backgroundColor: turn.sender === "player" ? "#141A1D" : "#FFFFFF",
                  borderRadius: 16,
                  borderTopRightRadius: turn.sender === "player" ? 4 : 16,
                  borderTopLeftRadius: turn.sender === "player" ? 16 : 4,
                  borderWidth: turn.sender === "player" ? 0 : 1,
                  borderColor: "#EBE5E1",
                }}
              >
                <Text
                  className="font-figtree-medium text-[14.5px] leading-[1.5]"
                  style={{ color: turn.sender === "player" ? "#FFFFFF" : "#141A1D" }}
                >
                  {turn.content}
                </Text>
              </View>
              {turn.actions && turn.actions.length > 0 ? (
                <View className="flex-row flex-wrap gap-2 mt-2">
                  {turn.actions.map((action) => {
                    const key = `${turn.id}-${action.label}`;
                    const isHolding = holdingActionKey === key;
                    return (
                      <Pressable
                        key={key}
                        onPress={() => handleAction(turn.id, action)}
                        disabled={!!holdingActionKey}
                        className="px-4 h-11 rounded-xl items-center justify-center flex-row gap-2"
                        style={{
                          backgroundColor: action.type === "confirm_booking" ? "#EF5A2C" : "#FFFFFF",
                          borderWidth: action.type === "confirm_booking" ? 0 : 1,
                          borderColor: "#E0D9D4",
                          opacity: holdingActionKey && !isHolding ? 0.5 : 1,
                        }}
                      >
                        {isHolding ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
                        <Text
                          className="font-figtree-bold text-[13.5px]"
                          style={{ color: action.type === "confirm_booking" ? "#FFFFFF" : "#5C544D" }}
                        >
                          {action.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
            </View>
          ))}
          {sending && turns.length > 0 && turns[turns.length - 1].sender === "player" ? (
            <View style={{ alignSelf: "flex-start" }}>
              <ActivityIndicator size="small" color="#7A7068" />
            </View>
          ) : null}
          {bootError ? (
            <Text className="font-figtree-medium text-player-danger text-sm text-center">{bootError}</Text>
          ) : null}
        </ScrollView>

        <View className="px-5 pt-3 pb-4 bg-player-surface border-t border-player-border-light flex-row items-center gap-2.5">
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Type a message…"
            placeholderTextColor="#9A9791"
            className="flex-1 font-figtree-medium"
            style={{ height: 46, paddingHorizontal: 15, borderRadius: 23, backgroundColor: "#F4EFEC", fontSize: 14.5 }}
            onSubmitEditing={sendMessage}
            editable={!sending}
          />
          <Pressable
            onPress={sendMessage}
            disabled={sending || !input.trim()}
            className="w-11 h-11 rounded-full bg-player-accent items-center justify-center"
            style={{ opacity: sending || !input.trim() ? 0.5 : 1 }}
          >
            <Text className="text-white font-figtree-bold text-base">→</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
