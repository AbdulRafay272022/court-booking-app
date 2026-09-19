import { useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR, formatTimeRange } from "@/lib/format";
import { pollInterval } from "@/lib/polling";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { ChevronLeftIcon, CheckIcon } from "@/components/icons";
import { ErrorState } from "@/components/error-state";
import { EmptyState } from "./_dashboard-components";

const REJECT_REASONS = ["Amount doesn't match", "Screenshot unreadable", "Looks like a duplicate", "Other"];

export default function ApprovalsScreen() {
  const { activeVenueId } = useOwnerVenues();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  const query = useQuery({
    queryKey: ["owner-pending-approvals", activeVenueId],
    queryFn: () => api.owners.pendingApprovals(activeVenueId),
    refetchInterval: (query) => pollInterval(query, 15_000),
  });

  const list = query.data ?? [];
  const current = list[0];

  function resetRejectSheet() {
    setRejecting(false);
    setRejectReason(null);
    setRejectNote("");
  }

  async function handleApprove() {
    if (!current) return;
    setBusy(true);
    try {
      await api.payments.approve(current.payment_id);
      await queryClient.invalidateQueries({ queryKey: ["owner-pending-approvals"] });
      await queryClient.invalidateQueries({ queryKey: ["owner-today"] });
    } catch (e) {
      Alert.alert("Couldn't approve", friendlyErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitReject() {
    if (!current) return;
    const reason = rejectReason === "Other" ? rejectNote.trim() : rejectReason;
    if (!reason) {
      Alert.alert("Pick a reason", "Choose a reason (or write one) before rejecting.");
      return;
    }
    setBusy(true);
    try {
      await api.payments.reject(current.payment_id, reason);
      resetRejectSheet();
      await queryClient.invalidateQueries({ queryKey: ["owner-pending-approvals"] });
      await queryClient.invalidateQueries({ queryKey: ["owner-today"] });
    } catch (e) {
      Alert.alert("Couldn't reject", friendlyErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const verdict = current?.ocr_verdict ?? null;
  const verdictTone =
    verdict === "match" ? "match" : verdict === "mismatch" ? "mismatch" : "unreadable";

  return (
    <SafeAreaView className="flex-1 bg-owner-bg" edges={["top", "bottom"]}>
      <View className="px-4.5 py-5 bg-owner-surface border-b border-owner-border flex-row items-center gap-3">
        <Pressable onPress={() => router.back()} className="w-11 h-11 rounded-[10px] bg-owner-bg items-center justify-center">
          <ChevronLeftIcon />
        </Pressable>
        <View className="flex-1 gap-0.5">
          <Text className="font-plex-bold text-owner-ink text-[16.5px] -tracking-[0.2px]">Payment review</Text>
          <Text className="font-plex-medium text-owner-ink-faint text-[12.5px]">
            {list.length === 0 ? "Nothing waiting" : `1 of ${list.length} waiting`}
          </Text>
        </View>
      </View>

      {query.isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#0E6274" />
        </View>
      ) : query.isError && list.length === 0 ? (
        <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} tone="owner" />
      ) : !current ? (
        <EmptyState title="All caught up" subtitle="No payment screenshots are waiting for review right now." />
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="px-4.5 pt-4 gap-3.5">
          <View
            className="rounded-xl p-4 flex-row items-center gap-3.5"
            style={{
              backgroundColor: verdictTone === "match" ? "#E4F0EA" : verdictTone === "mismatch" ? "#F8E5E0" : "#EFF2F3",
              borderWidth: 1,
              borderColor: verdictTone === "match" ? "#A9CFBD" : verdictTone === "mismatch" ? "#DDBAB1" : "#DCE3E6",
            }}
          >
            <View
              className="w-[38px] h-[38px] rounded-full items-center justify-center"
              style={{ backgroundColor: verdictTone === "match" ? "#1F7A52" : verdictTone === "mismatch" ? "#8C3823" : "#8399A1" }}
            >
              <CheckIcon size={19} strokeWidth={2.6} />
            </View>
            <View className="flex-1 gap-0.5">
              <Text
                className="font-plex-bold text-[14.5px]"
                style={{ color: verdictTone === "match" ? "#14563A" : verdictTone === "mismatch" ? "#8C3823" : "#5B7079" }}
              >
                {verdictTone === "match" ? "Amount matches" : verdictTone === "mismatch" ? "Amount mismatch" : "Couldn't read the screenshot"}
              </Text>
              <Text
                className="font-plex-medium text-[12.5px]"
                style={{ color: verdictTone === "match" ? "#3D7A5E" : verdictTone === "mismatch" ? "#8C3823" : "#5B7079" }}
              >
                {current.ocr_amount != null
                  ? `We read PKR ${formatPKR(current.ocr_amount)} · expected PKR ${formatPKR(current.expected_amount)}`
                  : `Expected PKR ${formatPKR(current.expected_amount)} — verify the screenshot manually`}
              </Text>
            </View>
          </View>

          <View className="bg-owner-surface border border-owner-border rounded-xl p-4.5 gap-3.5">
            <View className="flex-row items-center gap-3">
              <View className="w-11 h-11 rounded-full bg-owner-accent items-center justify-center">
                <Text className="font-plex-semibold text-white text-[15px]">
                  {(current.player_name ?? "?").slice(0, 2).toUpperCase()}
                </Text>
              </View>
              <View className="flex-1 gap-0.5">
                <Text className="font-plex-bold text-owner-ink text-[15.5px]">{current.player_name ?? "Player"}</Text>
                {current.player_phone ? (
                  <Text className="font-mono-medium text-owner-ink-muted text-[12.5px]">{current.player_phone}</Text>
                ) : null}
              </View>
            </View>
            <View className="h-px bg-owner-border-light" />
            <Row label="Slot" value={`${current.court_name} · ${formatTimeRange(current.starts_at, current.ends_at)}`} />
            <Row label="Advance due" value={`PKR ${formatPKR(current.expected_amount)}`} />
            <Row label="Submitted" value={`${current.minutes_since_submission.toFixed(0)} min ago`} />
          </View>

          {current.proof_url ? (
            <View className="bg-owner-surface border border-owner-border rounded-xl p-3.5">
              <Image source={{ uri: current.proof_url }} style={{ width: "100%", height: 260, borderRadius: 8 }} resizeMode="contain" />
            </View>
          ) : (
            <View className="bg-owner-surface border border-owner-border rounded-xl p-4.5">
              <Text className="font-plex-medium text-owner-ink-faint text-[13px]">No screenshot on file for this payment.</Text>
            </View>
          )}
        </ScrollView>
      )}

      {current ? (
        <View className="px-4.5 pt-3.5 pb-6 bg-owner-surface border-t border-owner-border">
          {rejecting ? (
            <View className="gap-3">
              <Text className="font-plex-semibold text-owner-ink-muted text-[13px]">Why are you rejecting this?</Text>
              <View className="flex-row flex-wrap gap-2">
                {REJECT_REASONS.map((r) => (
                  <Pressable
                    key={r}
                    onPress={() => setRejectReason(r)}
                    className="px-3.5 py-2.5 rounded-lg"
                    style={{ backgroundColor: rejectReason === r ? "#8C3823" : "#F4F6F7" }}
                  >
                    <Text
                      className="font-plex-semibold text-[13px]"
                      style={{ color: rejectReason === r ? "#FFFFFF" : "#5B7079" }}
                    >
                      {r}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {rejectReason === "Other" ? (
                <TextInput
                  value={rejectNote}
                  onChangeText={setRejectNote}
                  placeholder="Describe the issue"
                  className="font-plex-medium"
                  style={{ height: 46, paddingHorizontal: 13, borderRadius: 9, borderWidth: 1, borderColor: "#DCE3E6", fontSize: 14 }}
                />
              ) : null}
              <View className="flex-row gap-2.5">
                <Pressable onPress={resetRejectSheet} className="flex-1 h-12 rounded-[11px] border border-owner-border items-center justify-center">
                  <Text className="font-plex-semibold text-owner-ink-muted text-[14.5px]">Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={submitReject}
                  disabled={busy}
                  className="flex-1 h-12 rounded-[11px] items-center justify-center"
                  style={{ backgroundColor: "#8C3823", opacity: busy ? 0.6 : 1 }}
                >
                  <Text className="font-plex-semibold text-white text-[14.5px]">Confirm reject</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View className="flex-row gap-2.5">
              <Pressable
                onPress={handleApprove}
                disabled={busy}
                className="flex-1 h-[52px] rounded-[11px] items-center justify-center"
                style={{ backgroundColor: "#1F7A52", opacity: busy ? 0.6 : 1 }}
              >
                <Text className="font-plex-semibold text-white text-[15.5px]">Approve</Text>
              </Pressable>
              <Pressable
                onPress={() => setRejecting(true)}
                disabled={busy}
                className="w-[104px] h-[52px] rounded-[11px] items-center justify-center border"
                style={{ borderColor: "#DDBAB1" }}
              >
                <Text className="font-plex-semibold text-[15px]" style={{ color: "#A8432C" }}>
                  Reject
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between">
      <Text className="font-plex-medium text-owner-ink-muted text-[13.5px]">{label}</Text>
      <Text className="font-mono-semibold text-owner-ink text-[13.5px]">{value}</Text>
    </View>
  );
}
