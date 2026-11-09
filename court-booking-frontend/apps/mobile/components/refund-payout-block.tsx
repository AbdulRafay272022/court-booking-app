import { useState } from "react";
import { View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { refundCheckLabel, refundCheckReasons, formatWhen, type OwnerRefund, type RefundPayout, type RefundTransfer } from "@court-booking/types";
import { palette, radius, space } from "@court-booking/ui-tokens";
import { Button, Input, Text, useLang } from "@/components/ui";
import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR } from "@/lib/format";

type Lx = (ru: string, en: string) => string;

/**
 * fix/nov-9 items 10-12 on the owner's Refunds row (same rules as the web Wapas dena): the player's account masked (****6789)
 * until "Poora number dikhao" (only the venue that owes it, only while owed; each view is in the audit log), copy buttons, and
 * each refund sent with its check (Match / Farq hai), the player's Mil gaya / Nahi mila and a reply box.
 */
export function RefundPayoutBlock({ refund, onChanged }: { refund: OwnerRefund; onChanged: () => void }) {
  const lang = useLang();
  const L: Lx = (ru, en) => (lang === "en" ? en : ru);
  const [full, setFull] = useState<RefundPayout | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const p = refund.payout ?? null;
  const owed = refund.refund_status === "owed" && (refund.remaining_amount ?? 1) > 0;
  async function reveal() {
    setBusy(true);
    setError(null);
    try {
      setFull(await api.refundDisputes.revealPayout(refund.id));
    } catch (e) {
      setError(friendlyErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function copy(key: string, value: string) {
    await Clipboard.setStringAsync(value);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  }
  return (
    <View style={{ gap: space[2] }} testID="refund-payout-block">
      {p ? (
        <View style={{ backgroundColor: palette.ground, borderRadius: radius.md, paddingHorizontal: space[3], paddingVertical: 10, gap: 4 }}>
          <Text variant="caption" tone="muted">{`${L("Refund yahan bhejein", "Send the refund to")}: ${p.method_label}${p.bank ? ` · ${p.bank}` : ""}`}</Text>
          <Text variant="bodyBold" selectable testID="refund-payout-account">{`${full?.account ?? p.account_masked ?? ""}${p.title ? ` (${p.title})` : ""}`}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
            {full?.account ? (
              <>
                <Button
                  label={copied === "acct" ? L("Copy ho gaya", "Copied") : p.method === "bank" ? L("IBAN copy", "Copy IBAN") : L("Number copy", "Copy number")}
                  variant="soft"
                  size="sm"
                  onPress={() => void copy("acct", full.account!)}
                />
                {p.title ? (
                  <Button label={copied === "title" ? L("Copy ho gaya", "Copied") : L("Title copy", "Copy title")} variant="soft" size="sm" onPress={() => void copy("title", p.title!)} />
                ) : null}
              </>
            ) : owed ? (
              <Button label={L("Poora number dikhao", "Show full number")} variant="soft" size="sm" loading={busy} onPress={() => void reveal()} testID="refund-payout-reveal" />
            ) : null}
          </View>
          {error ? <Text variant="caption" tone="danger">{error}</Text> : null}
        </View>
      ) : owed ? (
        <Text variant="caption" tone="muted" testID="refund-payout-missing">
          {L("Player ne abhi account nahi bataya (app mein poocha gaya hai).", "The player has not given an account yet (asked in the app).")}
        </Text>
      ) : null}
      {(refund.transfers ?? []).map((t) => (
        <TransferLine key={t.id} t={t} L={L} lang={lang} onChanged={onChanged} />
      ))}
    </View>
  );
}

function TransferLine({ t, L, lang, onChanged }: { t: RefundTransfer; L: Lx; lang: "ru" | "en"; onChanged: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function reply() {
    if (!note.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.refundDisputes.replyTransfer(t.id, note.trim());
      onChanged();
    } catch (e) {
      setError(friendlyErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const tone = t.ocr_verdict === "match" ? "open" : t.ocr_verdict === "mismatch" ? "danger" : "muted";
  const reasons = t.ocr_reasons.length ? ` · ${refundCheckReasons(t.ocr_reasons, lang).join(", ")}` : "";
  const answer =
    t.player_response === "received"
      ? L("Player: mil gaya", "Player: received")
      : t.player_response === "not_received"
        ? `${L("Player: nahi mila", "Player: not received")}${t.player_note ? ` (${t.player_note})` : ""}`
        : L("Player ne abhi nahi bataya", "Player has not answered yet");
  return (
    <View style={{ borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, padding: space[3], gap: 4 }} testID="refund-transfer-line">
      <Text variant="meta" weight="bold">{`${L("Bheja", "Sent")}: PKR ${formatPKR(t.amount)} · ${formatWhen(t.sent_at, new Date(), lang)}`}</Text>
      <Text variant="meta" weight="bold" tone={tone}>{`${L("Check", "Check")}: ${refundCheckLabel(t.ocr_verdict, lang)}${reasons}`}</Text>
      <Text variant="meta">{answer}</Text>
      {t.owner_reply ? <Text variant="meta" tone="muted">{`${L("Aap ka jawab", "Your reply")}: ${t.owner_reply}`}</Text> : null}
      {t.player_response === "not_received" && !t.owner_reply ? (
        <View style={{ gap: space[2] }}>
          <Input label={L("Player ko jawab", "Reply to the player")} value={note} onChangeText={setNote} multiline maxLength={500} />
          <Button label={L("Jawab bhejein", "Send reply")} size="sm" disabled={busy || !note.trim()} onPress={() => void reply()} />
        </View>
      ) : null}
      {error ? <Text variant="caption" tone="danger">{error}</Text> : null}
    </View>
  );
}
