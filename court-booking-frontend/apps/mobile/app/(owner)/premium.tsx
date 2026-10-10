import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { premiumStateText, selectionTotal } from "@court-booking/types";
import type { OwnerInvoice } from "@court-booking/types";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatDateString, formatPKR } from "@/lib/format";
import { CheckIcon, ChevronLeftIcon } from "@/components/icons";
import { ErrorState } from "@/components/error-state";

const INVOICE_STATUS: Record<OwnerInvoice["status"], string> = {
  issued: "Waiting for your payment",
  proof_submitted: "Payment sent, being checked",
  paid: "Paid",
  void: "Cancelled",
  expired: "Expired",
};

export default function OwnerPremiumScreen() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["owner-premium"], queryFn: () => api.premium.get() });
  const data = query.data;

  // The owner's unsaved ticks. null = nothing touched yet, so the screen shows what is switched on.
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const enabledKeys = new Set((data?.features ?? []).filter((f) => f.enabled).map((f) => f.key));
  const selected = picked ?? enabledKeys;

  const save = useMutation({
    mutationFn: (keys: string[]) => api.premium.setSelection(keys),
    onSuccess: (fresh) => {
      queryClient.setQueryData(["owner-premium"], fresh);
      setPicked(null);
    },
  });

  const changed = enabledKeys.size !== selected.size || [...selected].some((k) => !enabledKeys.has(k));

  return (
    <SafeAreaView className="flex-1 bg-owner-bg" edges={["top", "bottom"]}>
      <View className="px-4.5 py-5 bg-owner-surface border-b border-owner-border flex-row items-center gap-3">
        <Pressable onPress={() => router.back()} className="w-11 h-11 rounded-[10px] bg-owner-bg items-center justify-center">
          <ChevronLeftIcon />
        </Pressable>
        <Text className="font-plex-bold text-owner-ink text-[16.5px] -tracking-[0.2px] flex-1">Premium features</Text>
      </View>

      {query.isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#0E6274" />
        </View>
      ) : query.isError || !data ? (
        <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} tone="owner" />
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="px-4.5 pt-4 pb-8 gap-3.5">
          <Text className="font-plex-medium text-owner-ink-faint text-[13px] leading-[18px]">
            Pick only the features you want and pay only for those. Each one has a {data.trial_days}-day free trial that starts the day
            you switch it on, and you keep the price you switched it on at.
          </Text>

          {!data.enforced ? (
            <View className="rounded-[10px] px-3.5 py-3" style={{ backgroundColor: "#E7F2F5" }}>
              <Text className="font-plex-medium text-[13px]" style={{ color: "#0E6274" }}>
                Billing has not started yet. Every feature is free for everyone right now and nothing is charged.
              </Text>
            </View>
          ) : null}

          {data.features.length === 0 ? (
            <Text className="font-plex-medium text-owner-ink-faint text-[13px]">No premium features are on offer right now.</Text>
          ) : (
            <View className="bg-owner-surface border border-owner-border rounded-[12px] overflow-hidden">
              {data.features.map((f, i) => {
                const on = selected.has(f.key);
                return (
                  <Pressable
                    key={f.key}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={f.label}
                    onPress={() => {
                      const next = new Set(selected);
                      if (on) next.delete(f.key);
                      else next.add(f.key);
                      setPicked(next);
                    }}
                    className={`flex-row items-start gap-3 px-4 py-3.5 ${i > 0 ? "border-t border-owner-border-light" : ""}`}
                  >
                    <View
                      className="w-6 h-6 rounded-md items-center justify-center mt-0.5"
                      style={{ backgroundColor: on ? "#0E6274" : "#FFFFFF", borderWidth: 1.5, borderColor: on ? "#0E6274" : "#C6D2D7" }}
                    >
                      {on ? <CheckIcon size={14} /> : null}
                    </View>
                    <View className="flex-1">
                      <Text className="font-plex-semibold text-owner-ink text-[14px]">{f.label}</Text>
                      {f.description ? <Text className="font-plex-medium text-owner-ink-faint text-[12px] mt-0.5">{f.description}</Text> : null}
                      <Text className="font-plex-medium text-[12px] mt-1.5" style={{ color: f.entitled || !f.enabled ? "#5B7079" : "#B3261E" }}>
                        {premiumStateText(f, data.enforced, data.trial_days)}
                      </Text>
                    </View>
                    <Text className="font-mono-semibold text-owner-ink text-[13px]">
                      PKR {formatPKR(f.enabled ? (f.your_price_pkr ?? f.monthly_price_pkr) : f.monthly_price_pkr)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}

          <View className="flex-row items-center justify-between">
            <Text className="font-plex-medium text-owner-ink text-[13.5px]">Your monthly total</Text>
            <Text className="font-mono-semibold text-owner-ink text-[18px]">PKR {formatPKR(selectionTotal(data.features, selected))}</Text>
          </View>
          <Pressable
            disabled={!changed || save.isPending}
            onPress={() => save.mutate([...selected])}
            className="h-12 rounded-[10px] items-center justify-center"
            style={{ backgroundColor: "#0E6274", opacity: !changed || save.isPending ? 0.4 : 1 }}
          >
            <Text className="font-plex-semibold text-white text-[14.5px]">{save.isPending ? "Saving…" : "Save my choices"}</Text>
          </Pressable>
          {save.isError ? <Text className="font-plex-semibold text-owner-danger text-[13px]">{friendlyErrorMessage(save.error)}</Text> : null}

          <Text className="font-plex-bold text-owner-ink text-[15px] mt-3">Invoices</Text>
          {data.invoices.length === 0 ? (
            <Text className="font-plex-medium text-owner-ink-faint text-[13px]">
              No invoices yet. The first one arrives about a week before your free trial ends.
            </Text>
          ) : (
            data.invoices.map((inv) => (
              <View key={inv.id} className="bg-owner-surface border border-owner-border rounded-[12px] px-4 py-3.5 gap-1.5">
                <View className="flex-row justify-between gap-2">
                  <Text className="font-plex-semibold text-owner-ink text-[13.5px] flex-1">
                    {formatDateString(inv.period_start)} to {formatDateString(inv.period_end)}
                  </Text>
                  <Text className="font-mono-semibold text-owner-ink text-[14px]">PKR {formatPKR(inv.total_pkr)}</Text>
                </View>
                <Text className="font-plex-medium text-owner-ink-faint text-[12px]">
                  {INVOICE_STATUS[inv.status]}. Due {formatDateString(inv.due_date)}.
                </Text>
                {inv.lines.map((l) => (
                  <Text key={l.feature_key} className="font-plex-medium text-owner-ink-faint text-[12px]">
                    {l.description ?? l.feature_key}: PKR {formatPKR(l.amount_pkr)}
                  </Text>
                ))}
              </View>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
