import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR, formatWhen } from "@/lib/format";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { ChevronLeftIcon } from "@/components/icons";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "./_dashboard-components";
import type { OwnerRefund } from "@court-booking/types";

/** Section 32 Part 10: the owner's "Refunds to pay" screen. A refund here was always sent OUTSIDE
 * the app (JazzCash/bank) -- there is no payment gateway. This just records that it happened. */
export default function RefundsScreen() {
  const { activeVenueId, isLoading: venuesLoading } = useOwnerVenues();
  const queryClient = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["owner-refunds", activeVenueId],
    queryFn: () => api.owners.refunds(activeVenueId),
    enabled: !!activeVenueId,
  });

  const list = query.data ?? [];
  const open = list.find((r) => r.id === openId) ?? null;

  return (
    <SafeAreaView className="flex-1 bg-owner-bg" edges={["top", "bottom"]}>
      <View className="px-4.5 py-5 bg-owner-surface border-b border-owner-border flex-row items-center gap-3">
        <Pressable onPress={() => router.back()} className="w-11 h-11 rounded-[10px] bg-owner-bg items-center justify-center">
          <ChevronLeftIcon />
        </Pressable>
        <View className="flex-1 gap-0.5">
          <Text className="font-plex-bold text-owner-ink text-[16.5px] -tracking-[0.2px]">Refunds to pay</Text>
          <Text className="font-plex-medium text-owner-ink-faint text-[12.5px]">
            {list.length === 0 ? "Nothing owed right now" : `${list.length} refund${list.length === 1 ? "" : "s"} owed`}
          </Text>
        </View>
      </View>

      {venuesLoading || query.isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#0E6274" />
        </View>
      ) : query.isError ? (
        <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} tone="owner" />
      ) : list.length === 0 ? (
        <EmptyState title="All settled" subtitle="No refunds are waiting to be paid out." />
      ) : open ? (
        <MarkRefundedForm
          refund={open}
          onClose={() => setOpenId(null)}
          onDone={async () => {
            setOpenId(null);
            await queryClient.invalidateQueries({ queryKey: ["owner-refunds"] });
            await queryClient.invalidateQueries({ queryKey: ["owner-ledger"] });
          }}
        />
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="px-4.5 pt-4 gap-3">
          {list.map((refund) => (
            <Pressable
              key={refund.id}
              onPress={() => setOpenId(refund.id)}
              className="bg-owner-surface border rounded-xl p-4 flex-row items-center justify-between gap-3"
              style={{ borderColor: refund.is_overdue ? "#DDBAB1" : "#DCE3E6" }}
            >
              <View className="flex-1 gap-0.5">
                <Text className="font-plex-bold text-owner-ink text-[14.5px]">
                  {refund.player_name ?? refund.player_phone ?? "Player"}
                </Text>
                <Text className="font-plex-medium text-owner-ink-muted text-[12.5px]">
                  {refund.court_name} · {formatWhen(refund.starts_at)}
                </Text>
                {refund.is_overdue ? (
                  <Text className="font-plex-semibold text-[11.5px]" style={{ color: "#A8432C" }}>
                    Overdue -- flagged {formatWhen(refund.created_at)}
                  </Text>
                ) : null}
              </View>
              <Text className="font-mono-bold text-owner-ink text-[15px]">PKR {formatPKR(refund.refund_amount)}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function MarkRefundedForm({ refund, onClose, onDone }: { refund: OwnerRefund; onClose: () => void; onDone: () => void }) {
  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState(String(Math.round(refund.refund_amount)));
  const [busy, setBusy] = useState(false);

  async function submit() {
    const trimmedReference = reference.trim();
    if (!trimmedReference) {
      Alert.alert("Add a reference", "Add a reference (e.g. the JazzCash/bank transaction id) so this can be traced later.");
      return;
    }
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
      Alert.alert("Invalid amount", "Enter a valid amount.");
      return;
    }
    setBusy(true);
    try {
      await api.owners.markRefundPaid(refund.id, trimmedReference, parsedAmount);
      onDone();
    } catch (e) {
      Alert.alert("Couldn't save", friendlyErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView className="flex-1" contentContainerClassName="px-4.5 pt-4 gap-4">
      <View className="bg-owner-surface border border-owner-border rounded-xl p-4 gap-1">
        <Text className="font-plex-bold text-owner-ink text-[15px]">
          {refund.player_name ?? refund.player_phone} · {refund.court_name}
        </Text>
        <Text className="font-plex-medium text-owner-ink-muted text-[13px]">Owed PKR {formatPKR(refund.refund_amount)}</Text>
      </View>

      <View className="gap-1.5">
        <Text className="font-plex-semibold text-owner-ink-muted text-[13px]">Amount refunded (PKR)</Text>
        <TextInput
          value={amount}
          onChangeText={setAmount}
          keyboardType="numeric"
          className="font-mono-medium"
          style={{ height: 46, paddingHorizontal: 13, borderRadius: 9, borderWidth: 1, borderColor: "#DCE3E6", fontSize: 14 }}
        />
      </View>

      <View className="gap-1.5">
        <Text className="font-plex-semibold text-owner-ink-muted text-[13px]">Reference (required)</Text>
        <TextInput
          value={reference}
          onChangeText={setReference}
          placeholder="e.g. JazzCash TXN 12345, or bank transfer ref"
          className="font-plex-medium"
          style={{ height: 46, paddingHorizontal: 13, borderRadius: 9, borderWidth: 1, borderColor: "#DCE3E6", fontSize: 14 }}
        />
      </View>

      <View className="flex-row gap-2.5 mt-1">
        <Pressable onPress={onClose} className="flex-1 h-12 rounded-[11px] border border-owner-border items-center justify-center">
          <Text className="font-plex-semibold text-owner-ink-muted text-[14.5px]">Cancel</Text>
        </Pressable>
        <Pressable
          onPress={submit}
          disabled={busy}
          className="flex-1 h-12 rounded-[11px] items-center justify-center"
          style={{ backgroundColor: "#0E6274", opacity: busy ? 0.6 : 1 }}
        >
          <Text className="font-plex-semibold text-white text-[14.5px]">{busy ? "Saving…" : "Confirm refunded"}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
