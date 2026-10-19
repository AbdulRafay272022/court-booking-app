import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { refundBreakdown, type OwnerRefund } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatDayHeader, formatPKR, formatWhen } from "@/lib/format";
import { OV, PERM } from "@/lib/overview";
import { useMyPermissions } from "@/lib/use-my-permissions";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { courtLabel, sportForCourtName } from "@/components/court-label";
import { OwnerTabBar } from "@/components/owner-tab-bar";
import { ChevronLeftIcon } from "@/components/icons";
import { ErrorState } from "@/components/error-state";
import { BookingDetailSheet } from "@/components/booking-detail-sheet";
import { BookingLinks } from "@/components/booking-links";
import { RefundSheet } from "@/components/refund-sheet";
import { EmptyState } from "./_dashboard-components";

/** Section 32 Part 10 + Round 2 (A10): the owner's "Refunds to pay" screen. A refund here was always sent OUTSIDE
 * the app (JazzCash/bank) -- there is no payment gateway. This just records that it happened. */
export default function RefundsScreen() {
  const { activeVenue, activeVenueId, isLoading: venuesLoading } = useOwnerVenues();
  const routeParams = useLocalSearchParams<{ date?: string; courts?: string }>();
  const filterDate = routeParams.date || undefined;
  const filterCourts = routeParams.courts ? routeParams.courts.split(",").filter(Boolean) : [];
  const queryClient = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  // Stage 2 (B.b): staff without the refunds permission get the no-permission state up front (no request, no buttons).
  const perms = useMyPermissions();
  const allowed = perms.can(PERM.refunds);

  const query = useQuery({
    queryKey: ["owner-refunds", activeVenueId, filterDate, filterCourts.join(",")],
    queryFn: () => api.owners.refunds(activeVenueId, { date: filterDate, courtIds: filterCourts }),
    enabled: !!activeVenueId && allowed && perms.settled,
  });

  const list = query.data ?? [];
  const open = list.find((r) => r.id === openId) ?? null;
  const loading = venuesLoading || !perms.settled || (allowed && query.isLoading);
  // Staff without the refunds permission: known up front, or 403 NOT_STAFF_PERMITTED -> ONE clear state (no count line, no retry).
  const noPermission = !allowed || (query.error instanceof ApiError && query.error.code === "NOT_STAFF_PERMITTED");
  const showCount = !loading && !query.isError && !noPermission;
  const courtText = (r: OwnerRefund) => courtLabel(r.court_name, r.court_sport ?? sportForCourtName(activeVenue?.courts, r.court_name));

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
          <Text className="font-plex-bold text-owner-ink text-[16.5px] -tracking-[0.2px]">Refunds to pay</Text>
          {showCount ? (
            <Text testID="refunds-count" className="font-plex-medium text-owner-ink-faint text-[12.5px]">
              {list.length === 0 ? "Abhi koi refund baqi nahi" : `${list.length} refund${list.length === 1 ? "" : "s"} baqi`}
            </Text>
          ) : null}
        </View>
      </View>
      {filterDate ? (
        <View className="px-4.5 py-2.5 bg-owner-accent-soft flex-row items-center justify-between gap-3">
          <Text className="flex-1 font-plex-medium text-owner-ink text-[12.5px]">{`Filter: ${formatDayHeader(filterDate)}${filterCourts.length ? ` - ${filterCourts.length} court(s)` : ""}`}</Text>
          <Pressable onPress={() => router.setParams({ date: undefined, courts: undefined })} accessibilityRole="button" style={{ minHeight: 44, justifyContent: "center" }}>
            <Text className="font-plex-bold text-owner-accent text-[13px] underline">Sab dikhao</Text>
          </Pressable>
        </View>
      ) : null}

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#0E6274" />
        </View>
      ) : noPermission ? (
        <View testID="refunds-no-permission" className="flex-1 items-center justify-center px-8 gap-2">
          <Text className="font-plex-bold text-owner-ink text-[16px] text-center">Aap ke paas is kaam ki ijazat nahi</Text>
          <Text className="font-plex-medium text-owner-ink-muted text-[13.5px] text-center">
            Refunds dekhne aur paid mark karne ki ijazat owner deta hai. Owner se ijazat mangein.
          </Text>
        </View>
      ) : query.isError ? (
        <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} tone="owner" />
      ) : list.length === 0 ? (
        <EmptyState title="Sab hisaab barabar" subtitle="Koi refund bhejna baqi nahi hai." />
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="px-4.5 pt-4 pb-8 gap-3">
          {list.map((refund) => {
            const b = refundBreakdown(refund);
            return (
              <View
                key={refund.id}
                className="bg-owner-surface border rounded-xl p-4 gap-3"
                style={{ borderColor: refund.is_overdue ? "#DDBAB1" : "#DCE3E6" }}
              >
                <Pressable
                  onPress={() => setOpenId(refund.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`${refund.player_name ?? "Player"} refund`}
                  style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}
                >
                  <View className="flex-1 gap-0.5">
                    <Text className="font-plex-bold text-owner-ink text-[14.5px]">{refund.player_name ?? refund.player_phone ?? "Player"}</Text>
                    <Text className="font-plex-medium text-owner-ink-muted text-[12.5px]">{`${courtText(refund)} - ${formatWhen(refund.starts_at)}`}</Text>
                    {refund.is_overdue ? (
                      <Text className="font-plex-semibold text-[11.5px]" style={{ color: "#A8432C" }}>
                        {`Der ho gayi - ${formatWhen(refund.created_at)} se baqi`}
                      </Text>
                    ) : null}
                  </View>
                  <View className="items-end gap-1">
                    <Text className="font-mono-semibold text-owner-ink text-[15px]">{`PKR ${formatPKR(b.remaining)}`}</Text>
                    {b.status === "partial" ? (
                      <View testID="chip-partial" className="rounded-full px-2.5" style={{ minHeight: 24, justifyContent: "center", backgroundColor: OV.amberBg }}>
                        <Text className="font-plex-semibold text-[11.5px]" style={{ color: OV.amberDark }}>
                          Hissa wapas
                        </Text>
                      </View>
                    ) : null}
                    {b.alreadyRefunded > 0 ? (
                      <Text className="font-plex-medium text-owner-ink-faint text-[11px]">{`PKR ${formatPKR(b.refundDue)} mein se baqi`}</Text>
                    ) : null}
                  </View>
                </Pressable>
                <BookingLinks bookingId={refund.booking_id} startsAt={refund.starts_at} onDetails={() => setDetailId(refund.booking_id)} />
              </View>
            );
          })}
        </ScrollView>
      )}
      {open ? (
        <RefundSheet
          key={open.id}
          refund={open}
          title={`${open.player_name ?? open.player_phone ?? "Player"} - ${courtText(open)}`}
          onClose={() => setOpenId(null)}
          onDone={() => {
            setOpenId(null);
            queryClient.invalidateQueries({ queryKey: ["owner-refunds"] });
            queryClient.invalidateQueries({ queryKey: ["owner-ledger"] });
            queryClient.invalidateQueries({ queryKey: ["owner-badges"] });
          }}
        />
      ) : null}
      {detailId ? <BookingDetailSheet bookingId={detailId} onClose={() => setDetailId(null)} onOpenBooking={(id) => setDetailId(id)} /> : null}
      <OwnerTabBar active="refunds" />
    </SafeAreaView>
  );
}
