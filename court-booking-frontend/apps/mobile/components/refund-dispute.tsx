import { useState } from "react";
import { Image, Linking, Pressable, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  escalationKindLabel,
  escalationStatusLine,
  payoutInputError,
  refundCheckLabel,
  refundCheckReasons,
  formatWhen,
  type EscalationState,
  type PayoutMethod,
  type PlayerRefundState,
  type RefundTransfer,
} from "@court-booking/types";
import { formatPkr, palette, space } from "@court-booking/ui-tokens";
import { Button, Card, Chip, Input, Text, useLang } from "@/components/ui";
import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";

type Lx = (ru: string, en: string) => string;

/**
 * fix/nov-9 items 9-12 on the player's booking screen (same endpoints and rules as the web page):
 * "Refund kahan bhejein?", each refund the venue sent (screenshot, Match / Farq hai, Mil gaya / Nahi mila) and
 * "Khelo se shikayat karein" with Khelo's decision. The number shows masked (****6789).
 */
export function RefundDisputeCard({ bookingId }: { bookingId: string }) {
  const lang = useLang();
  const L: Lx = (ru, en) => (lang === "en" ? en : ru);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["booking-disputes", bookingId], queryFn: () => api.refundDisputes.forBooking(bookingId) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["booking-disputes", bookingId] });
    void qc.invalidateQueries({ queryKey: ["booking-detail", bookingId] });
  };
  const data = q.data;
  if (!data || (!data.refund && data.escalations.length === 0)) return null;
  const refundEsc = data.escalations.find((e) => e.kind === "refund");
  const others = data.escalations.filter((e) => e.kind !== "refund");
  return (
    <>
      {data.refund ? (
        <Card padding={4} radiusSize="cardL" style={{ gap: space[3] }} testID="refund-card">
          <Text variant="title" accessibilityRole="header">{L("Aap ka refund", "Your refund")}</Text>
          <Summary r={data.refund} L={L} />
          {data.refund.needs_payout ? (
            <PayoutForm bookingId={bookingId} previous={data.refund.previous_payout} onDone={refresh} L={L} />
          ) : data.refund.payout ? (
            <PayoutLine r={data.refund} bookingId={bookingId} onDone={refresh} L={L} />
          ) : null}
          {data.refund.transfers.map((t) => (
            <TransferRow key={t.id} t={t} L={L} lang={lang} onDone={refresh} />
          ))}
          {refundEsc ? <Escalate bookingId={bookingId} state={refundEsc} L={L} lang={lang} onDone={refresh} /> : null}
        </Card>
      ) : null}
      {others.map((e) => (
        <Card key={e.kind} padding={4} radiusSize="cardL" style={{ gap: space[2] }} testID={`escalation-${e.kind}`}>
          <Text variant="title" accessibilityRole="header">{escalationKindLabel(e.kind, lang)}</Text>
          <Escalate bookingId={bookingId} state={e} L={L} lang={lang} onDone={refresh} />
        </Card>
      ))}
    </>
  );
}

function Summary({ r, L }: { r: PlayerRefundState; L: Lx }) {
  const parts = [`${L("Refund", "Refund")}: ${formatPkr(r.amount)}`];
  if (r.sent > 0) parts.push(`${L("Bheja", "Sent")}: ${formatPkr(r.sent)}`);
  if (r.status === "owed") parts.push(`${L("Baqi", "Remaining")}: ${formatPkr(r.remaining)}`);
  return <Text variant="bodyStrong" testID="refund-summary">{parts.join(" · ")}</Text>;
}

function PayoutLine({ r, bookingId, onDone, L }: { r: PlayerRefundState; bookingId: string; onDone: () => void; L: Lx }) {
  const [editing, setEditing] = useState(false);
  const p = r.payout!;
  if (editing) return <PayoutForm bookingId={bookingId} previous={null} onDone={() => { setEditing(false); onDone(); }} L={L} />;
  return (
    <View style={{ gap: space[1] }} testID="payout-line">
      <Text variant="body">
        {`${L("Refund yahan aayega", "Refund goes to")}: ${p.method_label} ${p.account_masked ?? ""}${p.title ? ` (${p.title})` : ""}${p.bank ? ` · ${p.bank}` : ""}`}
      </Text>
      {r.status === "owed" ? <Button label={L("Badlein", "Change")} variant="quiet" size="sm" onPress={() => setEditing(true)} /> : null}
    </View>
  );
}

function PayoutForm({ bookingId, previous, onDone, L }: { bookingId: string; previous: PlayerRefundState["previous_payout"]; onDone: () => void; L: Lx }) {
  const lang = useLang();
  const [method, setMethod] = useState<PayoutMethod>("jazzcash");
  const [account, setAccount] = useState("");
  const [title, setTitle] = useState("");
  const [bank, setBank] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(usePrevious: boolean) {
    const body = usePrevious ? { use_previous: true } : { method, account, title, bank: method === "bank" ? bank : null };
    const err = payoutInputError(body, lang);
    if (err) return setError(err);
    setBusy(true);
    setError(null);
    try {
      await api.refundDisputes.setPayout(bookingId, body);
      onDone();
    } catch (e) {
      setError(friendlyErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: space[3] }} testID="payout-form">
      <Text variant="bodyStrong">{L("Refund kahan bhejein?", "Where should we send the refund?")}</Text>
      {previous ? (
        <Button
          label={L(`Pichla account: ${previous.method_label} ${previous.account_masked}`, `Last account: ${previous.method_label} ${previous.account_masked}`)}
          variant="secondary"
          block
          disabled={busy}
          onPress={() => void save(true)}
        />
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
        {(["jazzcash", "easypaisa", "bank"] as const).map((m) => (
          <Chip key={m} label={m === "jazzcash" ? "JazzCash" : m === "easypaisa" ? "Easypaisa" : "Bank (IBAN)"} selected={method === m} onPress={() => setMethod(m)} />
        ))}
      </View>
      <Input
        label={method === "bank" ? "IBAN" : L("Mobile number", "Mobile number")}
        value={account}
        onChangeText={setAccount}
        keyboardType={method === "bank" ? "default" : "phone-pad"}
        autoCapitalize={method === "bank" ? "characters" : "none"}
        placeholder={method === "bank" ? "PK36 SCBL 0000 0011 2345 6702" : "0300 1234567"}
        testID="payout-account"
      />
      <Input label={L("Account title (account par naam)", "Account title (name on the account)")} value={title} onChangeText={setTitle} testID="payout-title" />
      {method === "bank" ? <Input label={L("Bank ka naam", "Bank name")} value={bank} onChangeText={setBank} placeholder="Meezan Bank" /> : null}
      {error ? <Text variant="meta" tone="danger" accessibilityLiveRegion="polite">{error}</Text> : null}
      <Button label={L("Save karein", "Save")} block loading={busy} onPress={() => void save(false)} />
      <Text variant="meta" tone="muted">{L("Poora number sirf us venue ko dikhta hai jis ne refund dena hai.", "Only the venue that owes the refund sees the full number.")}</Text>
    </View>
  );
}

function TransferRow({ t, L, lang, onDone }: { t: RefundTransfer; L: Lx; lang: "ru" | "en"; onDone: () => void }) {
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function answer(a: "received" | "not_received") {
    setBusy(true);
    setError(null);
    try {
      await api.refundDisputes.answerTransfer(t.id, a, a === "not_received" ? note.trim() : undefined);
      onDone();
    } catch (e) {
      setError(friendlyErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const tone = t.ocr_verdict === "match" ? "open" : t.ocr_verdict === "mismatch" ? "danger" : "muted";
  const reasons = t.ocr_reasons.length ? ` · ${refundCheckReasons(t.ocr_reasons, lang).join(", ")}` : "";
  return (
    <View style={{ gap: space[2], borderTopWidth: 1, borderTopColor: palette.line, paddingTop: space[3] }} testID="refund-transfer">
      <Text variant="bodyStrong">{`${L("Venue ne refund bhej diya", "The venue sent the refund")}: ${formatPkr(t.amount)}`}</Text>
      <Text variant="meta" tone="muted">{`${formatWhen(t.sent_at, new Date(), lang)}${t.reference ? ` · Ref ${t.reference}` : ""}`}</Text>
      {t.screenshot_url ? (
        <Pressable onPress={() => void Linking.openURL(t.screenshot_url!)} accessibilityRole="imagebutton" accessibilityLabel={L("Refund ka screenshot", "Refund screenshot")}>
          <Image source={{ uri: t.screenshot_url }} resizeMode="contain" style={{ width: "100%", height: 180, borderRadius: 12 }} />
        </Pressable>
      ) : null}
      <Text variant="bodyStrong" tone={tone} testID="refund-check">{`${L("Check", "Check")}: ${refundCheckLabel(t.ocr_verdict, lang)}${reasons}`}</Text>
      {t.player_response === "received" ? (
        <Text variant="bodyStrong" tone="open">{L("Aap ne kaha: mil gaya", "You said: received")}</Text>
      ) : t.player_response === "not_received" ? (
        <>
          <Text variant="bodyStrong" tone="danger">{L("Aap ne kaha: nahi mila", "You said: not received")}</Text>
          {t.owner_reply ? <Text variant="body">{`${L("Venue ka jawab", "Venue's reply")}: ${t.owner_reply}`}</Text> : null}
          {t.can_answer ? <Button label={L("Ab mil gaya", "I got it now")} variant="secondary" disabled={busy} onPress={() => void answer("received")} /> : null}
        </>
      ) : t.can_answer ? (
        asking ? (
          <View style={{ gap: space[2] }}>
            <Input label={L("Kya hua? (zaroori nahi)", "What happened? (optional)")} value={note} onChangeText={setNote} multiline maxLength={500} />
            <Button label={L("Nahi mila, venue ko batayein", "Not received, tell the venue")} block disabled={busy} onPress={() => void answer("not_received")} />
          </View>
        ) : (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
            <Button label={L("Mil gaya", "Received")} disabled={busy} onPress={() => void answer("received")} />
            <Button label={L("Nahi mila", "Not received")} variant="secondary" disabled={busy} onPress={() => setAsking(true)} />
          </View>
        )
      ) : null}
      {error ? <Text variant="meta" tone="danger">{error}</Text> : null}
    </View>
  );
}

function Escalate({ bookingId, state, L, lang, onDone }: { bookingId: string; state: EscalationState; L: Lx; lang: "ru" | "en"; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send() {
    setBusy(true);
    setError(null);
    try {
      await api.refundDisputes.escalate(bookingId, state.kind, reason.trim());
      onDone();
    } catch (e) {
      setError(friendlyErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: space[2] }} testID={`escalate-${state.kind}`}>
      {state.escalation ? (
        <Text variant="bodyStrong" tone={state.escalation.status === "open" ? "waiting" : "primary"}>{escalationStatusLine(state.escalation, lang)}</Text>
      ) : null}
      {state.can_escalate ? (
        open ? (
          <>
            <Input label={L("Khelo ko batayein kya hua", "Tell Khelo what happened")} value={reason} onChangeText={setReason} multiline maxLength={1000} />
            <Button label={L("Shikayat bhejein", "Send")} block loading={busy} onPress={() => void send()} />
          </>
        ) : (
          <>
            <Text variant="meta" tone="muted">
              {L("Venue ki baat se mutmain nahi? Khelo dono taraf dekh kar faisla karega.", "Not happy with the venue's answer? Khelo looks at both sides and decides.")}
            </Text>
            <Button label={L("Khelo se shikayat karein", "Report to Khelo")} variant="secondary" block onPress={() => setOpen(true)} />
          </>
        )
      ) : null}
      {error ? <Text variant="meta" tone="danger">{error}</Text> : null}
    </View>
  );
}
