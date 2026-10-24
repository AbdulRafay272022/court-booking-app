import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { router, useIsFocused, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react-native";
import { refundBreakdown, type OwnerRefund } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";
import { palette, radius, shadow, size, space } from "@court-booking/ui-tokens";
import { Banner, Button, EmptyState, ErrorState, Pill, Skeleton, Text, useRoleTheme } from "@/components/ui";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatDayHeader, formatPKR, formatWhen } from "@/lib/format";
import { PERM, duplicateCreditText } from "@/lib/overview";
import { useMyPermissions } from "@/lib/use-my-permissions";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { courtLabel, sportForCourtName } from "@/components/court-label";
import { NoAccess } from "@/components/no-access";
import { BookingDetailSheet } from "@/components/booking-detail-sheet";
import { BookingLinks } from "@/components/booking-links";
import { RefundSheet } from "@/components/refund-sheet";
import { HeroLayout, PaisaSwitch } from "../_fl";

const DAY = 86400_000;

/** OPaisa frame 2 "Refunds dene hain" (Section 32 Part 10 + Round 2 A10). A refund here was always sent OUTSIDE the app
 * (JazzCash/bank): there is no payment gateway; this records that it happened. Tap opens the confirm sheet (amount +
 * player shown again, reference required). */
export default function RefundsScreen() {
  const t = useRoleTheme();
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
    subscribed: useIsFocused(),
  });

  const list = query.data ?? [];
  const open = list.find((r) => r.id === openId) ?? null;
  const loading = venuesLoading || !perms.settled || (allowed && query.isLoading);
  // Staff without the refunds permission: known up front, or 403 NOT_STAFF_PERMITTED -> ONE clear state (no count line, no retry).
  const noPermission = !allowed || (query.error instanceof ApiError && query.error.code === "NOT_STAFF_PERMITTED");
  const showCount = !loading && !query.isError && !noPermission;
  const courtText = (r: OwnerRefund) => courtLabel(r.court_name, r.court_sport ?? sportForCourtName(activeVenue?.courts, r.court_name));
  const totalOwed = list.reduce((s, r) => s + Math.max(0, refundBreakdown(r).remaining), 0);
  const oldestDays = list.length ? Math.max(...list.map((r) => Math.floor((Date.now() - Date.parse(r.created_at)) / DAY))) : 0;

  if (perms.settled && !allowed) return <NoAccess what="Refunds" withBack={false} />;

  const hero = (
    <View style={{ gap: space[4] }}>
      <Text variant="h1" tone="hero" accessibilityRole="header">
        Refunds dene hain
      </Text>
      <PaisaSwitch current="refunds" />
      {showCount ? (
        <View style={{ gap: space[1] }}>
          <Text variant="bodyBold" tone="hero">
            Kul wapas dena hai
          </Text>
          <Text variant="display" tone="hero">{`PKR ${formatPKR(totalOwed)}`}</Text>
          <Text testID="refunds-count" variant="meta" tone="heroMuted">
            {list.length === 0
              ? "Abhi koi refund baqi nahi"
              : `${list.length} refund${list.length === 1 ? "" : "s"} baqi${oldestDays > 0 ? ` · sab se purana ${oldestDays} din` : ""}`}
          </Text>
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.ground }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: size.tabBarOwner + 64 }}
        refreshControl={allowed ? <RefreshControl refreshing={query.isRefetching && !query.isLoading} onRefresh={() => query.refetch()} tintColor={t.ring} colors={[t.ring]} /> : undefined}
      >
        <HeroLayout hero={hero} testID="refunds-hero">
          {filterDate ? (
            <Banner
              tone="info"
              body={`Filter: ${formatDayHeader(filterDate)}${filterCourts.length ? ` - ${filterCourts.length} court(s)` : ""}`}
              action={<Button label="Sab dikhao" variant="soft" size="sm" onPress={() => router.setParams({ date: undefined, courts: undefined })} />}
            />
          ) : null}

          {loading ? (
            <View style={{ gap: space[3] }} accessibilityLabel="Loading">
              <Skeleton height={150} r={radius.card} />
              <Skeleton height={150} r={radius.card} />
            </View>
          ) : noPermission ? (
            <View testID="refunds-no-permission">
              <Banner tone="neutral" title="Aap ke paas is kaam ki ijazat nahi" body="Refunds dekhne aur paid mark karne ki ijazat owner deta hai. Owner se ijazat mangein." />
            </View>
          ) : query.isError ? (
            <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} />
          ) : list.length === 0 ? (
            <EmptyState title="Sab hisaab barabar" body="Koi refund bhejna baqi nahi hai." />
          ) : (
            list.map((refund) => {
              const b = refundBreakdown(refund);
              return (
                <View key={refund.id} style={{ backgroundColor: palette.white, borderRadius: radius.card, padding: space[4], gap: space[3], boxShadow: shadow.card, borderWidth: refund.is_overdue ? 1.5 : 0, borderColor: palette.dangerBorder }}>
                  <Pressable
                    onPress={() => setOpenId(refund.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`${refund.player_name ?? "Player"} refund`}
                    style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: space[3] }}
                  >
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text variant="bodyStrong">{refund.player_name ?? refund.player_phone ?? "Player"}</Text>
                      <Text variant="meta" tone="muted">{`${courtText(refund)} · ${formatWhen(refund.starts_at)}`}</Text>
                    </View>
                    <View style={{ alignItems: "flex-end", gap: space[1] }}>
                      <Text variant="title">{`PKR ${formatPKR(b.remaining)}`}</Text>
                      {b.status === "partial" ? <Pill testID="chip-partial" size="sm" tone="waiting" label="Hissa wapas" /> : null}
                      {b.alreadyRefunded > 0 ? (
                        <Text variant="caption" tone="muted">{`PKR ${formatPKR(b.refundDue)} mein se baqi`}</Text>
                      ) : null}
                    </View>
                  </Pressable>
                  {refund.reason ? (
                    <Text variant="meta" tone="body">
                      {`Wajah: ${refund.reason}`}
                    </Text>
                  ) : null}
                  {refund.duplicate_proof && refund.duplicate_proof.used_on_bookings > 0 ? (
                    <View testID="refund-dup-chip" style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: palette.dangerTint }}>
                      <TriangleAlert size={13} color={palette.danger} />
                      <Text variant="caption" weight="bold" tone="danger" style={{ flexShrink: 1 }}>
                        {duplicateCreditText(refund.duplicate_proof.used_on_bookings)}
                      </Text>
                    </View>
                  ) : null}
                  {refund.is_overdue ? (
                    <Text variant="caption" weight="bold" tone="danger">
                      {`Der ho gayi - ${formatWhen(refund.created_at)} se baqi`}
                    </Text>
                  ) : null}
                  {refund.player_phone ? (
                    <View style={{ backgroundColor: palette.ground, borderRadius: radius.md, paddingHorizontal: space[3], paddingVertical: 10, gap: 2 }}>
                      <Text variant="caption" tone="muted">
                        Player ka number
                      </Text>
                      <Text variant="bodyBold" selectable>
                        {refund.player_phone}
                      </Text>
                    </View>
                  ) : null}
                  {b.remaining > 0 ? <Button label="Bhej diya · record karein" block size="md" onPress={() => setOpenId(refund.id)} accessibilityLabel={`${refund.player_name ?? "Player"}: refund bhej diya, record karein`} /> : null}
                  <BookingLinks bookingId={refund.booking_id} startsAt={refund.starts_at} onDetails={() => setDetailId(refund.booking_id)} />
                </View>
              );
            })
          )}
          {list.length > 0 ? (
            <Text variant="caption" tone="muted">
              Paisa app ke bahar (JazzCash / bank) bhejein, phir yahan record karein. Tap karne par amount aur player dobara dikhte hain.
            </Text>
          ) : null}
        </HeroLayout>
      </ScrollView>
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
    </View>
  );
}
