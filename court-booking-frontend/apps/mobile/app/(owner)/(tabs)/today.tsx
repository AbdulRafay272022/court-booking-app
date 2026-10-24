import { useEffect, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { router, useIsFocused } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Bell, ChevronDown, ChevronLeft, ChevronRight, Clock, History, Plus, ScanLine } from "lucide-react-native";
import type { OwnerBookingRow, OwnerOverview } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";
import { alpha, initials, palette, radius, shadow, size, space } from "@court-booking/ui-tokens";
import { Badge, Banner, Button, Chip, ErrorState, IconButton, Skeleton, SkeletonCard, Text, useRoleTheme } from "@/components/ui";

import { friendlyErrorMessage } from "@/lib/error-messages";
import { addDays, formatDayHeader, formatPKR, pktDateString } from "@/lib/format";
import { api } from "@/lib/api";
import { pollInterval } from "@/lib/polling";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { useAuthStore } from "@/lib/auth-store";
import { useVenueSetupStore } from "@/lib/venue-setup-store";
import { courtShort, dateTitle, historyParams, statusPendingLine } from "@/lib/overview";
import { allDatesRange } from "@/lib/round2-format";
import { heroCollected, oldestWaitMinutes, waitLabel } from "@/lib/owner-floodlight";
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
import { BottomSheet, Pill as FilterPill, SelectButton, SmallChip } from "@/components/overview/ui";
import { VenueStatusBanner } from "../_dashboard-components";
import { HeroChip, HeroLayout } from "../_fl";
import { CourtsTimeline } from "../_timeline";

type Filter = "all" | "booked" | "cancelled" | "refund";

/** OwnerToday board ("Aaj"): teal hero with the money that came in (the SAME ledger number as Paisa, audit G14), the
 * approvals card, the multi-court day timeline, then the day's bookings and the full day summary (slots, pending,
 * KPIs) the Overview had. */
export default function OwnerTodayScreen() {
  const t = useRoleTheme();
  const { venues, activeVenue, activeVenueId, setVenueId, isLoading: venuesLoading } = useOwnerVenues();
  const isOwner = useAuthStore((s) => s.user?.role) === "owner";
  const today = pktDateString();
  const [date, setDate] = useState(today);
  const [courtIds, setCourtIds] = useState<string[]>([]);
  const [sheet, setSheet] = useState<null | "date" | "courts" | "slots" | "free" | "booked-courts" | "venue">(null);
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

  const courtsByBooked = data ? [...data.slots.by_court].sort((a, b) => b.booked - a.booked) : [];
  // Round 2 (A7): pending for ANY date; an older backend without pending_all falls back to this day's numbers.
  const pendingAll = data?.pending_all
    ? { ...data.pending_all, allDays: true }
    : { count: data?.bookings.pending.count ?? 0, awaiting_approval: data?.bookings.pending.awaiting_approval ?? 0, awaiting_payment: data?.bookings.pending.awaiting_payment ?? 0, allDays: false };
  const slotCourts = (courtIds.length ? allCourts.filter((c) => courtIds.includes(c.id)) : allCourts).map((c) => ({ id: c.id, name: c.name }));
  const timelineCourts = slotCourts;
  const sports = [...new Set(allCourts.map((c) => c.sport).filter(Boolean))].join(", ");
  const dayWord = date === today ? "AAJ" : date === addDays(today, 1) ? "KAL" : date === addDays(today, -1) ? "KAL (GUZRA)" : null;
  const dayLine = `${dayWord ? `${dayWord} · ` : ""}${formatDayHeader(date).toUpperCase()}`;

  if (perms.settled && !allowed) return <NoAccess what="Aaj" withBack={false} />;

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
            <HeroChip label={`${data.slots.free_upcoming} slots khaali aage`} onPress={() => setSheet("free")} />
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
        contentContainerStyle={{ paddingBottom: size.tabBarOwner + 64 }}
        refreshControl={<RefreshControl refreshing={query.isRefetching && !query.isLoading} onRefresh={() => { void query.refetch(); void ledger.refetch(); }} tintColor={t.ring} colors={[t.ring]} />}
      >
        <HeroLayout hero={hero} testID="today-hero">
          {badges.approvals > 0 ? (
            <Pressable
              testID="approvals-card"
              onPress={() => router.push({ pathname: "/(owner)/(tabs)/approvals", params: courtIds.length ? { courts: courtIds.join(",") } : {} })}
              accessibilityRole="button"
              accessibilityLabel={`${badges.approvals} payments check karni hain. Dekhein`}
              style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space[3], backgroundColor: palette.white, borderRadius: 22, padding: 14, boxShadow: shadow.card }}
            >
              <View style={{ width: 48, height: 48, borderRadius: radius.input, backgroundColor: palette.waitingTint, alignItems: "center", justifyContent: "center" }}>
                <Text variant="title" color={palette.waiting}>
                  {String(badges.approvals)}
                </Text>
              </View>
              <View style={{ flex: 1, minWidth: 150, gap: 2 }}>
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

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
            {perms.can("check_in") ? <Button label="Check-in" variant="soft" size="sm" icon={<ScanLine size={16} color={palette.night} />} onPress={() => router.push("/(owner)/checkin")} /> : null}
            {perms.can("walkin") ? <Button label="Add booking" variant="soft" size="sm" icon={<Plus size={16} color={palette.night} />} onPress={() => router.push("/(owner)/walkin")} /> : null}
            <Button label="History" variant="soft" size="sm" icon={<History size={16} color={palette.night} />} onPress={() => goHistory()} />
          </View>

          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: space[2], paddingTop: space[1] }}>
            <Text variant="title" accessibilityRole="header">
              Courts ka din
            </Text>
            {allCourts.length > 1 ? <SelectButton compact value={courtsSummary(courtIds, allCourts)} onPress={() => setSheet("courts")} /> : null}
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

              <Text variant="title" accessibilityRole="header" style={{ marginTop: space[2] }}>
                Din ka hisaab
              </Text>
              {/* Round 2 (A7) top row: Total slots, then Pending bookings (any date). */}
              <View testID="total-slots-card" style={{ backgroundColor: palette.white, borderRadius: radius.card, padding: space[4], gap: space[3], boxShadow: shadow.card }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[2], flexWrap: "wrap" }}>
                  <Text variant="bodyBold" tone="muted">
                    Total slots
                  </Text>
                  <Chip label="Sab slots dekho" onPress={() => setSheet("slots")} />
                </View>
                <Text variant="display">{String(data.slots.total)}</Text>
                <View style={{ flexDirection: "row", height: 10, borderRadius: radius.pill, overflow: "hidden", backgroundColor: palette.tealHalf }} accessibilityLabel="Slots split">
                  {(["booked", "pending", "blocked"] as const).map((k) =>
                    data.slots[k] > 0 && data.slots.total > 0 ? <View key={k} style={{ flex: data.slots[k], backgroundColor: k === "booked" ? palette.teal : k === "pending" ? palette.amber : palette.muted2 }} /> : null,
                  )}
                  {data.slots.free > 0 && data.slots.total > 0 ? <View style={{ flex: data.slots.free }} /> : null}
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
                  <LegendButton label={`Booked ${data.slots.booked}`} swatch={palette.teal} onPress={() => goHistory("booked")} />
                  <LegendButton
                    label={`Pending ${data.slots.pending}`}
                    sub="Is din ke slots"
                    swatch={palette.amber}
                    onPress={() => router.push({ pathname: "/(owner)/(tabs)/approvals", params: { date, ...(courtIds.length ? { courts: courtIds.join(",") } : {}) } })}
                  />
                  <LegendButton label={`Blocked ${data.slots.blocked}`} swatch={palette.muted2} onPress={() => setSheet("slots")} />
                  <LegendButton label={`Free ${data.slots.free}`} swatch={palette.tealHalf} onPress={() => setSheet("free")} />
                </View>
                <Text variant="meta" tone="muted">{`Khali: ${data.slots.free_upcoming} aane wale - ${data.slots.free_past} guzre hue`}</Text>
                {courtsByBooked.length > 0 ? (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                    {courtsByBooked.slice(0, 2).map((c) => (
                      <SmallChip key={c.court_id} label={`${courtShort(c.court_name)}: ${c.booked}/${c.total} booked`} tone="neutral" />
                    ))}
                    {courtsByBooked.length > 2 ? <SmallChip label={`+${courtsByBooked.length - 2} aur`} tone="info" onPress={() => setSheet("booked-courts")} /> : null}
                  </View>
                ) : null}
              </View>

              <View testID="pending-all-card" style={{ backgroundColor: palette.waitingTint, borderRadius: radius.card, overflow: "hidden" }}>
                <Pressable
                  onPress={() => router.push({ pathname: "/(owner)/(tabs)/approvals", params: courtIds.length ? { courts: courtIds.join(",") } : {} })}
                  accessibilityRole="button"
                  accessibilityLabel={`Pending bookings ${pendingAll.count}`}
                  style={{ padding: space[4], gap: space[1] }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[2] }}>
                    <Text variant="bodyBold" tone="waiting">
                      Pending bookings
                    </Text>
                    <Text variant="caption" weight="bold" tone="waiting">
                      {pendingAll.allDays ? "Sab dino ki" : "Is din ki"}
                    </Text>
                  </View>
                  <Text variant="h2">{String(pendingAll.count)}</Text>
                  <Text variant="meta" weight="bold" tone="waiting" style={{ textDecorationLine: "underline" }}>
                    {`Approval (${pendingAll.awaiting_approval})`}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    const r = allDatesRange();
                    router.push({ pathname: "/(owner)/history", params: historyParams(r.from, courtIds, "held", { to: r.to }) });
                  }}
                  accessibilityRole="button"
                  style={{ minHeight: size.tap, paddingHorizontal: space[4], paddingBottom: space[2], justifyContent: "center" }}
                >
                  <Text variant="meta" weight="bold" tone="waiting" style={{ textDecorationLine: "underline" }}>
                    {`Payment ke intezar (${pendingAll.awaiting_payment})`}
                  </Text>
                </Pressable>
              </View>

              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[3] }}>
                <KpiCard label="Bookings" value={String(data.bookings.count)} sub={`${data.slots.booked} slots mein`} onPress={() => goHistory("booked")} />
                <KpiCard label="Cancelled" value={String(data.bookings.cancelled)} onPress={() => goHistory("cancelled")} />
                <KpiCard label="Refunds" value={String(data.bookings.refunds.count)} sub={`PKR ${formatPKR(data.bookings.refunds.amount)}`} onPress={() => goHistory("refund")} />
                <KpiCard label="Collected" value={`PKR ${formatPKR(data.money.collected)}`} small sub="Is din ki bookings par" onPress={() => goHistory("booked")} />
                <KpiCard label="Due" value={`PKR ${formatPKR(data.money.due)}`} small sub={data.money.due_bookings > 0 ? `${data.money.due_bookings} bookings` : undefined} onPress={() => goHistory("booked")} />
              </View>
              <Text variant="caption" tone="muted">
                &quot;Aaj aaya&quot; (upar) = is din ledger mein aaya paisa, Paisa tab jaisa. &quot;Collected&quot; = is din ki bookings par ab tak mila (kisi bhi din aaya ho).
              </Text>
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
      {sheet === "slots" || sheet === "free" ? <SlotsSheet date={date} courts={slotCourts} onlyFree={sheet === "free"} onClose={() => setSheet(null)} /> : null}
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
                style={{ minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[3], borderBottomWidth: 1, borderBottomColor: palette.divider }}
              >
                <Text variant="bodyBold">{c.court_name}</Text>
                <Text variant="bodyStrong">{`${c.booked} / ${c.total}`}</Text>
              </Pressable>
            ))}
        </BottomSheet>
      ) : null}
      {detailId ? <BookingDetailSheet bookingId={detailId} onClose={() => setDetailId(null)} onOpenBooking={(id) => setDetailId(id)} /> : null}
    </View>
  );
}

const VENUE_STATUS: Record<string, string> = { pending: "Review mein", changes_requested: "Tabdeeli chahiye", rejected: "Approve nahi hui" };

function KpiCard({ label, value, sub, small, onPress }: { label: string; value: string; sub?: string; small?: boolean; onPress: () => void }) {
  // Two per row (the fifth spans the row): flexBasis keeps the wrap grid even on a 320 pt phone.
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{ flexBasis: "45%", flexGrow: 1, backgroundColor: palette.white, borderRadius: radius.tile, padding: space[4], gap: 6 }}
    >
      <Text variant="meta" weight="bold" tone="muted">
        {label}
      </Text>
      <Text variant={small ? "title" : "h2"}>{value}</Text>
      {sub ? (
        <Text variant="caption" tone="muted">
          {sub}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** A legend entry that is also a 44 pt button (swatch + text, so colour is never the only signal). */
function LegendButton({ label, sub, swatch, onPress }: { label: string; sub?: string; swatch: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={sub ? `${label}, ${sub}` : label}
      style={{ minHeight: size.tap, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: space[3], paddingVertical: 6, borderRadius: radius.sm, borderWidth: 1.5, borderColor: palette.lineStrong, backgroundColor: palette.white }}
    >
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: swatch }} />
      <View>
        <Text variant="label">{label}</Text>
        {sub ? (
          <Text variant="caption" tone="muted">
            {sub}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

