import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { router, useIsFocused, useLocalSearchParams } from "expo-router";
import { FlashList } from "@shopify/flash-list";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck } from "lucide-react-native";
import { approvalsHeaderCounts, type ApprovalQueueItem, type ApprovalState, type ApproveAcceptMode } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";
import { palette, radius, shadow, size, space } from "@court-booking/ui-tokens";
import { Banner, Button, EmptyState, ErrorState, SegmentedToggle, SkeletonCard, Text } from "@/components/ui";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatDayHeader } from "@/lib/format";
import { pollInterval } from "@/lib/polling";
import { noLongerPendingState } from "@/lib/round2-format";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { useMyPermissions } from "@/lib/use-my-permissions";
import { PERM } from "@/lib/overview";
import { bulkApprovable, bulkApproveAmount, oldestWaitMinutes, waitLabel } from "@/lib/owner-floodlight";
import { courtLabel, sportForCourtName } from "@/components/court-label";
import { NoAccess } from "@/components/no-access";
import { BookingDetailSheet } from "@/components/booking-detail-sheet";
import { ApprovalCard, ApproveSheet, BulkApproveSheet, DuplicateConfirmSheet, RefundConfirmSheet, RejectSheet } from "@/components/approval-card";
import { HeroLayout } from "../_fl";

const PAGE_SIZE = 50;
type View3 = "all" | "awaiting" | "closed";

/** Approvals board: every payment waiting for review, newest first (Round 2 A1/A5). Acting on a card removes only that
 * card; a card whose booking the player cancelled turns grey in place with "Theek hai". Teal hero, "Chahiye vs Screenshot"
 * cards, the duplicate warning and the separate duplicate confirm (Stage 2 B.a). Bulk approve is N single calls (B8). */
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
  const [sheet, setSheet] = useState<{ kind: "approve" | "reject" | "refund"; id: string } | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [show, setShow] = useState<View3>("all");
  // Stage 2 (B.b): staff without the approve permission see the note up front (GET /owners/me/permissions); a 403
  // NOT_STAFF_PERMITTED (older backend, or a permission removed meanwhile) still swaps the buttons for the same note.
  const [noPermission, setNoPermission] = useState(false);
  const perms = useMyPermissions();
  const focused = useIsFocused();
  const locked = noPermission || !perms.can(PERM.approve);
  // Stage 2 (B.a): the separate "used before" confirm, with the amount/mode the owner already chose.
  const [dup, setDup] = useState<{ id: string; usedOn: number; amount: number | undefined; mode: ApproveAcceptMode | undefined } | null>(null);
  const [dupError, setDupError] = useState<string | null>(null);
  const [bulk, setBulk] = useState<{ ids: string[]; progress: string | null; error: string | null; busy: boolean } | null>(null);

  const query = useInfiniteQuery({
    queryKey: ["owner-approvals-queue", activeVenueId, filterDate, filterCourts.join(",")],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api.owners.approvalsQueue({ venueId: activeVenueId, date: filterDate, courtIds: filterCourts, page: pageParam, pageSize: PAGE_SIZE }),
    getNextPageParam: (last) => (last.page * last.page_size < last.total ? last.page + 1 : undefined),
    enabled: !!activeVenueId && perms.can("view_ledger"),
    refetchInterval: (q) => pollInterval(q, 15_000),
    subscribed: focused,
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
  const oldest = oldestWaitMinutes(items);
  const bulkable = bulkApprovable(items, locked);
  const shown = show === "all" ? items : items.filter((it) => (show === "awaiting" ? it.state === "awaiting" : it.state !== "awaiting"));
  const bulkItems = bulk ? items.filter((it) => bulk.ids.includes(it.payment_id)) : [];

  function refreshSide() {
    queryClient.invalidateQueries({ queryKey: ["owner-badges"] });
    queryClient.invalidateQueries({ queryKey: ["owner-overview"] });
    queryClient.invalidateQueries({ queryKey: ["owner-history"] });
    queryClient.invalidateQueries({ queryKey: ["owner-ledger"] });
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
        setDup({ id: item.payment_id, usedOn: Number.isFinite(n) && n > 0 ? n : 0, amount, mode });
        return true;
      },
    );
  }

  /** Bulk approve = one call per payment, in order (no batch endpoint, contract B8). A refusal leaves that card in place
   * with its reason; a duplicate the server flags meanwhile is NOT confirmed here (it needs its own confirm). */
  async function runBulk() {
    if (!bulk) return;
    const list = bulkItems;
    let ok = 0;
    const failed: string[] = [];
    setBulk({ ...bulk, busy: true, error: null, progress: `0 / ${list.length}` });
    for (const it of list) {
      try {
        await api.payments.approve(it.payment_id, bulkApproveAmount(it), undefined, undefined);
        ok += 1;
        setRemoved((prev) => new Set(prev).add(it.payment_id));
      } catch (e) {
        const state = noLongerPendingState(e);
        if (state) setGreyed((g) => ({ ...g, [it.payment_id]: state }));
        else if (e instanceof ApiError && e.code === "NOT_STAFF_PERMITTED") setNoPermission(true);
        else setErrors((er) => ({ ...er, [it.payment_id]: e instanceof ApiError && e.code === "DUPLICATE_PROOF_CONFIRM_REQUIRED" ? "Ye screenshot pehle use ho chuka hai: is card par alag se Approve dabayein." : friendlyErrorMessage(e) }));
        failed.push(it.player_name ?? "Player");
      }
      setBulk((b) => (b ? { ...b, progress: `${ok + failed.length} / ${list.length}` } : b));
    }
    refreshSide();
    queryClient.invalidateQueries({ queryKey: ["owner-approvals-queue"] });
    if (failed.length === 0) {
      setBulk(null);
      setNotice(`${ok} payments approve ho gayi.`);
    } else {
      setBulk((b) => (b ? { ...b, busy: false, error: `${ok} approve hui. Ye ruk gayi: ${failed.join(", ")}. Un ke card par wajah likhi hai.` } : b));
    }
  }

  function reject(item: ApprovalQueueItem, reason: string) {
    act(item.payment_id, () => api.payments.reject(item.payment_id, reason), () => {
      setSheet(null);
      drop(item.payment_id);
    });
  }

  function acknowledge(item: ApprovalQueueItem, moneyReceived: boolean) {
    act(item.payment_id, () => api.owners.acknowledgeCancelled(item.payment_id, moneyReceived), () => {
      setSheet(null);
      drop(item.payment_id);
      if (moneyReceived) {
        queryClient.invalidateQueries({ queryKey: ["owner-refunds"] });
        setNotice(`${item.player_name ?? "Player"} ka refund Refunds mein add ho gaya.`);
      }
    });
  }

  const courtText = (it: ApprovalQueueItem) => courtLabel(it.court_name, it.court_sport ?? sportForCourtName(activeVenue?.courts, it.court_name));

  if (perms.settled && !perms.can("view_ledger")) return <NoAccess what="Approvals" withBack={false} />;

  const loading = venuesLoading || query.isLoading || !perms.settled;
  const hero = (
    <View style={{ gap: space[4] }}>
      <View style={{ gap: space[1] }}>
        <Text variant="h1" tone="hero" accessibilityRole="header">
          Approvals
        </Text>
        <Text testID="approvals-count" variant="bodyBold" tone="hero">
          {query.data ? `${awaiting} approvals baqi` : "Approvals"}
        </Text>
        {query.data && awaiting > 0 && oldest !== null ? (
          <Text variant="body" tone="heroMuted">{`Sab se purani ${waitLabel(oldest)} se wait kar rahi hai`}</Text>
        ) : null}
        {query.data && closed > 0 ? (
          <Text testID="approvals-count-closed" variant="meta" tone="heroMuted">
            {`(${closed} cancel/expire hue, Theek hai dabayein)`}
          </Text>
        ) : null}
      </View>
      {query.data && closed > 0 && awaiting > 0 ? (
        <SegmentedToggle
          tone="dark"
          testID="approvals-view"
          accessibilityLabel="Kaun se dikhayein"
          value={show}
          onChange={setShow}
          options={[
            { value: "all", label: "Sab" },
            { value: "awaiting", label: "Baqi", count: awaiting },
            { value: "closed", label: "Cancel/expire", count: closed },
          ]}
        />
      ) : null}
    </View>
  );

  const top = (
    <HeroLayout hero={hero} testID="approvals-hero">
      {filterDate || filterCourts.length ? (
        <Banner
          tone="info"
          body={`Filter: ${filterDate ? formatDayHeader(filterDate) : "Sab din"}${filterCourts.length ? ` - ${filterCourts.length} court(s)` : ""}`}
          action={<Button label="Sab dikhao" variant="soft" size="sm" onPress={() => router.setParams({ date: undefined, courts: undefined })} />}
        />
      ) : null}
      {notice ? (
        <Banner
          tone="open"
          body={notice}
          action={/Refunds/.test(notice) ? <Button label="Refunds" variant="soft" size="sm" onPress={() => router.push("/(owner)/(tabs)/refunds")} /> : undefined}
        />
      ) : null}
      {bulkable.length >= 2 && (show !== "closed") ? (
        <View testID="bulk-card" style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space[3], backgroundColor: palette.white, borderRadius: 22, padding: space[3], paddingLeft: 14, boxShadow: shadow.card }}>
          <View style={{ width: 40, height: 40, borderRadius: radius.sm, backgroundColor: palette.openTint, alignItems: "center", justifyContent: "center" }}>
            <CircleCheck size={20} color={palette.open} />
          </View>
          <Text variant="body" style={{ flex: 1, minWidth: 150 }}>
            <Text variant="bodyBold">{`${bulkable.length} screenshots`}</Text> ka amount bilkul match hai
          </Text>
          <Button label="Sab approve" size="sm" onPress={() => setBulk({ ids: bulkable.map((b) => b.payment_id), progress: null, error: null, busy: false })} testID="bulk-open" />
        </View>
      ) : null}
      {loading ? (
        <View style={{ gap: space[3] }} accessibilityLabel="Loading">
          <SkeletonCard />
          <SkeletonCard />
        </View>
      ) : query.isError && !query.data ? (
        <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState title="Sab ho gaya" body="Abhi koi payment approval ke liye nahi hai." icon={CircleCheck} />
      ) : null}
    </HeroLayout>
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.ground }}>
      <FlashList
        data={loading || (query.isError && !query.data) ? [] : shown}
        keyExtractor={(it) => it.payment_id}
        ListHeaderComponent={top}
        contentContainerStyle={{ paddingBottom: size.tabBarOwner + 64 }}
        renderItem={({ item: it }) => (
          <View style={{ paddingHorizontal: space[4], paddingTop: space[3] }}>
            <ApprovalCard
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
              onAcknowledge={(money) => {
                // Creating a refund is a money action: confirm amount + booking first. "Theek hai" stays one tap.
                if (!money) return acknowledge(it, false);
                setSheetError(null);
                setSheet({ kind: "refund", id: it.payment_id });
              }}
            />
          </View>
        )}
        ListFooterComponent={
          query.hasNextPage ? (
            <View style={{ paddingHorizontal: space[4], paddingTop: space[4] }}>
              <Pressable
                onPress={() => query.fetchNextPage()}
                accessibilityRole="button"
                style={{ minHeight: 48, borderRadius: radius.md, borderWidth: 1.5, borderColor: palette.lineStrong, alignItems: "center", justifyContent: "center", backgroundColor: palette.white }}
              >
                <Text variant="bodyBold">{query.isFetchingNextPage ? "Load ho raha hai" : "Aur dikhao"}</Text>
              </Pressable>
            </View>
          ) : null
        }
      />

      {sheet?.kind === "approve" && current && current.state === "awaiting" ? (
        <ApproveSheet item={current} busy={busyId === current.payment_id} error={sheetError} onClose={() => setSheet(null)} onConfirm={(amount, mode) => approve(current, amount, mode)} />
      ) : null}
      {sheet?.kind === "reject" && current && current.state === "awaiting" ? (
        <RejectSheet item={current} busy={busyId === current.payment_id} error={sheetError} onClose={() => setSheet(null)} onConfirm={(reason) => reject(current, reason)} />
      ) : null}
      {sheet?.kind === "refund" && current ? (
        <RefundConfirmSheet
          item={current}
          courtText={courtText(current)}
          busy={busyId === current.payment_id}
          error={sheetError}
          onClose={() => setSheet(null)}
          onConfirm={() => acknowledge(current, true)}
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
      {bulk ? (
        <BulkApproveSheet items={bulkItems} busy={bulk.busy} progress={bulk.progress} error={bulk.error} onClose={() => setBulk(null)} onConfirm={runBulk} />
      ) : null}
      {detailId ? <BookingDetailSheet bookingId={detailId} onClose={() => setDetailId(null)} onOpenBooking={(id) => setDetailId(id)} /> : null}
    </View>
  );
}
