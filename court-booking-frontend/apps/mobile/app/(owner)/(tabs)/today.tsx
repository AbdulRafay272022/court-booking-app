import { useEffect, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { router, useIsFocused } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Bell, ChevronDown, ChevronLeft, ChevronRight, Clock, Plus, ScanLine } from "lucide-react-native";
import type { OwnerBookingRow, OwnerOverview } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";
import { alpha, initials, palette, radius, shadow, size, space } from "@court-booking/ui-tokens";
import { Badge, Banner, Button, Chip, ErrorState, IconButton, Pill, Skeleton, SkeletonCard, Text, useRoleTheme, useTabBarRoom } from "@/components/ui";

import { friendlyErrorMessage } from "@/lib/error-messages";
import { addDays, formatDayHeader, formatPKR, pktDateString } from "@/lib/format";
import { api } from "@/lib/api";
import { pollInterval } from "@/lib/polling";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { useAuthStore } from "@/lib/auth-store";
import { useVenueSetupStore } from "@/lib/venue-setup-store";
import { arrivalRow, dateTitle, historyParams, statusPendingLine } from "@/lib/overview";
import { allDatesRange } from "@/lib/round2-format";
import { dayRangeLabel, freeHoursLabel, heroCollected, oldestWaitMinutes, waitLabel } from "@/lib/owner-floodlight";
import { useUnreadNotifications } from "@/lib/use-unread-notifications";
import { PremiumNotices } from "@/components/premium-notices";
import { CnicBanner } from "@/components/cnic-banner";
import { BookingDetailSheet } from "@/components/booking-detail-sheet";
import { NoAccess } from "@/components/no-access";
import { useMyPermissions } from "@/lib/use-my-permissions";
import { useOwnerBadges } from "@/components/owner-tab-bar";
import { BookingCard } from "@/components/overview/booking-card";
import { DateChooserSheet, MultiSelectSheet, courtsSummary } from "@/components/overview/pickers";
import { SlotsSheet } from "@/components/overview/slots-sheet";
import { BottomSheet, Pill as FilterPill, SelectButton } from "@/components/overview/ui";
import { VenueStatusBanner } from "../_dashboard-components";
import { HeroChip, HeroLayout } from "../_fl";
import { CourtsTimeline } from "../_timeline";

type Filter = "all" | "booked" | "cancelled" | "refund";

/** OwnerToday board ("Aaj"): teal hero with the money that came in (the SAME ledger number as Paisa, audit G14), the
 * approvals card, the multi-court day timeline, then the day's bookings and the full day summary (slots, pending,
 * KPIs) the Overview had. */
export default function OwnerTodayScreen() {
  const tabRoom = useTabBarRoom();
  const t = useRoleTheme();
  const { venues, activeVenue, activeVenueId, setVenueId, isLoading: venuesLoading } = useOwnerVenues();
  const isOwner = useAuthStore((s) => s.user?.role) === "owner";
  const isStaffUser = useAuthStore((s) => s.user?.role) === "staff";
  const today = pktDateString();
  const [date, setDate] = useState(today);
  const [courtIds, setCourtIds] = useState<string[]>([]);
  const [sheet, setSheet] = useState<null | "date" | "courts" | "free" | "venue">(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [highlight, setHighlight] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const scrollRef = useRef<ScrollView>(null);
  const listY = useRef(0);
  const cardY = useRef(new Map<string, number>());
  const focused = useIsFocused();

  const perms = useMyPermissions();
  const allowed = perms.can("view_ledger");
  const allCourts = (activeVenue?.courts ?? []).filter((c) => c.is_active !== false);
  // A court selection belongs to one venue.
  useEffect(() => setCourtIds([]), [activeVenueId]);
  // The "now" line and the "+ Add" gaps move with the clock.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const query = useQuery({
    queryKey: ["owner-overview", activeVenueId, date, courtIds.join(",")],
    queryFn: () => api.owners.overview({ date, venueId: activeVenueId, courtIds }),
    enabled: !!activeVenueId && allowed,
    refetchInterval: (q) => pollInterval(q, 15_000),
    // Polls only while Aaj is the visible screen (a pushed walk-in/history or another tab stops it).
    subscribed: focused,
  });
  // Hero money = the ledger (Paisa reads the same endpoint and key family, so both always agree; audit G14).
  const ledger = useQuery({
    queryKey: ["owner-ledger", activeVenueId, undefined, date, date],
    queryFn: () => api.owners.ledger(date, date, { venueId: activeVenueId }),
    enabled: !!activeVenueId && allowed,
    refetchInterval: (q) => pollInterval(q, 30_000),
    subscribed: focused,
  });
  const badges = useOwnerBadges(focused);
  const peek = useQuery({
    queryKey: ["owner-approvals-queue", "aaj-peek", activeVenueId],
    queryFn: () => api.owners.approvalsQueue({ venueId: activeVenueId, page: 1, pageSize: 50 }),
    enabled: !!activeVenueId && allowed && badges.approvals > 0,
    subscribed: focused,
  });
  const unread = useUnreadNotifications();

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
  const collected = heroCollected(ledger.data?.summary, date, today);
  const oldest = oldestWaitMinutes(peek.data?.items ?? []);

  const goHistory = (status?: string, courts: string[] = courtIds) => router.push({ pathname: "/(owner)/history", params: historyParams(date, courts, status) });

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

  const slotCourts = (courtIds.length ? allCourts.filter((c) => courtIds.includes(c.id)) : allCourts).map((c) => ({ id: c.id, name: c.name }));
  const timelineCourts = slotCourts;
  const sports = [...new Set(allCourts.map((c) => c.sport).filter(Boolean))].join(", ");
  const dayWord = date === today ? "AAJ" : date === addDays(today, 1) ? "KAL" : date === addDays(today, -1) ? "KAL (GUZRA)" : null;
  const dayLine = `${dayWord ? `${dayWord} · ` : ""}${formatDayHeader(date).toUpperCase()}`;

  if (perms.settled && !allowed) {
    // OStaffView board: a check-in / walk-in staff member gets their own Aaj (venue + name, today, the two big actions).
    if (isStaffUser && (perms.can("check_in") || perms.can("walkin"))) return <StaffAaj venueName={activeVenue?.name} venueId={activeVenueId} canCheckIn={perms.can("check_in")} />;
    return <NoAccess what="Aaj" withBack={false} />;
  }

  const hero = (
    <View style={{ gap: 18 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <Pressable
          onPress={() => setSheet("venue")}
          accessibilityRole="button"
          accessibilityLabel={`Venue badlein. Abhi: ${activeVenue?.name ?? "venue"}`}
          testID="venue-switch"
          style={{ flexShrink: 1, flexDirection: "row", alignItems: "center", gap: 10, minHeight: 52, paddingLeft: 6, paddingRight: 14, paddingVertical: 6, borderRadius: 26, backgroundColor: alpha.glassOnTeal, borderWidth: 1, borderColor: alpha.glassOnTealBorder }}
        >
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: palette.white, alignItems: "center", justifyContent: "center" }}>
            <Text variant="button" color={palette.night}>
              {initials(activeVenue?.name ?? "K")}
            </Text>
          </View>
          <View style={{ flexShrink: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
              <Text variant="bodyStrong" tone="hero">
                {activeVenue?.name ?? (venuesLoading ? "Venue load ho raha hai" : "Aap ki venue")}
              </Text>
              <ChevronDown size={15} color={palette.white} strokeWidth={2.5} />
            </View>
            {activeVenue ? (
              <Text variant="caption" tone="heroMuted">{`${allCourts.length} ${allCourts.length === 1 ? "court" : "courts"}${sports ? ` · ${sports}` : ""}`}</Text>
            ) : null}
          </View>
        </Pressable>
        <View>
          <IconButton
            icon={Bell}
            variant="onDark"
            diameter={48}
            accessibilityLabel={unread.unread > 0 ? `Notifications, ${unread.label} naye` : "Notifications"}
            onPress={() => router.push("/(owner)/notifications")}
            testID="owner-bell"
          />
          {unread.unread > 0 ? (
            <View pointerEvents="none" style={{ position: "absolute", top: -2, right: -4 }}>
              <View testID="bell-badge" accessibilityLabel={`${unread.unread} unread notifications`}>
                <Badge count={unread.unread} />
              </View>
            </View>
          ) : null}
        </View>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[2] }}>
        <IconButton icon={ChevronLeft} variant="onDark" accessibilityLabel="Pichla din" onPress={() => setDate(addDays(date, -1))} testID="day-prev" />
        <Pressable onPress={() => setSheet("date")} accessibilityRole="button" accessibilityLabel={`Tareekh: ${formatDayHeader(date)}. Badalne ke liye dabayein`} style={{ flexShrink: 1, minHeight: size.tap, justifyContent: "center", paddingHorizontal: space[2] }}>
          <Text testID="day-label" variant="bodyBold" tone="hero" align="center" style={{ letterSpacing: 0.8 }}>
            {dayLine}
          </Text>
        </Pressable>
        <IconButton icon={ChevronRight} variant="onDark" accessibilityLabel="Agla din" onPress={() => setDate(addDays(date, 1))} testID="day-next" />
      </View>

      <View style={{ alignItems: "center", gap: 10 }}>
        <Text variant="bodyBold" tone="hero">
          {date === today ? "Aaj aaya" : "Is din aaya"}
        </Text>
        {collected === null ? (
          ledger.isError ? (
            <Text variant="body" tone="hero">
              Raqam load nahi hui
            </Text>
          ) : (
            <Skeleton width={180} height={50} r={12} shade="soft" />
          )
        ) : (
          <Text testID="hero-collected" variant="displayXL" tone="hero" align="center" style={{ fontSize: 50, lineHeight: 54 }}>
            {`PKR ${formatPKR(collected)}`}
          </Text>
        )}
        {data ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2], justifyContent: "center" }}>
            <HeroChip label={`${data.bookings.count} ${data.bookings.count === 1 ? "booking" : "bookings"}`} onPress={() => goHistory("booked")} />
            <HeroChip label={freeHoursLabel(data.slots.free_upcoming)} onPress={() => setSheet("free")} />
            {data.money.due > 0 ? <HeroChip label={`PKR ${formatPKR(data.money.due)} baqi`} onPress={() => goHistory("booked")} /> : null}
          </View>
        ) : null}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.ground }}>
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: tabRoom }}
        refreshControl={<RefreshControl refreshing={query.isRefetching && !query.isLoading} onRefresh={() => { void query.refetch(); void ledger.refetch(); }} tintColor={t.ring} colors={[t.ring]} />}
      >
        <HeroLayout hero={hero} testID="today-hero">
          {badges.approvals > 0 ? (
            <Pressable
              testID="approvals-card"
              onPress={() => router.push({ pathname: "/(owner)/(tabs)/approvals", params: courtIds.length ? { courts: courtIds.join(",") } : {} })}
              accessibilityRole="button"
              accessibilityLabel={`${badges.approvals} payments check karni hain. Dekhein`}
              style={{ flexDirection: "row", alignItems: "center", gap: space[3], backgroundColor: palette.white, borderRadius: 22, padding: 14, boxShadow: shadow.card }}
            >
              <View style={{ width: 48, height: 48, borderRadius: radius.input, backgroundColor: palette.waitingTint, alignItems: "center", justifyContent: "center" }}>
                <Text variant="title" color={palette.waiting}>
                  {String(badges.approvals)}
                </Text>
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text variant="bodyStrong">Payments check karni hain</Text>
                {oldest !== null ? <Text variant="meta" tone="waiting">{`Sab se purani ${waitLabel(oldest)} se wait`}</Text> : null}
              </View>
              <View style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: t.primary.bg, justifyContent: "center" }}>
                <Text variant="bodyBold" color={t.primary.fg}>
                  Dekhein
                </Text>
              </View>
            </Pressable>
          ) : null}

          {isStaffUser ? <StaffActions /> : null}
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

          {(data?.status_pending_count ?? 0) > 0 ? (
            <Pressable
              testID="status-pending-line"
              onPress={() => {
                const r = allDatesRange();
                router.push({ pathname: "/(owner)/history", params: historyParams(r.from, courtIds, "status_pending", { to: r.to }) });
              }}
              accessibilityRole="button"
              accessibilityLabel={statusPendingLine(data?.status_pending_count ?? 0)}
              style={{ flexDirection: "row", alignItems: "center", gap: space[2], minHeight: 48, paddingHorizontal: space[4], borderRadius: radius.input, backgroundColor: palette.waitingTint }}
            >
              <Clock size={16} color={palette.waiting} />
              <Text variant="bodyBold" tone="waiting" style={{ flex: 1, textDecorationLine: "underline" }}>
                {statusPendingLine(data?.status_pending_count ?? 0)}
              </Text>
              <ChevronRight size={16} color={palette.waiting} />
            </Pressable>
          ) : null}


          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: space[2], paddingTop: space[1] }}>
            <Text variant="title" accessibilityRole="header">
              Courts ka din
            </Text>
            {data?.operating_day ? (
              <Text variant="meta" tone="muted" testID="day-range">
                {dayRangeLabel(data.operating_day.start_at, data.operating_day.end_at)}
              </Text>
            ) : null}
            {allCourts.length > 2 ? <SelectButton compact value={courtsSummary(courtIds, allCourts)} onPress={() => setSheet("courts")} /> : null}
          </View>

          {venuesLoading || query.isLoading ? (
            <View style={{ gap: space[3] }} accessibilityLabel="Loading">
              <Skeleton height={320} r={26} />
              <SkeletonCard />
            </View>
          ) : forbidden ? (
            <Banner tone="waiting" title="Aapke paas Aaj dekhne ki ijazat nahi hai." body='Owner se "View dashboard, bookings and ledger" ki ijazat maangein.' />
          ) : query.isError && !data ? (
            <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} />
          ) : data ? (
            <>
              {rows.some((r) => r.kind === "booked") || data.operating_day ? (
                <CourtsTimeline
                  rows={rows}
                  courts={timelineCourts}
                  operatingDay={data.operating_day}
                  nowMs={nowMs}
                  onOpen={(id) => setDetailId(id)}
                  onAdd={perms.can("walkin") ? (courtId, startsAt) => router.push({ pathname: "/(owner)/walkin", params: { courtId, startsAt } }) : undefined}
                />
              ) : (
                <Text variant="body" tone="muted">
                  Is din venue band hai ya koi booking nahi.
                </Text>
              )}

              {isOwner ? <CnicBanner /> : null}
              {activeVenue?.status === "approved" && activeVenue.player_hidden_reason === "cnic" ? (
                // audit 2026-10-28 Phase 2 item 2: approved, but hidden from players until the owner's CNIC is approved
                <Banner
                  tone="danger"
                  title="Players ko venue abhi nazar nahi aa raha"
                  body="Aap ka CNIC abhi approve nahi hua. CNIC approve hote hi venue players ko dikhne lagega."
                  testID="venue-hidden-cnic"
                />
              ) : null}

              <Text variant="title" accessibilityRole="header" style={{ marginTop: space[2] }}>
                {`${dateTitle(date)} ki bookings`}
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
                <FilterPill label={`Sab ${counts.all}`} selected={filter === "all"} onPress={() => setFilter("all")} />
                <FilterPill label={`Booked ${counts.booked}`} selected={filter === "booked"} onPress={() => setFilter("booked")} />
                <FilterPill label={`Cancelled ${counts.cancelled}`} selected={filter === "cancelled"} onPress={() => setFilter("cancelled")} />
                <FilterPill label={`Refund ${counts.refund}`} selected={filter === "refund"} onPress={() => setFilter("refund")} />
              </View>
              <View style={{ gap: space[3] }} onLayout={(e) => (listY.current = e.nativeEvent.layout.y)}>
                {shown.length === 0 ? (
                  <Text variant="body" tone="muted" align="center" style={{ paddingVertical: space[6] }}>
                    Is din koi booking nahi.
                  </Text>
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
              <Text variant="caption" tone="muted">
                Kisi bhi card ya timeline block par dabayein: poori detail neeche se khulti hai.
              </Text>
              {/* OwnerToday board: the screen ends with the bookings (the day's money and counts live in the Paisa tab). */}
            </>
          ) : null}
        </HeroLayout>
      </ScrollView>

      {sheet === "venue" ? (
        <BottomSheet title="Venue chunein" subtitle="Har screen isi venue ki cheezein dikhayegi" onClose={() => setSheet(null)}>
          <View style={{ gap: space[2] }} accessibilityRole="radiogroup">
            {venues.map((v) => (
              <Chip
                key={v.id}
                shape="tile"
                block
                label={v.name}
                meta={v.status === "approved" ? "Live" : VENUE_STATUS[v.status] ?? v.status}
                selected={v.id === activeVenueId}
                onPress={() => {
                  setVenueId(v.id);
                  setSheet(null);
                }}
              />
            ))}
            {isOwner ? (
              <Button
                label="+ Add venue"
                variant="soft"
                block
                size="md"
                onPress={() => {
                  setSheet(null);
                  // Reuses the existing setup wizard, from a clean draft (not whatever was left half-done).
                  useVenueSetupStore.getState().reset();
                  router.push("/(owner)/venue-setup/register");
                }}
              />
            ) : null}
          </View>
        </BottomSheet>
      ) : null}
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
      {sheet === "free" ? <SlotsSheet date={date} courts={slotCourts} onlyFree={sheet === "free"} onClose={() => setSheet(null)} /> : null}
      {detailId ? <BookingDetailSheet bookingId={detailId} onClose={() => setDetailId(null)} onOpenBooking={(id) => setDetailId(id)} /> : null}
    </View>
  );
}

const VENUE_STATUS: Record<string, string> = { pending: "Review mein", changes_requested: "Tabdeeli chahiye", rejected: "Approve nahi hui" };


/** OStaffView board: the two big staff actions (teal Check-in scan, white Walk-in), each only with its permission. */
function StaffActions() {
  const perms = useMyPermissions();
  if (!perms.can("check_in") && !perms.can("walkin")) return null;
  return (
    <View testID="staff-actions" style={{ flexDirection: "row", gap: space[3] }}>
      {perms.can("check_in") ? (
        <Pressable onPress={() => router.push("/(owner)/checkin-scan")} accessibilityRole="button" accessibilityLabel="Check-in scan" style={{ flex: 1, minHeight: 100, borderRadius: radius.card, backgroundColor: palette.teal, alignItems: "center", justifyContent: "center", gap: space[2] }}>
          <ScanLine size={26} color={palette.white} />
          <Text variant="bodyStrong" tone="onDark">Check-in scan</Text>
        </Pressable>
      ) : null}
      {perms.can("walkin") ? (
        <Pressable onPress={() => router.push("/(owner)/walkin")} accessibilityRole="button" accessibilityLabel="Walk-in" style={{ flex: 1, minHeight: 100, borderRadius: radius.card, backgroundColor: palette.white, alignItems: "center", justifyContent: "center", gap: space[2] }}>
          <Plus size={26} color={palette.teal} />
          <Text variant="bodyStrong">Walk-in</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * OStaffView board, staff without the ledger: hero "Venue · Staff: Name" over "Aaj · Sun 1 Nov", the two big actions, and
 * the line that money and settings are the owner's. The board's "Aane wale players" list needs a booking list a
 * check-in-only account may read; every such endpoint needs view_ledger today, so it is not shown.
 */
function StaffAaj({ venueName, venueId, canCheckIn }: { venueName?: string; venueId?: string; canCheckIn: boolean }) {
  const tabRoom = useTabBarRoom();
  const focused = useIsFocused();
  // OStaffView "Aane wale players": GET /owners/arrivals (check_in staff, today only, name / court / times / checked-in).
  const arrivals = useQuery({
    queryKey: ["owner-arrivals", venueId],
    queryFn: () => api.owners.arrivals(venueId),
    enabled: canCheckIn,
    refetchInterval: 60_000,
    subscribed: focused,
  });
  const nowMs = Date.now();
  const name = useAuthStore((s) => s.user?.name);
  const eyebrow = [venueName, name ? `Staff: ${name.split(" ")[0]}` : "Staff"].filter(Boolean).join(" · ");
  return (
    <ScrollView testID="staff-aaj" contentContainerStyle={{ paddingBottom: tabRoom }}>
      <HeroLayout
        hero={
          <View style={{ gap: 8 }}>
            <Text variant="label" tone="hero">{eyebrow}</Text>
            <Text variant="display" tone="hero">{`Aaj · ${formatDayHeader(pktDateString())}`}</Text>
          </View>
        }
      >
        <StaffActions />
        {canCheckIn ? (
          <View style={{ gap: 10 }} testID="staff-arrivals">
            <Text variant="bodyStrong" accessibilityRole="header" style={{ paddingTop: 6, paddingHorizontal: space[1] }}>
              Aane wale players
            </Text>
            {arrivals.isLoading ? (
              <SkeletonCard />
            ) : arrivals.isError ? (
              <ErrorState message={friendlyErrorMessage(arrivals.error)} onRetry={() => arrivals.refetch()} />
            ) : (arrivals.data?.items ?? []).length === 0 ? (
              <Text variant="body" tone="muted" style={{ paddingHorizontal: space[1] }}>
                Aaj abhi koi pakki booking nahi.
              </Text>
            ) : (
              arrivals.data!.items.map((a, i) => {
                const row = arrivalRow(a, nowMs);
                return (
                  <View
                    key={`${a.starts_at}-${a.court_name}-${i}`}
                    accessible
                    accessibilityLabel={`${a.player_name}, ${row.meta}, ${row.status}`}
                    style={{ backgroundColor: palette.white, borderRadius: 18, paddingVertical: 12, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 12 }}
                  >
                    <View style={{ width: 56, height: 44, borderRadius: 12, backgroundColor: palette.tealTint, alignItems: "center", justifyContent: "center" }}>
                      <Text variant="label" color={palette.tealDeep}>{row.time}</Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text variant="bodyBold" style={{ fontSize: 15 }} numberOfLines={1}>{a.player_name}</Text>
                      <Text variant="caption" tone="muted" numberOfLines={1}>{row.meta}</Text>
                    </View>
                    <View style={{ alignSelf: "center" }}>
                      <Pill size="sm" label={row.status} tone={row.tone} />
                    </View>
                  </View>
                );
              })
            )}
          </View>
        ) : null}
        <Text variant="caption" tone="muted" style={{ paddingHorizontal: space[1] }}>
          Paisa aur settings sirf owner dekh sakta hai. Zyada access ke liye owner se kahein.
        </Text>
      </HeroLayout>
    </ScrollView>
  );
}
