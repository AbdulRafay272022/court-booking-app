import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { OwnerBookingRow, OwnerOverview } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";

import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatDayHeader, formatPKR, pktDateString } from "@/lib/format";
import { api } from "@/lib/api";
import { pollInterval } from "@/lib/polling";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { useAuthStore } from "@/lib/auth-store";
import { useVenueSetupStore } from "@/lib/venue-setup-store";
import { OV, courtShort, dateTitle, historyParams } from "@/lib/overview";
import { BellIcon } from "@/components/icons";
import { BellBadge } from "@/components/bell-badge";
import { ErrorState } from "@/components/error-state";
import { PremiumNotices } from "@/components/premium-notices";
import { BookingDetailSheet } from "@/components/booking-detail-sheet";
import { OwnerTabBar } from "@/components/owner-tab-bar";
import { BookingCard } from "@/components/overview/booking-card";
import { DateChooserSheet, MultiSelectSheet, courtsSummary } from "@/components/overview/pickers";
import { SlotsSheet } from "@/components/overview/slots-sheet";
import { BottomSheet, OrangeButton, OutlineButton, Pill, SelectButton, SmallChip } from "@/components/overview/ui";
import { VenueStatusBanner, VenueSwitcher } from "./_dashboard-components";

type Filter = "all" | "booked" | "cancelled" | "refund";

/** Owner "Overview of days" (replaces Today): filters, KPI cards, the day's bookings. */
export default function OwnerOverviewScreen() {
  const { venues, activeVenue, activeVenueId, setVenueId, showSwitcher, isLoading: venuesLoading } = useOwnerVenues();
  const isOwner = useAuthStore((s) => s.user?.role) === "owner";
  const [date, setDate] = useState(pktDateString());
  const [courtIds, setCourtIds] = useState<string[]>([]);
  const [sheet, setSheet] = useState<null | "date" | "courts" | "slots" | "booked-courts">(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [highlight, setHighlight] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const listY = useRef(0);
  const cardY = useRef(new Map<string, number>());

  const allCourts = (activeVenue?.courts ?? []).filter((c) => c.is_active !== false);
  // A court selection belongs to one venue.
  useEffect(() => setCourtIds([]), [activeVenueId]);

  const query = useQuery({
    queryKey: ["owner-overview", activeVenueId, date, courtIds.join(",")],
    queryFn: () => api.owners.overview({ date, venueId: activeVenueId, courtIds }),
    enabled: !!activeVenueId,
    refetchInterval: (q) => pollInterval(q, 15_000),
  });
  const data: OwnerOverview | undefined = query.data;
  const forbidden = query.error instanceof ApiError && query.error.status === 403;
  const rows = data?.rows ?? [];
  const counts = {
    all: rows.length,
    booked: rows.filter((r) => r.kind === "booked").length,
    cancelled: rows.filter((r) => r.kind === "cancelled").length,
    refund: rows.filter((r) => r.kind === "refund").length,
  };
  const shown = filter === "all" ? rows : rows.filter((r) => r.kind === filter);

  const goHistory = (status?: string, courts: string[] = courtIds) =>
    router.push({ pathname: "/(owner)/history", params: historyParams(date, courts, status) });

  function openOriginal(row: OwnerBookingRow) {
    const id = row.original_booking_id;
    if (!id) return;
    const target = rows.find((r) => r.booking_id === id && r.kind === "booked");
    if (!target) {
      setDetailId(id);
      return;
    }
    setFilter("all");
    setHighlight(id);
    setTimeout(() => {
      const y = cardY.current.get(`${id}:booked`);
      if (y != null) scrollRef.current?.scrollTo({ y: Math.max(0, listY.current + y - 12), animated: true });
    }, 120);
    setTimeout(() => setHighlight(null), 2400);
  }

  const topCourt = data ? [...data.slots.by_court].sort((a, b) => b.booked - a.booked)[0] : undefined;
  const slotCourts = (courtIds.length ? allCourts.filter((c) => courtIds.includes(c.id)) : allCourts).map((c) => ({ id: c.id, name: c.name }));

  return (
    <View className="flex-1 bg-owner-bg">
      <SafeAreaView edges={["top"]} style={{ backgroundColor: "#0D171B" }}>
        <View className="flex-row items-center justify-between px-4 py-3">
          <Image source={require("../../assets/brand/khelo-logo-full-dark.png")} style={{ width: 100, height: 32 }} resizeMode="contain" accessibilityLabel="Khelo" />
          <Pressable
            onPress={() => router.push("/(owner)/notifications")}
            accessibilityLabel="Notifications"
            accessibilityRole="button"
            className="w-11 h-11 rounded-xl items-center justify-center"
            style={{ backgroundColor: "rgba(255,255,255,0.1)", borderWidth: 1, borderColor: "rgba(255,255,255,0.25)" }}
          >
            <BellIcon color="#FFFFFF" />
            <BellBadge />
          </Pressable>
        </View>
      </SafeAreaView>

      <ScrollView ref={scrollRef} className="flex-1" contentContainerClassName="px-4 pt-5 pb-8 gap-4">
        <View className="gap-1">
          <Text className="font-plex-bold text-owner-ink text-[30px] -tracking-[0.6px]" accessibilityRole="header">
            Overview
          </Text>
          <Text className="font-plex-medium text-owner-ink-muted text-[14px]">
            {`${formatDayHeader(date)} · ${activeVenue?.name ?? "Your venue"}`}
          </Text>
        </View>

        {showSwitcher ? (
          <VenueSwitcher
            venues={venues}
            activeVenueId={activeVenueId}
            onSelect={setVenueId}
            onAdd={() => {
              // Reuses the existing setup wizard, from a clean draft (not whatever was left half-done).
              useVenueSetupStore.getState().reset();
              router.push("/(owner)/venue-setup/register");
            }}
          />
        ) : null}
        {isOwner ? <PremiumNotices /> : null}
        {activeVenue ? (
          <VenueStatusBanner
            venue={activeVenue}
            onView={() =>
              router.push({
                pathname: activeVenue.status === "rejected" ? "/(owner)/venue-setup/rejected" : "/(owner)/venue-setup/pending",
                params: { venueId: activeVenue.id },
              })
            }
          />
        ) : null}

        <View className="flex-row gap-2.5">
          <OutlineButton flex label="Check-in" onPress={() => router.push("/(owner)/checkin")} />
          <OrangeButton flex label="Add booking" onPress={() => router.push("/(owner)/walkin")} />
          <OutlineButton flex label="History" onPress={() => goHistory()} />
        </View>

        <SelectButton label="Tareekh" value={`${formatDayHeader(date)}${date === pktDateString() ? " (Aaj)" : ""}`} onPress={() => setSheet("date")} />
        <SelectButton label="Courts" value={courtsSummary(courtIds, allCourts)} onPress={() => setSheet("courts")} disabled={allCourts.length === 0} />

        {venuesLoading || query.isLoading ? (
          <View className="py-16 items-center">
            <ActivityIndicator color={OV.accent} />
          </View>
        ) : forbidden ? (
          <View className="rounded-2xl p-4" style={{ backgroundColor: OV.amberBg, borderWidth: 1, borderColor: OV.amberBorder }}>
            <Text className="font-plex-semibold text-[14px]" style={{ color: OV.amberDark }}>
              Aapke paas Overview dekhne ki ijazat nahi hai.
            </Text>
            <Text className="font-plex-medium text-[12.5px] mt-1" style={{ color: OV.amberDark }}>
              Owner se "View dashboard, bookings and ledger" ki ijazat maangein.
            </Text>
          </View>
        ) : query.isError && !data ? (
          <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} tone="owner" />
        ) : data ? (
          <>
            {/* Total slots */}
            <View className="rounded-2xl bg-owner-surface p-4 gap-3" style={{ borderWidth: 1.5, borderColor: OV.border }}>
              <View className="flex-row items-center justify-between">
                <Text className="font-plex-semibold text-owner-ink-muted text-[13.5px]">Total slots</Text>
                <Pressable
                  onPress={() => setSheet("slots")}
                  accessibilityRole="button"
                  className="px-3 rounded-full justify-center"
                  style={{ minHeight: 40, backgroundColor: "#EDF1F2" }}
                >
                  <Text className="font-plex-semibold text-owner-ink text-[12.5px]">Sab slots dekho</Text>
                </Pressable>
              </View>
              <Text className="font-mono-semibold text-owner-ink text-[40px] leading-[44px]">{data.slots.total}</Text>
              <View className="flex-row rounded-full overflow-hidden" style={{ height: 10, backgroundColor: OV.bar.free }} accessibilityLabel="Slots split">
                {(["booked", "pending", "blocked"] as const).map((k) =>
                  data.slots[k] > 0 && data.slots.total > 0 ? <View key={k} style={{ flex: data.slots[k], backgroundColor: OV.bar[k] }} /> : null,
                )}
                {data.slots.free > 0 && data.slots.total > 0 ? <View style={{ flex: data.slots.free }} /> : null}
              </View>
              <View className="flex-row flex-wrap gap-x-3 gap-y-1">
                {[
                  ["Booked", data.slots.booked, OV.bar.booked],
                  ["Pending", data.slots.pending, OV.bar.pending],
                  ["Blocked", data.slots.blocked, OV.bar.blocked],
                  ["Khali", data.slots.free, "#9FC9C2"],
                ].map(([label, n, color]) => (
                  <View key={label as string} className="flex-row items-center gap-1.5">
                    <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: color as string }} />
                    <Text className="font-plex-medium text-owner-ink-muted text-[12.5px]">{`${label} ${n}`}</Text>
                  </View>
                ))}
              </View>
            </View>

            <View className="flex-row gap-3">
              <KpiCard
                label="Booked slots"
                onPress={() => goHistory("booked")}
                footer={
                  topCourt && topCourt.booked > 0 ? (
                    <View className="flex-row flex-wrap gap-1.5">
                      <SmallChip label={`${courtShort(topCourt.court_name)} · ${topCourt.booked}`} bg="#EDF1F2" fg={OV.ink} />
                      {data.slots.by_court.length > 1 ? (
                        <SmallChip label={`+${data.slots.by_court.length - 1} aur`} bg="#EDF1F2" fg={OV.ink} onPress={() => setSheet("booked-courts")} />
                      ) : null}
                    </View>
                  ) : null
                }
              >
                <Big>{data.slots.booked}</Big>
              </KpiCard>
              <KpiCard label="Khali slots" onPress={() => setSheet("slots")}>
                <Big>{data.slots.free}</Big>
                <Sub>{`aane wale ${data.slots.free_upcoming} · guzre ${data.slots.free_past}`}</Sub>
              </KpiCard>
            </View>

            <View className="flex-row gap-3">
              <KpiCard label="Bookings" onPress={() => goHistory("booked")}>
                <Big>{data.bookings.count}</Big>
                <Sub>{`${data.slots.booked} slots mein`}</Sub>
              </KpiCard>
              <KpiCard label="Cancelled" onPress={() => goHistory("cancelled")}>
                <Big>{data.bookings.cancelled}</Big>
              </KpiCard>
            </View>

            <View className="flex-row gap-3">
              <KpiCard label="Refunds" onPress={() => goHistory("refund")}>
                <Big>{data.bookings.refunds.count}</Big>
                <Sub>{`PKR ${formatPKR(data.bookings.refunds.amount)}`}</Sub>
              </KpiCard>
              <View className="flex-1 rounded-2xl overflow-hidden" style={{ backgroundColor: "#FFF1E8", borderWidth: 1.5, borderColor: "#F6C9AE" }}>
                <Pressable
                  onPress={() => router.push({ pathname: "/(owner)/approvals", params: { date, ...(courtIds.length ? { courts: courtIds.join(",") } : {}) } })}
                  accessibilityRole="button"
                  accessibilityLabel={`Pending ${data.bookings.pending.count}`}
                  className="p-4 gap-1.5"
                >
                  <Text className="font-plex-semibold text-[13.5px]" style={{ color: OV.amberDark }}>
                    Pending
                  </Text>
                  <Text className="font-mono-semibold text-owner-ink text-[30px] leading-[34px]">{data.bookings.pending.count}</Text>
                  <Text className="font-plex-medium text-[12.5px]" style={{ color: OV.amberDark }}>
                    {`approval ${data.bookings.pending.awaiting_approval}`}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => goHistory("held")}
                  accessibilityRole="button"
                  className="px-4 justify-center"
                  style={{ minHeight: 44 }}
                >
                  <Text className="font-plex-semibold text-[12.5px] underline" style={{ color: OV.amberDark }}>
                    {`Payment ke intezar (${data.bookings.pending.awaiting_payment})`}
                  </Text>
                </Pressable>
              </View>
            </View>

            <View className="flex-row gap-3">
              <KpiCard label="Collected" onPress={() => goHistory("booked")}>
                <Money>{`PKR ${formatPKR(data.money.collected)}`}</Money>
              </KpiCard>
              <KpiCard label="Due" onPress={() => goHistory("booked")}>
                <Money>{`PKR ${formatPKR(data.money.due)}`}</Money>
                {data.money.due_bookings > 0 ? <Sub>{`${data.money.due_bookings} bookings`}</Sub> : null}
              </KpiCard>
            </View>

            <Text className="font-plex-bold text-owner-ink text-[22px] mt-2" accessibilityRole="header">
              {`${dateTitle(date)} ki bookings`}
            </Text>
            <View className="flex-row flex-wrap gap-2">
              <Pill label={`Sab ${counts.all}`} selected={filter === "all"} onPress={() => setFilter("all")} />
              <Pill label={`Booked ${counts.booked}`} tone="green" selected={filter === "booked"} onPress={() => setFilter("booked")} />
              <Pill label={`Cancelled ${counts.cancelled}`} tone="red" selected={filter === "cancelled"} onPress={() => setFilter("cancelled")} />
              <Pill label={`Refund ${counts.refund}`} tone="amber" selected={filter === "refund"} onPress={() => setFilter("refund")} />
            </View>

            <View className="gap-3" onLayout={(e) => (listY.current = e.nativeEvent.layout.y)}>
              {shown.length === 0 ? (
                <View className="py-10 items-center">
                  <Text className="font-plex-medium text-owner-ink-faint text-[14px]">Is din koi booking nahi.</Text>
                </View>
              ) : (
                shown.map((row) => (
                  <BookingCard
                    key={`${row.booking_id}:${row.kind}`}
                    row={row}
                    highlighted={highlight === row.booking_id && row.kind === "booked"}
                    onLayoutY={(y) => cardY.current.set(`${row.booking_id}:${row.kind}`, y)}
                    onOpen={() => setDetailId(row.booking_id)}
                    onOpenOriginal={() => openOriginal(row)}
                  />
                ))
              )}
            </View>
            <Text className="font-plex-medium text-owner-ink-faint text-[12.5px]">Kisi bhi card par dabayein: poori detail neeche se khulti hai.</Text>
          </>
        ) : null}
      </ScrollView>

      <OwnerTabBar active="overview" />

      {sheet === "date" ? (
        <DateChooserSheet
          value={date}
          onClose={() => setSheet(null)}
          onPick={(d) => {
            setDate(d);
            setSheet(null);
          }}
        />
      ) : null}
      {sheet === "courts" ? (
        <MultiSelectSheet
          title="Courts chunein"
          allLabel={`Sab courts (${allCourts.length})`}
          options={allCourts.map((c) => ({ id: c.id, label: c.name, sub: c.sport }))}
          value={courtIds}
          onClose={() => setSheet(null)}
          onApply={(ids) => {
            setCourtIds(ids);
            setSheet(null);
          }}
        />
      ) : null}
      {sheet === "slots" ? <SlotsSheet date={date} courts={slotCourts} onClose={() => setSheet(null)} /> : null}
      {sheet === "booked-courts" && data ? (
        <BottomSheet title="Booked slots, court ke hisaab se" subtitle={formatDayHeader(date)} onClose={() => setSheet(null)}>
          {[...data.slots.by_court]
            .sort((a, b) => b.booked - a.booked)
            .map((c) => (
              <Pressable
                key={c.court_id}
                onPress={() => {
                  setSheet(null);
                  goHistory("booked", [c.court_id]);
                }}
                accessibilityRole="button"
                className="flex-row items-center justify-between border-b border-owner-border-light"
                style={{ minHeight: 48 }}
              >
                <Text className="font-plex-semibold text-owner-ink text-[15px]">{c.court_name}</Text>
                <Text className="font-mono-semibold text-owner-ink text-[15px]">{`${c.booked} / ${c.total}`}</Text>
              </Pressable>
            ))}
        </BottomSheet>
      ) : null}
      {detailId ? (
        <BookingDetailSheet bookingId={detailId} onClose={() => setDetailId(null)} onOpenBooking={(id) => setDetailId(id)} />
      ) : null}
    </View>
  );
}

function KpiCard({ label, onPress, children, footer }: { label: string; onPress: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  // The footer sits OUTSIDE the card's Pressable: a button inside a button is invalid on web.
  return (
    <View className="flex-1 rounded-2xl bg-owner-surface" style={{ borderWidth: 1.5, borderColor: OV.border }}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} className="p-4 gap-1.5">
        <Text className="font-plex-semibold text-owner-ink-muted text-[13.5px]">{label}</Text>
        {children}
      </Pressable>
      {footer ? <View className="px-4 pb-4 -mt-1">{footer}</View> : null}
    </View>
  );
}

function Big({ children }: { children: React.ReactNode }) {
  return <Text className="font-mono-semibold text-owner-ink text-[30px] leading-[34px]">{children}</Text>;
}

function Money({ children }: { children: React.ReactNode }) {
  return (
    <Text className="font-mono-semibold text-owner-ink text-[20px]" numberOfLines={1} adjustsFontSizeToFit>
      {children}
    </Text>
  );
}

function Sub({ children }: { children: React.ReactNode }) {
  return <Text className="font-plex-medium text-owner-ink-muted text-[12.5px]">{children}</Text>;
}
