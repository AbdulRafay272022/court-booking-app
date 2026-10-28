import { useState } from "react";
import { View } from "react-native";
import * as Location from "expo-location";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { BookingExtras } from "@court-booking/types";
import { formatPkr, space } from "@court-booking/ui-tokens";
import { Banner, Button, Card, Input, Text } from "@/components/ui";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";

/**
 * audit 2026-10-28 Phase 3 items 3, 4, 6 on the player's booking screen (every part hidden while its flag is off):
 * points rule + "use 500 points" (player_points), the "Total X, diye Y, baqi Z" question (short_payment_reply),
 * "Pohanch gaya" (ONE GPS reading) and "Main aaya tha" on a no-show (noshow_reply). Same endpoint as the web page.
 */
export function BookingExtrasCard({ bookingId }: { bookingId: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["booking-extras", bookingId], queryFn: () => api.phase3.extras(bookingId) });
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const data = query.data;
  if (!data) return null;
  const { points, short_payment: due, arrival } = data;
  const showPoints = points.state !== "off";
  if (!showPoints && !due && !arrival.enabled) return null;

  async function run(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    setMessage(null);
    try {
      const out = await fn();
      if (out && typeof out === "object" && "points" in (out as BookingExtras)) {
        queryClient.setQueryData(["booking-extras", bookingId], out);
      }
      setMessage({ ok: true, text: ok });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["booking-extras", bookingId] }),
        queryClient.invalidateQueries({ queryKey: ["booking", bookingId] }),
        queryClient.invalidateQueries({ queryKey: ["booking-detail", bookingId] }),
      ]);
    } catch (e) {
      setMessage({ ok: false, text: friendlyErrorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  async function arrive() {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== "granted") {
      setMessage({ ok: false, text: "Location ki ijazat do (phone Settings), phir dobara dabao." });
      return;
    }
    await run(
      "arrive",
      async () => {
        const pos = await Location.getCurrentPositionAsync({});
        return api.phase3.arrived(bookingId, pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy ?? null);
      },
      "Aap ki location darj ho gayi.",
    );
  }

  const verdictText = (v: string) =>
    v === "near" ? "Venue par darj ho gaya" : v === "far" ? "Venue se door lag rahe ho" : "Venue ka pin pakka nahi, darj kar liya";

  return (
    <Card padding={4} radiusSize="cardL" style={{ gap: space[3] }} testID="booking-extras">
      {due ? (
        <View style={{ gap: space[2] }} testID="extras-short">
          <Text variant="title" accessibilityRole="header">Hisaab check karo</Text>
          <Text variant="bodyStrong">{`Total ${formatPkr(due.total_pkr)}, diye ${formatPkr(due.paid_pkr)}, baqi ${formatPkr(due.due_pkr)}`}</Text>
          {due.can_reply ? (
            reasonOpen ? (
              <View style={{ gap: space[2] }}>
                <Input label="Kya ghalat hai? (venue ko jayega)" value={reason} onChangeText={setReason} multiline testID="extras-short-reason" />
                <Button label="Bhejo" variant="dangerSolid" block loading={busy === "no"} onPress={() => run("no", () => api.phase3.replyShort(due.id, "no", reason.trim()), "Aap ka jawab venue ko chala gaya. 5 points mile.")} />
                <Button label="Wapas" variant="soft" size="md" block onPress={() => setReasonOpen(false)} />
              </View>
            ) : (
              <>
                <Text variant="meta" tone="muted">24 ghante mein jawab do: jawab par 5 points, jawab na diya to 20 points katenge.</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
                  <Button label="Sahi hai" size="md" loading={busy === "yes"} onPress={() => run("yes", () => api.phase3.replyShort(due.id, "yes"), "Shukriya! 5 points mile.")} testID="extras-short-yes" />
                  <Button label="Ghalat hai" variant="danger" size="md" onPress={() => setReasonOpen(true)} testID="extras-short-no" />
                </View>
              </>
            )
          ) : (
            <Text variant="meta" tone="muted">
              {due.resolved_at
                ? due.resolution === "waived"
                  ? "Venue ne baqi maaf kar diya."
                  : "Baqi raqam clear ho gayi."
                : due.status === "confirmed"
                  ? "Aap ne hisaab sahi kaha. Baqi agli dafa venue par de do."
                  : due.status === "disputed"
                    ? due.owner_decision === "collect"
                      ? "Venue ne baqi raqam sahi kaha. Agli dafa venue par de do."
                      : "Aap ka jawab venue ke paas hai."
                    : due.status === "no_reply"
                      ? `24 ghante mein jawab nahi aaya, ${due.penalty_applied} points kate. Baqi de do to points wapas mil jayenge.`
                      : ""}
            </Text>
          )}
        </View>
      ) : null}

      {arrival.enabled && (arrival.can_arrive || arrival.arrival) ? (
        <View style={{ gap: space[2] }} testID="extras-arrival">
          {arrival.arrival ? (
            <Text variant="bodyStrong">{verdictText(arrival.arrival.verdict)}</Text>
          ) : (
            <>
              <Text variant="meta" tone="muted">Venue pohanch kar dabao (sirf ek dafa location li jati hai).</Text>
              <Button label="Pohanch gaya" size="md" loading={busy === "arrive"} onPress={arrive} testID="extras-arrived" />
            </>
          )}
        </View>
      ) : null}

      {arrival.enabled && (arrival.can_reply_noshow || arrival.noshow_reply) ? (
        <View style={{ gap: space[2] }} testID="extras-noshow">
          {arrival.noshow_reply ? (
            <Text variant="body">
              {arrival.noshow_reply.owner_decision === "reverse"
                ? "Venue ne maan liya ke aap aaye the; no-show hata diya."
                : arrival.noshow_reply.owner_decision === "keep"
                  ? "Venue ne no-show barqarar rakha."
                  : "Aap ka jawab venue ke paas hai."}
            </Text>
          ) : noteOpen ? (
            <View style={{ gap: space[2] }}>
              <Input label="Kuch batana ho to likho (zaroori nahi)" value={note} onChangeText={setNote} multiline testID="extras-noshow-note" />
              <Button label="Bhejo" block loading={busy === "noshow"} onPress={() => run("noshow", () => api.phase3.noshowReply(bookingId, note.trim()), "Venue ko bata diya ke aap aaye the.")} />
            </View>
          ) : (
            <>
              <Text variant="meta" tone="muted">Ye booking no-show mark hui. Aap aaye the?</Text>
              <Button label="Main aaya tha" variant="soft" size="md" onPress={() => setNoteOpen(true)} testID="extras-noshow-open" />
            </>
          )}
        </View>
      ) : null}

      {showPoints ? (
        <View style={{ gap: space[2] }} testID="extras-points">
          {points.state === "available" ? (
            <Button
              label={`${points.cost_points} points se ${formatPkr(points.discount_pkr)} ki chhoot lo`}
              size="md"
              loading={busy === "points"}
              onPress={() => run("points", () => api.phase3.usePoints(bookingId), "Chhoot lag gayi.")}
              testID="extras-use-points"
            />
          ) : points.state === "used" ? (
            <Text variant="bodyStrong">{`Points se ${formatPkr(points.discount_pkr)} ki chhoot mil gayi`}</Text>
          ) : points.state === "not_enough" ? (
            <Text variant="body">{`Aap ke ${points.balance} points hain; ${points.cost_points} par chhoot milti hai`}</Text>
          ) : null}
          <Text variant="meta" tone="muted">{points.rule_text_ru}</Text>
        </View>
      ) : null}

      {message ? <Banner tone={message.ok ? "open" : "danger"} body={message.text} /> : null}
    </Card>
  );
}
