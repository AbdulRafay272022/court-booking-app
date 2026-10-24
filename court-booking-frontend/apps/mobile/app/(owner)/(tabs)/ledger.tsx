import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { router, useIsFocused } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Download } from "lucide-react-native";
import type { LedgerEntry } from "@court-booking/types";
import { alpha, palette, radius, shadow, size, space, type Tone } from "@court-booking/ui-tokens";
import { Banner, Button, Chip, EmptyState, ErrorState, Pill, Skeleton, Text, useRoleTheme } from "@/components/ui";

import { courtLabel, sportForCourtName } from "@/components/court-label";
import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { shareCsv } from "@/lib/export-csv";
import { addDays, formatPKR, formatShortDate, formatTime, pktDateString } from "@/lib/format";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { NoAccess } from "@/components/no-access";
import { invalidateOwnerMoney } from "@/lib/owner-cache";
import { useMyPermissions } from "@/lib/use-my-permissions";
import { useFeatureFlags } from "@/lib/use-feature-flags";
import { CorrectPaymentSheet } from "@/components/correct-payment-sheet";
import { HeroLayout, PaisaSwitch } from "../_fl";

type RangeKey = "7d" | "30d" | "month";

function rangeFor(key: RangeKey): { start: string; end: string } {
  // Pakistan calendar dates (`toISOString().slice(0, 10)` is the UTC date: yesterday until 5 AM in Karachi).
  const end = pktDateString();
  const start = key === "7d" ? addDays(end, -6) : key === "30d" ? addDays(end, -29) : `${end.slice(0, 8)}01`;
  return { start, end };
}

const RANGE_LABEL: Record<RangeKey, string> = { "7d": "7 din", "30d": "30 din", month: "Is mahine" };
const RANGE_HEAD: Record<RangeKey, string> = { "7d": "Pichle 7 din mein mila", "30d": "Pichle 30 din mein mila", month: "Is mahine mila" };

/** The booking's state, as a pill on the row (text, not colour only). */
const STATUS: Record<string, { label: string; tone: Tone }> = {
  booked: { label: "Paid", tone: "open" },
  completed: { label: "Mukammal", tone: "info" },
  payment_submitted: { label: "Review", tone: "waiting" },
  cancelled: { label: "Cancelled", tone: "danger" },
  no_show: { label: "No-show", tone: "neutral" },
  held: { label: "Hold", tone: "neutral" },
};

const METHOD_LABEL: Record<string, string> = { bank_transfer_proof: "Bank", cash_at_venue: "Cash", other: "Kuch aur" };

/** OPaisa frame 1 (Ledger): every payment entry (GET /owners/ledger). The "Aaj" tile is `collected_today`, the SAME number
 * the Aaj hero shows. "Theek karein" reverses one entry (POST /payment-entries/{id}/reverse, flag split_payments). */
export default function LedgerScreen() {
  const t = useRoleTheme();
  const { activeVenue, activeVenueId, isLoading: venuesLoading } = useOwnerVenues();
  const [rangeKey, setRangeKey] = useState<RangeKey>("30d");
  const [courtId, setCourtId] = useState<string | undefined>(undefined);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState<LedgerEntry | null>(null);
  const { start, end } = useMemo(() => rangeFor(rangeKey), [rangeKey]);
  const queryClient = useQueryClient();
  const perms = useMyPermissions();
  const flags = useFeatureFlags();
  const allowed = perms.can("view_ledger");
  const mayCorrect = perms.can("record_payments") && flags.on("split_payments");

  const query = useQuery({
    queryKey: ["owner-ledger", activeVenueId, courtId, start, end],
    queryFn: () => api.owners.ledger(start, end, { venueId: activeVenueId, courtId }),
    enabled: !!activeVenueId && allowed,
    subscribed: useIsFocused(),
  });

  const courts = activeVenue?.courts ?? [];
  const ledger = query.data;
  const summary = ledger?.summary;

  async function handleExport() {
    setExporting(true);
    setExportError(null);
    try {
      const csv = await api.owners.ledgerExportCsv(start, end, { venueId: activeVenueId, courtId });
      await shareCsv(csv, `ledger_${start}_${end}.csv`);
    } catch (e) {
      setExportError(friendlyErrorMessage(e));
    } finally {
      setExporting(false);
    }
  }

  if (perms.settled && !allowed) return <NoAccess what="Ledger" withBack={false} />;

  const hero = (
    <View style={{ gap: space[4] }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[3] }}>
        <Text variant="h1" tone="hero" accessibilityRole="header">
          Paisa
        </Text>
        <Pressable
          onPress={handleExport}
          disabled={exporting || !ledger || ledger.entries.length === 0}
          accessibilityRole="button"
          accessibilityLabel="Ledger CSV export karein"
          style={{ minHeight: size.tap, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, borderRadius: radius.pill, backgroundColor: alpha.glassOnTeal, borderWidth: 1, borderColor: alpha.glassOnTealBorder, opacity: exporting || !ledger || ledger.entries.length === 0 ? 0.6 : 1 }}
        >
          <Download size={16} color={palette.white} />
          <Text variant="bodyBold" tone="hero">
            {exporting ? "Ban raha hai" : "CSV"}
          </Text>
        </Pressable>
      </View>
      <PaisaSwitch current="ledger" />
      <View style={{ gap: space[1] }}>
        <Text variant="bodyBold" tone="hero">
          {RANGE_HEAD[rangeKey]}
        </Text>
        {ledger ? (
          <Text testID="ledger-total" variant="display" tone="hero">{`PKR ${formatPKR(ledger.summary.total_in_range)}`}</Text>
        ) : (
          <Skeleton width={200} height={40} r={10} />
        )}
        {ledger ? <Text variant="meta" tone="heroMuted">{`${ledger.entries.length} ${ledger.entries.length === 1 ? "payment" : "payments"}`}</Text> : null}
      </View>
      {summary ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
          <Tile label="Aaj" value={summary.collected_today} testID="ledger-today" />
          <Tile label="Is hafte" value={summary.collected_this_week} />
          <Tile label="Is mahine" value={summary.collected_this_month} />
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.ground }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: size.tabBarOwner + 64 }}
        refreshControl={<RefreshControl refreshing={query.isRefetching && !query.isLoading} onRefresh={() => query.refetch()} tintColor={t.ring} colors={[t.ring]} />}
      >
        <HeroLayout hero={hero} testID="paisa-hero">
          {exportError ? <Banner tone="danger" title="Export nahi hua" body={exportError} /> : null}
          {summary && (summary.outstanding_balance > 0 || summary.cancelled_refund_pending > 0) ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
              {summary.outstanding_balance > 0 ? (
                <Pressable
                  onPress={() => router.push({ pathname: "/(owner)/history", params: { status: "booked" } })}
                  accessibilityRole="button"
                  accessibilityLabel={`Bookings par baqi PKR ${formatPKR(summary.outstanding_balance)}`}
                  style={{ flexGrow: 1, flexBasis: 140, backgroundColor: palette.waitingTint, borderRadius: radius.tile, padding: 14, gap: 2 }}
                >
                  <Text variant="meta" weight="bold" tone="waiting">
                    Bookings par baqi
                  </Text>
                  <Text variant="title" tone="waiting">{`PKR ${formatPKR(summary.outstanding_balance)}`}</Text>
                </Pressable>
              ) : null}
              {summary.cancelled_refund_pending > 0 ? (
                <Pressable
                  onPress={() => router.navigate("/(owner)/(tabs)/refunds")}
                  accessibilityRole="button"
                  accessibilityLabel={`Refund dena hai PKR ${formatPKR(summary.cancelled_refund_pending)}. Refunds kholein`}
                  style={{ flexGrow: 1, flexBasis: 140, backgroundColor: palette.dangerTint, borderRadius: radius.tile, padding: 14, gap: 2 }}
                >
                  <Text variant="meta" weight="bold" tone="danger">
                    Refund dena hai
                  </Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                    <Text variant="title" tone="danger">{`PKR ${formatPKR(summary.cancelled_refund_pending)}`}</Text>
                    <ChevronRight size={18} color={palette.danger} />
                  </View>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }} accessibilityLabel="Muddat">
            {(["7d", "30d", "month"] as const).map((k) => (
              <Chip key={k} label={RANGE_LABEL[k]} selected={rangeKey === k} onPress={() => setRangeKey(k)} />
            ))}
          </View>
          {courts.length > 1 ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }} accessibilityLabel="Court">
              <Chip label="Sab courts" selected={!courtId} onPress={() => setCourtId(undefined)} />
              {courts.map((c) => (
                <Chip key={c.id} label={courtLabel(c.name, c.sport)} selected={courtId === c.id} onPress={() => setCourtId(c.id)} />
              ))}
            </View>
          ) : null}

          {venuesLoading || query.isLoading ? (
            <View style={{ gap: space[2] }} accessibilityLabel="Loading">
              <Skeleton height={72} r={radius.tile} />
              <Skeleton height={72} r={radius.tile} />
              <Skeleton height={72} r={radius.tile} />
            </View>
          ) : query.isError && !ledger ? (
            <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} />
          ) : !ledger || ledger.entries.length === 0 ? (
            <EmptyState title="Is muddat mein koi payment nahi" body="Lambi muddat ya doosra court chun kar dekhein." />
          ) : (
            <View testID="ledger-rows" style={{ backgroundColor: palette.white, borderRadius: radius.card, overflow: "hidden", boxShadow: shadow.card }}>
              {ledger.entries
                .slice()
                .reverse()
                .map((entry, i, arr) => {
                  const st = STATUS[entry.booking_status] ?? STATUS.held;
                  const isCorrection = entry.amount_pkr < 0;
                  const court = courtLabel(entry.court, entry.court_sport ?? sportForCourtName(courts, entry.court));
                  return (
                    <View key={entry.entry_id} testID="ledger-row" style={{ flexDirection: "row", gap: space[3], padding: 14, borderBottomWidth: i < arr.length - 1 ? 1 : 0, borderBottomColor: palette.divider }}>
                      <View style={{ flex: 1, gap: 3 }}>
                        <Text variant="bodyBold">{entry.player ?? "Walk-in"}</Text>
                        <Text variant="caption" tone="muted">{`${formatShortDate(entry.recorded_at)} · ${formatTime(entry.recorded_at)} · ${court} · ${METHOD_LABEL[entry.method] ?? entry.method}`}</Text>
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, paddingTop: 2 }}>
                          <Pill size="sm" label={st.label} tone={st.tone} />
                          {entry.entry_type === "refund" ? <Pill size="sm" label="Refund" tone="danger" /> : null}
                          {entry.entry_type === "correction" ? <Pill size="sm" label="Correction" tone="danger" /> : null}
                        </View>
                        {entry.entry_type === "refund" && entry.note ? (
                          <Text variant="caption" tone="muted">
                            {entry.note}
                          </Text>
                        ) : null}
                      </View>
                      <View style={{ alignItems: "flex-end", gap: 6 }}>
                        <Text variant="bodyStrong" tone={isCorrection ? "danger" : "primary"}>
                          {`${isCorrection ? "-" : ""}PKR ${formatPKR(Math.abs(entry.amount_pkr))}`}
                        </Text>
                        {!isCorrection && mayCorrect ? <Button label="Theek karein" variant="soft" size="sm" onPress={() => setCorrecting(entry)} accessibilityLabel={`${entry.player ?? "Walk-in"} ki payment theek karein`} /> : null}
                      </View>
                    </View>
                  );
                })}
            </View>
          )}
        </HeroLayout>
      </ScrollView>

      {correcting ? (
        <CorrectPaymentSheet
          entry={correcting}
          onClose={() => setCorrecting(null)}
          onReversed={() => {
            setCorrecting(null);
            void invalidateOwnerMoney(queryClient);
          }}
        />
      ) : null}
    </View>
  );
}

function Tile({ label, value, testID }: { label: string; value: number; testID?: string }) {
  return (
    <View testID={testID} style={{ flexGrow: 1, flexBasis: 90, borderRadius: radius.input, paddingHorizontal: space[3], paddingVertical: 10, backgroundColor: alpha.glassOnTeal, borderWidth: 1, borderColor: alpha.glassOnTealBorder, gap: 2 }}>
      <Text variant="caption" weight="bold" tone="heroMuted">
        {label}
      </Text>
      <Text variant="bodyBold" tone="hero">{`PKR ${formatPKR(value)}`}</Text>
    </View>
  );
}
