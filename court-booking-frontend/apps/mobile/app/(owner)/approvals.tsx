import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { approvalsHeaderCounts, type ApprovalQueueItem, type ApprovalState, type ApproveAcceptMode } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatDayHeader } from "@/lib/format";
import { pollInterval } from "@/lib/polling";
import { noLongerPendingState } from "@/lib/round2-format";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { useMyPermissions } from "@/lib/use-my-permissions";
import { PERM } from "@/lib/overview";
import { courtLabel, sportForCourtName } from "@/components/court-label";
import { OwnerTabBar } from "@/components/owner-tab-bar";
import { ChevronLeftIcon } from "@/components/icons";
import { ErrorState } from "@/components/error-state";
import { BookingDetailSheet } from "@/components/booking-detail-sheet";
import { ApprovalCard, ApproveSheet, DuplicateConfirmSheet, RejectSheet } from "@/components/approval-card";
import { EmptyState } from "./_dashboard-components";

const PAGE_SIZE = 50;

/** Round 2 (A1/A5): every payment waiting for review as a list, newest first. Acting on a card removes only that card;
 * a card whose booking the player cancelled turns grey in place with "Theek hai". */
export default function ApprovalsScreen() {
  const { activeVenue, activeVenueId, isLoading: venuesLoading } = useOwnerVenues();
  const routeParams = useLocalSearchParams<{ date?: string; courts?: string }>();
  const filterDate = routeParams.date || undefined;
  const filterCourts = routeParams.courts ? routeParams.courts.split(",").filter(Boolean) : [];
  const queryClient = useQueryClient();

  const [removed, setRemoved] = useState<Set<string>>(() => new Set());
  const [greyed, setGreyed] = useState<Record<string, ApprovalState>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sheet, setSheet] = useState<{ kind: "approve" | "reject"; id: string } | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Stage 2 (B.b): staff without the approve permission see the note up front (GET /owners/me/permissions); a 403
  // NOT_STAFF_PERMITTED (older backend, or a permission removed meanwhile) still swaps the buttons for the same note.
  const [noPermission, setNoPermission] = useState(false);
  const perms = useMyPermissions();
  const locked = noPermission || !perms.can(PERM.approve);
  // Stage 2 (B.a): the separate "used before" confirm, with the amount/mode the owner already chose.
  const [dup, setDup] = useState<{ id: string; usedOn: number; amount: number | undefined; mode: ApproveAcceptMode | undefined } | null>(null);
  const [dupError, setDupError] = useState<string | null>(null);

  const query = useInfiniteQuery({
    queryKey: ["owner-approvals-queue", activeVenueId, filterDate, filterCourts.join(",")],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api.owners.approvalsQueue({ venueId: activeVenueId, date: filterDate, courtIds: filterCourts, page: pageParam, pageSize: PAGE_SIZE }),
    getNextPageParam: (last) => (last.page * last.page_size < last.total ? last.page + 1 : undefined),
    enabled: !!activeVenueId,
    refetchInterval: (q) => pollInterval(q, 15_000),
  });

  const fetched = useMemo(() => {
    const seen = new Set<string>();
    const out: ApprovalQueueItem[] = [];
    for (const p of query.data?.pages ?? []) {
      for (const it of p.items) {
        if (seen.has(it.payment_id)) continue;
        seen.add(it.payment_id);
        out.push(it);
      }
    }
    return out;
  }, [query.data]);
  const items = fetched.filter((it) => !removed.has(it.payment_id)).map((it) => (greyed[it.payment_id] ? { ...it, state: greyed[it.payment_id] } : it));
  const serverTotal = query.data?.pages[0]?.total ?? 0;
  // The badge number = payments waiting for approval + grey cards that only need "Theek hai"; the header splits it.
  const { awaiting, closed } = approvalsHeaderCounts(serverTotal, fetched, removed, greyed);
  const current = sheet ? items.find((it) => it.payment_id === sheet.id) ?? null : null;
  const dupItem = dup ? items.find((it) => it.payment_id === dup.id) ?? null : null;

  function refreshSide() {
    queryClient.invalidateQueries({ queryKey: ["owner-badges"] });
    queryClient.invalidateQueries({ queryKey: ["owner-overview"] });
    queryClient.invalidateQueries({ queryKey: ["owner-history"] });
  }

  function drop(id: string) {
    setRemoved((prev) => new Set(prev).add(id));
    refreshSide();
    // The card is already gone; the queue refetch just catches up (the others stay where they are).
    queryClient.invalidateQueries({ queryKey: ["owner-approvals-queue"] });
  }

  async function act(id: string, fn: () => Promise<unknown>, onDone: () => void, onError?: (e: unknown) => boolean) {
    setBusyId(id);
    setSheetError(null);
    setDupError(null);
    setErrors((e) => ({ ...e, [id]: "" }));
    try {
      await fn();
      onDone();
    } catch (e) {
      const state = noLongerPendingState(e);
      if (onError?.(e)) {
        // handled by the caller
      } else if (state) {
        // The player cancelled meanwhile: grey in place, no error text, no reason asked.
        setGreyed((g) => ({ ...g, [id]: state }));
        setSheet(null);
        setDup(null);
      } else if (e instanceof ApiError && e.code === "NOT_STAFF_PERMITTED") {
        setNoPermission(true);
        setSheet(null);
        setDup(null);
      } else if (dup) {
        setDupError(friendlyErrorMessage(e));
      } else if (sheet) {
        setSheetError(friendlyErrorMessage(e));
      } else {
        setErrors((er) => ({ ...er, [id]: friendlyErrorMessage(e) }));
      }
    } finally {
      setBusyId(null);
    }
  }

  function approve(item: ApprovalQueueItem, amount: number | undefined, mode: ApproveAcceptMode | undefined, confirmDuplicate = false) {
    // A flagged screenshot never goes out without the separate confirm first.
    if (item.duplicate && !confirmDuplicate) {
      setSheet(null);
      setDupError(null);
      setDup({ id: item.payment_id, usedOn: item.duplicate.used_on_bookings, amount, mode });
      return;
    }
    act(
      item.payment_id,
      () => api.payments.approve(item.payment_id, amount, mode, confirmDuplicate || undefined),
      () => {
        setSheet(null);
        setDup(null);
        drop(item.payment_id);
      },
      (e) => {
        // The server knows of a duplicate this card did not show (older list, or flagged meanwhile): ask now.
        if (!(e instanceof ApiError) || e.code !== "DUPLICATE_PROOF_CONFIRM_REQUIRED") return false;
        const n = Number((e.details as { used_on_bookings?: unknown } | undefined)?.used_on_bookings);
        setSheet(null);
        setDup({ id: item.payment_id, usedOn: Number.isFinite(n) && n > 0 ? n : 1, amount, mode });
        return true;
      },
    );
  }

  function reject(item: ApprovalQueueItem, reason: string) {
    act(item.payment_id, () => api.payments.reject(item.payment_id, reason), () => {
      setSheet(null);
      drop(item.payment_id);
    });
  }

  function acknowledge(item: ApprovalQueueItem, moneyReceived: boolean) {
    act(item.payment_id, () => api.owners.acknowledgeCancelled(item.payment_id, moneyReceived), () => {
      drop(item.payment_id);
      if (moneyReceived) {
        queryClient.invalidateQueries({ queryKey: ["owner-refunds"] });
        setNotice(`${item.player_name ?? "Player"} ka refund Refunds mein add ho gaya.`);
      }
    });
  }

  const courtText = (it: ApprovalQueueItem) => courtLabel(it.court_name, it.court_sport ?? sportForCourtName(activeVenue?.courts, it.court_name));

  return (
    <SafeAreaView className="flex-1 bg-owner-bg" edges={["top"]}>
      <View className="px-4.5 py-5 bg-owner-surface border-b border-owner-border flex-row items-center gap-3">
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/(owner)/today"))}
          accessibilityLabel="Back"
          accessibilityRole="button"
          className="w-11 h-11 rounded-[10px] bg-owner-bg items-center justify-center"
        >
          <ChevronLeftIcon />
        </Pressable>
        <View className="flex-1 gap-0.5">
          <Text className="font-plex-medium text-owner-ink-faint text-[12.5px]">Payment review</Text>
          <Text testID="approvals-count" className="font-plex-bold text-owner-ink text-[17px] -tracking-[0.2px]" accessibilityRole="header">
            {query.data ? `${awaiting} approvals baqi` : "Approvals"}
          </Text>
          {query.data && closed > 0 ? (
            <Text testID="approvals-count-closed" className="font-plex-medium text-owner-ink-muted text-[12.5px]">
              {`(${closed} cancel/expire hue, Theek hai dabayein)`}
            </Text>
          ) : null}
        </View>
      </View>
      {filterDate || filterCourts.length ? (
        <View className="px-4.5 py-2.5 bg-owner-accent-soft flex-row items-center justify-between gap-3">
          <Text className="flex-1 font-plex-medium text-owner-ink text-[12.5px]">
            {`Filter: ${filterDate ? formatDayHeader(filterDate) : "Sab din"}${filterCourts.length ? ` - ${filterCourts.length} court(s)` : ""}`}
          </Text>
          <Pressable onPress={() => router.setParams({ date: undefined, courts: undefined })} accessibilityRole="button" style={{ minHeight: 44, justifyContent: "center" }}>
            <Text className="font-plex-bold text-owner-accent text-[13px] underline">Sab dikhao</Text>
          </Pressable>
        </View>
      ) : null}
      {notice ? (
        <View className="px-4.5 py-2.5 flex-row items-center justify-between gap-3" style={{ backgroundColor: "#E4F0EA" }}>
          <Text className="flex-1 font-plex-semibold text-[12.5px]" style={{ color: "#14563A" }}>
            {notice}
          </Text>
          <Pressable onPress={() => router.push("/(owner)/refunds")} accessibilityRole="link" style={{ minHeight: 44, justifyContent: "center" }}>
            <Text className="font-plex-bold text-owner-accent text-[13px] underline">Refunds</Text>
          </Pressable>
        </View>
      ) : null}

      {venuesLoading || query.isLoading || !perms.settled ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#0E6274" />
        </View>
      ) : query.isError && !query.data ? (
        <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} tone="owner" />
      ) : items.length === 0 ? (
        <EmptyState title="Sab ho gaya" subtitle="Abhi koi payment approval ke liye nahi hai." />
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="px-4 pt-4 pb-8 gap-3.5">
          {items.map((it) => (
            <ApprovalCard
              key={it.payment_id}
              item={it}
              courtText={courtText(it)}
              busy={busyId === it.payment_id}
              error={errors[it.payment_id] || null}
              locked={locked}
              onDetails={() => setDetailId(it.booking_id)}
              onApprove={() => {
                setSheetError(null);
                setSheet({ kind: "approve", id: it.payment_id });
              }}
              onReject={() => {
                setSheetError(null);
                setSheet({ kind: "reject", id: it.payment_id });
              }}
              onAcknowledge={(money) => acknowledge(it, money)}
            />
          ))}
          {query.hasNextPage ? (
            <Pressable
              onPress={() => query.fetchNextPage()}
              accessibilityRole="button"
              style={{ minHeight: 48, borderRadius: 12, borderWidth: 1.5, borderColor: "#101C21", alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF" }}
            >
              <Text className="font-plex-semibold text-owner-ink text-[14px]">{query.isFetchingNextPage ? "Load ho raha hai" : "Aur dikhao"}</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      )}

      {sheet?.kind === "approve" && current && current.state === "awaiting" ? (
        <ApproveSheet
          item={current}
          busy={busyId === current.payment_id}
          error={sheetError}
          onClose={() => setSheet(null)}
          onConfirm={(amount, mode) => approve(current, amount, mode)}
        />
      ) : null}
      {sheet?.kind === "reject" && current && current.state === "awaiting" ? (
        <RejectSheet
          item={current}
          busy={busyId === current.payment_id}
          error={sheetError}
          onClose={() => setSheet(null)}
          onConfirm={(reason) => reject(current, reason)}
        />
      ) : null}
      {dup && dupItem && dupItem.state === "awaiting" ? (
        <DuplicateConfirmSheet
          item={dupItem}
          usedOn={dup.usedOn}
          busy={busyId === dupItem.payment_id}
          error={dupError}
          onClose={() => setDup(null)}
          onConfirm={() => approve(dupItem, dup.amount, dup.mode, true)}
        />
      ) : null}
      {detailId ? <BookingDetailSheet bookingId={detailId} onClose={() => setDetailId(null)} onOpenBooking={(id) => setDetailId(id)} /> : null}
      <OwnerTabBar active="approvals" />
    </SafeAreaView>
  );
}
