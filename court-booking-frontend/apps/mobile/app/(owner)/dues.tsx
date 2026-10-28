import { useState } from "react";
import { View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatWhen, type ShortPaymentDue } from "@court-booking/types";
import { formatPkr, palette, radius, space } from "@court-booking/ui-tokens";
import { Banner, Button, EmptyState, ErrorState, Screen, SkeletonCard, Text } from "@/components/ui";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { OwnerHeader } from "./_fl";

const STATUS: Record<ShortPaymentDue["status"], string> = {
  awaiting_reply: "Player ke jawab ka intezar",
  confirmed: "Player ne sahi kaha",
  disputed: "Player ne ghalat kaha",
  no_reply: "Player ne jawab nahi diya",
};

/**
 * audit 2026-10-28 Phase 3 items 4 + 5: the venue's open dues (short payments not settled yet). "Ghalat hai" ones wait for the
 * owner's decision (collect / waive); any due can be marked done when the rest was received. Owner, or staff with view_ledger.
 */
export default function DuesScreen() {
  const { activeVenue, activeVenueId } = useOwnerVenues();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["owner-dues", activeVenueId], queryFn: () => api.phase3.dues(activeVenueId!), enabled: !!activeVenueId });
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function act(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    setMessage(null);
    try {
      await fn();
      setMessage({ ok: true, text: ok });
      await queryClient.invalidateQueries({ queryKey: ["owner-dues"] });
      await queryClient.invalidateQueries({ queryKey: ["owner-approvals-queue"] });
    } catch (e) {
      setMessage({ ok: false, text: friendlyErrorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen testID="dues-screen" refreshing={query.isRefetching} onRefresh={() => query.refetch()}>
      <OwnerHeader title="Baqi raqam (dues)" subtitle={activeVenue?.name} />
      {message ? <Banner tone={message.ok ? "open" : "danger"} body={message.text} /> : null}
      {query.isError ? (
        <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} />
      ) : !query.data ? (
        <SkeletonCard />
      ) : query.data.length === 0 ? (
        <EmptyState title="Koi baqi nahi" body="Kisi booking par paisa baqi nahi hai." />
      ) : (
        query.data.map((d) => (
          <View key={d.id} style={{ backgroundColor: palette.white, borderRadius: radius.card, padding: space[4], gap: space[2] }} testID="due-row">
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space[2] }}>
              <Text variant="bodyStrong" style={{ flex: 1 }}>{`${d.player_name ?? "Player"} · ${d.code}`}</Text>
              <Text variant="bodyStrong">{formatPkr(d.due_pkr)}</Text>
            </View>
            <Text variant="meta" tone="muted">
              {[STATUS[d.status], d.starts_at ? formatWhen(d.starts_at, new Date(), "ru") : null].filter(Boolean).join(" · ")}
            </Text>
            {d.player_reason ? <Text variant="body">{`Player: ${d.player_reason}`}</Text> : null}
            {d.owner_decision === "collect" ? <Text variant="meta" tone="muted">Aap ne raqam lena tay kiya.</Text> : null}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
              {d.status === "disputed" && !d.owner_decision ? (
                <>
                  <Button label="Raqam lein" size="md" variant="soft" loading={busy === `c${d.id}`} onPress={() => act(`c${d.id}`, () => api.phase3.decideShort(d.id, "collect"), "Baqi raqam rakhi gayi; player ko bata diya.")} testID="due-collect" />
                  <Button label="Maaf karein" size="md" variant="danger" loading={busy === `w${d.id}`} onPress={() => act(`w${d.id}`, () => api.phase3.decideShort(d.id, "waive"), "Baqi maaf kar diya; player ko bata diya.")} testID="due-waive" />
                </>
              ) : null}
              <Button label="Done (paisa mil gaya)" size="md" loading={busy === `d${d.id}`} onPress={() => act(`d${d.id}`, () => api.phase3.dueDone(d.id), "Darj ho gaya: baqi clear.")} testID="due-done" />
            </View>
          </View>
        ))
      )}
    </Screen>
  );
}
