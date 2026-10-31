import { useState } from "react";
import { View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { addDays, formatDateRelative, formatTime, pktDateString, type BankCheckItem } from "@court-booking/types";
import { formatPkr, palette, radius, space } from "@court-booking/ui-tokens";
import { Banner, Button, Chip, EmptyState, ErrorState, Screen, SkeletonCard, Text } from "@/components/ui";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { OwnerHeader } from "./_fl";

/**
 * audit 2026-10-28 Phase 3 item 2: "Bank se mila lein" on the app -- every transfer credited on one day (advance and balance
 * screenshots approved), to tick off against the bank statement. Owner, or staff with view_ledger. Same endpoint as the web page.
 */
export default function BankCheckScreen() {
  const { activeVenue, activeVenueId } = useOwnerVenues();
  const today = pktDateString();
  const [day, setDay] = useState(today);
  const query = useQuery({
    queryKey: ["bank-check", activeVenueId, day],
    queryFn: () => api.owners.bankCheck(activeVenueId!, day),
    enabled: !!activeVenueId,
  });
  const data = query.data;
  const days = [0, -1, -2, -3, -4, -5, -6].map((n) => addDays(today, n));

  return (
    <Screen testID="bank-check-screen" refreshing={query.isRefetching} onRefresh={() => query.refetch()}>
      <OwnerHeader title="Bank se mila lein" subtitle={activeVenue?.name} />
      <Text variant="meta" tone="muted">
        Is din transfer se jo paisa darj hua (advance aur baqi). Apni bank statement se ek ek mila lein.
      </Text>
      <View style={{ flexDirection: "row", gap: space[2], flexWrap: "wrap" }} accessibilityRole="radiogroup" accessibilityLabel="Din">
        {days.map((d) => (
          <Chip key={d} label={formatDateRelative(`${d}T12:00:00+05:00`, new Date(), "ru")} selected={day === d} onPress={() => setDay(d)} />
        ))}
      </View>
      {query.isError ? (
        <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} />
      ) : !data ? (
        <SkeletonCard />
      ) : data.items.length === 0 ? (
        <EmptyState title="Kuch nahi aaya" body="Is din transfer se koi paisa darj nahi hua." />
      ) : (
        <>
          {data.items.map((i) => (
            <View
              key={i.entry_id}
              style={{
                backgroundColor: i.not_received ? palette.dangerTint : palette.white,
                borderColor: i.not_received ? palette.dangerBorder : "transparent",
                borderWidth: i.not_received ? 1.5 : 0,
                borderRadius: radius.tile,
                padding: space[3],
                gap: 2,
              }}
              testID="bank-check-row"
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space[2] }}>
                <Text variant="bodyStrong" style={{ flex: 1 }}>{i.player_name ?? "Player"}</Text>
                <Text variant="bodyStrong">{formatPkr(i.amount_pkr)}</Text>
              </View>
              <Text variant="meta" tone="muted">{`${formatTime(i.credited_at)} · ${i.kind === "balance" ? "Baqi" : "Advance"} · ${i.code} · ${i.court_name}`}</Text>
              <Text variant="meta" tone="muted">{`Approve: ${i.approved_by === "auto" ? "khud (auto)" : i.approved_by}`}</Text>
              <NotReceived item={i} />
            </View>
          ))}
          <View style={{ backgroundColor: palette.white, borderRadius: radius.card, padding: space[4] }} testID="bank-check-total">
            <Text variant="title">{`Kul: ${formatPkr(data.total_pkr)}`}</Text>
          </View>
        </>
      )}
    </Screen>
  );
}

/** audit fixes 2026-10-31 (b): the owner marks a balance transfer approved at the venue "bank mein nahi mila". The money stops
 * counting, it shows red on "Staff ka kaam" under whoever approved it, and the player hears nothing. */
function NotReceived({ item }: { item: BankCheckItem }) {
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (item.not_received) {
    const choice = item.decision === "staff" ? " · Staff se wasool" : item.decision === "player" ? " · Player se maanga" : "";
    return (
      <Text variant="meta" weight="bold" tone="danger" testID="bank-not-received-tag">
        {`Bank mein nahi mila${choice}`}
      </Text>
    );
  }
  if (!item.can_mark) return null;
  async function mark() {
    setBusy(true);
    setError(null);
    try {
      await api.owners.bankNotReceived(item.entry_id);
      setAsking(false);
      await queryClient.invalidateQueries({ queryKey: ["bank-check"] });
      await queryClient.invalidateQueries({ queryKey: ["staff-activity"] });
    } catch (e) {
      setError(friendlyErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: space[2], paddingTop: space[1] }}>
      {asking ? (
        <>
          <Banner
            tone="danger"
            body={'Yeh transfer bank mein nahi aaya? Raqam hisaab se nikal jayegi aur "Staff ka kaam" par laal dikhegi. Player ko koi message nahi jayega.'}
          />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
            <Button label="Haan, nahi mila" size="sm" loading={busy} onPress={mark} testID="bank-mark-yes" />
            <Button label="Wapas" size="sm" variant="soft" onPress={() => setAsking(false)} />
          </View>
        </>
      ) : (
        <View style={{ flexDirection: "row" }}>
          <Button label="Bank mein nahi mila" size="sm" variant="soft" onPress={() => setAsking(true)} testID="bank-mark" />
        </View>
      )}
      {error ? <Banner tone="danger" body={error} /> : null}
    </View>
  );
}
