import { useState } from "react";
import { ActivityIndicator, Modal, Pressable, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { durationChoices, formatDuration, type Slot } from "@court-booking/types";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatDate, formatPKR, formatTimeRange } from "@/lib/format";

/**
 * "How long do you want to play?" (Section 32 Part 4). Opens when a player taps an open slot: they pick a length in
 * multiples of the court's slot length (only lengths whose every slot is free and back to back are offered), and
 * see the TOTAL price for that length before anything is held. The price comes from the server's quote endpoint --
 * the same code that prices the hold -- so it already accounts for peak-price boundaries across the whole booking.
 */
export function DurationSheet({
  courtId,
  courtName,
  slotMinutes,
  slots,
  index,
  onClose,
  onContinue,
}: {
  courtId: string;
  courtName: string;
  slotMinutes: number;
  slots: Slot[];
  index: number;
  onClose: () => void;
  onContinue: (choice: { slotCount: number; minutes: number; price: number }) => void;
}) {
  const slot = slots[index];
  const choices = durationChoices(slots, index, slotMinutes);
  const [slotCount, setSlotCount] = useState(1);
  const quoteQuery = useQuery({
    queryKey: ["booking-quote", courtId, slot.starts_at, slotCount],
    queryFn: () => api.availability.quote(courtId, slot.starts_at, slotCount),
  });
  const quote = quoteQuery.data;

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end" style={{ backgroundColor: "rgba(0,0,0,0.4)" }} onPress={onClose}>
        <Pressable className="bg-player-surface rounded-t-3xl px-5 pt-5 pb-8 gap-5" onPress={(e) => e.stopPropagation?.()}>
          <View className="flex-row items-start justify-between gap-3">
            <View className="gap-1 flex-1">
              <Text className="font-figtree-bold text-[11px] tracking-[0.1em]" style={{ color: "#C8431C" }}>
                {courtName.toUpperCase()}
              </Text>
              <Text className="font-figtree-bold text-player-ink text-[17px]">{formatDate(slot.starts_at)}</Text>
              <Text className="font-mono-semibold text-player-ink text-[14.5px]">
                {quote ? formatTimeRange(quote.starts_at, quote.ends_at) : formatTimeRange(slot.starts_at, slot.ends_at)}
              </Text>
            </View>
            <Pressable onPress={onClose} accessibilityLabel="Close" className="w-11 h-11 rounded-xl bg-player-surface-2 items-center justify-center">
              <Text className="font-figtree-bold text-player-ink text-base">✕</Text>
            </Pressable>
          </View>

          <View className="gap-2.5">
            <Text className="font-figtree-bold text-player-ink text-[14px]">How long do you want to play?</Text>
            <View className="flex-row flex-wrap gap-2">
              {choices.map((c) => {
                const selected = c.slotCount === slotCount;
                return (
                  <Pressable
                    key={c.slotCount}
                    onPress={() => setSlotCount(c.slotCount)}
                    accessibilityState={{ selected }}
                    className="px-4 rounded-xl items-center justify-center"
                    style={{
                      minHeight: 44,
                      backgroundColor: selected ? "#141A1D" : "#FFFFFF",
                      borderWidth: 1,
                      borderColor: selected ? "#141A1D" : "#E0D9D4",
                    }}
                  >
                    <Text className="font-figtree-bold text-[13.5px]" style={{ color: selected ? "#FFFFFF" : "#141A1D" }}>
                      {c.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View className="rounded-2xl p-4 gap-1.5" style={{ backgroundColor: "#FFF3EE", borderWidth: 1, borderColor: "#F6DCD1" }}>
            {quoteQuery.isError ? (
              <Text className="font-figtree-semibold text-[13.5px]" style={{ color: "#B3261E" }}>
                {friendlyErrorMessage(quoteQuery.error)}
              </Text>
            ) : !quote ? (
              <View className="flex-row items-center gap-2">
                <ActivityIndicator color="#EF5A2C" />
                <Text className="font-figtree-medium text-player-ink-faint text-[13.5px]">Working out the price…</Text>
              </View>
            ) : (
              <>
                <View className="flex-row items-baseline justify-between">
                  <Text className="font-figtree-semibold text-player-ink-faint text-[13px]">Total for {formatDuration(quote.duration_minutes)}</Text>
                  <Text className="font-mono-semibold text-player-ink text-[22px]">PKR {formatPKR(quote.price)}</Text>
                </View>
                <Text className="font-figtree-medium text-player-ink-faint text-[12.5px]">
                  {quote.advance_amount < quote.price
                    ? `Pay PKR ${formatPKR(quote.advance_amount)} now to hold it; PKR ${formatPKR(quote.balance_due)} at the venue.`
                    : "You pay this now to hold the court."}
                </Text>
              </>
            )}
          </View>

          <Pressable
            onPress={() => quote && onContinue({ slotCount: quote.slot_count, minutes: quote.duration_minutes, price: quote.price })}
            disabled={!quote}
            className="rounded-xl items-center justify-center"
            style={{ minHeight: 50, backgroundColor: "#EF5A2C", opacity: quote ? 1 : 0.5 }}
          >
            <Text className="font-figtree-bold text-white text-[15px]">Continue</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
