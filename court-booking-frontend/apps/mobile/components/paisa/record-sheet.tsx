import { useRef, useState } from "react";
import { View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import type { ExcessChoice, ExcessChoiceDetails, Payment } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";
import { space } from "@court-booking/ui-tokens";
import { Banner, Button, Chip, Input, Text } from "@/components/ui";

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/auth-store";
import { addDays, formatDateRelative, formatPKR, pktDateString } from "@/lib/format";
import { parseAmount } from "@/lib/paisa-mobile";
import { prepareProofImage } from "@/lib/proof-image";
import { BottomSheet, OutlineButton, PrimaryButton } from "@/components/overview/ui";
import { Choice, moneyError, pkr, usePT } from "./kit";

type Shot = { file: string | Blob; name: string };

/**
 * Ledger v2 "Paisa darj karein" (contract 2.1 / 2.4 / 2.8). Cash is recorded now; a Transfer goes with its screenshot to
 * Approvals (nothing counts until approved; the owner can approve at once). Money above the total asks "Player ko wapas"
 * (preselected) or "Player ke jama mein"; the same amount within 10 minutes asks to confirm; an earlier business day needs a
 * note. Every rule is the server's; this sheet only asks.
 */
export function PaisaRecordSheet({
  bookingId,
  subtitle,
  owed,
  onClose,
  onSaved,
}: {
  bookingId: string;
  subtitle: string;
  owed: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = usePT();
  const isStaff = useAuthStore((s) => s.user?.role) === "staff";
  const today = pktDateString();
  const [amountText, setAmountText] = useState(owed > 0 ? String(owed) : "");
  const [method, setMethod] = useState<"cash" | "transfer">("cash");
  const [day, setDay] = useState(today);
  const [note, setNote] = useState("");
  const [shot, setShot] = useState<Shot | null>(null);
  const [excess, setExcess] = useState<ExcessChoiceDetails | null>(null);
  const [choice, setChoice] = useState<ExcessChoice>("refund");
  const [dup, setDup] = useState<{ when: string; by: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState<Payment | null>(null);
  const [approved, setApproved] = useState(false);
  const inFlight = useRef(false);

  const amount = parseAmount(amountText);
  const backdated = day !== today;
  const noteMissing = backdated && method === "cash" && !note.trim();
  const ready = amount !== null && !noteMissing && (method === "cash" || !!shot) && !busy;
  const days = [0, -1, -2, -3, -4, -5, -6].map((n) => addDays(today, n));

  async function pick() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== "granted") return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
    if (result.canceled || !result.assets[0]) return;
    const proof = await prepareProofImage(result.assets[0]);
    setShot({ file: proof.blob ?? proof.uri, name: proof.name });
  }

  async function submit(confirmDuplicate = false) {
    if (!ready || amount === null || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const excessChoice = excess ? choice : undefined;
      if (method === "cash") {
        await api.payments.recordEntry(bookingId, {
          amount_pkr: amount,
          method: "cash_at_venue",
          note: note.trim() || undefined,
          business_date: backdated ? day : undefined,
          excess_choice: excessChoice,
          confirm_duplicate: confirmDuplicate || undefined,
        });
        onSaved();
        return;
      }
      const payment = await api.payments.recordTransfer(bookingId, { amount_pkr: amount, note: note.trim() || undefined, excess_choice: excessChoice }, shot!.file, shot!.name);
      setQueued(payment);
    } catch (e) {
      if (e instanceof ApiError && (e.code as string) === "EXCESS_CHOICE_REQUIRED") {
        const d = (e.details ?? {}) as Partial<ExcessChoiceDetails>;
        setExcess({ excess_pkr: d.excess_pkr ?? 0, can_credit: !!d.can_credit && !isStaff });
        setChoice("refund");
      } else if (e instanceof ApiError && (e.code as string) === "POSSIBLE_DUPLICATE") {
        const d = (e.details ?? {}) as { recorded_at?: string; by?: string | null };
        setDup({ when: d.recorded_at ? formatDateRelative(d.recorded_at) : "", by: d.by ?? "" });
      } else {
        setError(moneyError(e, t));
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function approveNow() {
    if (!queued || amount === null) return;
    setBusy(true);
    setError(null);
    try {
      await api.payments.approve(queued.id, amount, undefined, false, excess ? choice : undefined);
      setApproved(true);
    } catch (e) {
      setError(moneyError(e, t));
    } finally {
      setBusy(false);
    }
  }

  if (queued) {
    return (
      <BottomSheet title={t("paisa.rec.title")} subtitle={subtitle} onClose={onSaved} footer={<PrimaryButton label={t("paisa.act.cancelForm")} onPress={onSaved} />} testID="paisa-record-queued">
        <Banner tone={approved ? "open" : "info"} body={approved ? t("paisa.rec.done") : t("paisa.rec.transferQueued")} />
        {!approved && !isStaff ? <Button label={t("paisa.act.approveNow")} block loading={busy} onPress={approveNow} testID="paisa-approve-now" /> : null}
        {error ? <Banner tone="danger" body={error} /> : null}
      </BottomSheet>
    );
  }

  return (
    <BottomSheet
      title={t("paisa.rec.title")}
      subtitle={subtitle}
      onClose={onClose}
      testID="paisa-record-sheet"
      footer={
        dup ? (
          <View style={{ gap: space[2] }}>
            <Banner tone="waiting" title={t("paisa.rec.dupTitle")} body={t("paisa.rec.dupBody", { when: dup.when, by: dup.by || "-" })} />
            <View style={{ flexDirection: "row", gap: space[3] }}>
              <OutlineButton flex label={t("paisa.act.cancelForm")} onPress={() => setDup(null)} />
              <PrimaryButton flex label={t("paisa.rec.dupYes")} loading={busy} onPress={() => { setDup(null); void submit(true); }} testID="paisa-dup-yes" />
            </View>
          </View>
        ) : (
          <PrimaryButton label={amount !== null ? `${t("paisa.act.save")} · ${pkr(amount)}` : t("paisa.act.save")} disabled={!ready} loading={busy} onPress={() => submit(false)} testID="paisa-record-save" />
        )
      }
    >
      {owed > 0 ? <Text variant="meta" tone="muted">{t("paisa.rec.owed", { amount: pkr(owed) })}</Text> : null}
      <Input
        label={t("paisa.rec.amount")}
        value={amountText}
        onChangeText={(v) => {
          setAmountText(v);
          setExcess(null);
          setError(null);
        }}
        keyboardType="number-pad"
        accessibilityLabel={t("paisa.rec.amount")}
        testID="paisa-record-amount"
      />
      <View style={{ gap: space[2] }}>
        <Text variant="label">{t("paisa.rec.how")}</Text>
        <Choice
          testID="paisa-record-method"
          value={method}
          onChange={(m) => {
            setMethod(m);
            setExcess(null);
          }}
          options={[
            { value: "cash", label: t("paisa.rec.cash") },
            { value: "transfer", label: t("paisa.rec.transfer") },
          ]}
        />
      </View>
      {method === "transfer" ? (
        <View style={{ gap: space[1] }}>
          <OutlineButton label={shot ? shot.name : t("paisa.rec.screenshotPick")} onPress={pick} testID="paisa-record-shot" />
        </View>
      ) : (
        <View style={{ gap: space[2] }}>
          <Text variant="label">{t("paisa.rec.day")}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
            {days.map((d) => (
              <Chip key={d} label={formatDateRelative(`${d}T12:00:00+05:00`, new Date(), "ru")} selected={day === d} onPress={() => setDay(d)} />
            ))}
          </View>
        </View>
      )}
      <Input label={t("paisa.rec.note")} value={note} onChangeText={setNote} error={noteMissing ? t("paisa.rec.noteNeeded") : null} testID="paisa-record-note" />
      {excess ? (
        <View style={{ gap: space[2] }} testID="paisa-record-excess">
          <Text variant="bodyBold">{t("paisa.rec.extra", { amount: formatPKR(excess.excess_pkr) })}</Text>
          <Choice
            testID="paisa-excess"
            value={choice}
            onChange={setChoice}
            options={[
              { value: "refund", label: t("paisa.rec.toPlayer") },
              { value: "credit", label: t("paisa.rec.toCredit"), disabled: !excess.can_credit },
            ]}
          />
          {!excess.can_credit ? <Text variant="caption" tone="muted">{t("paisa.rec.noCredit")}</Text> : null}
        </View>
      ) : null}
      {error ? <Banner tone="danger" body={error} /> : null}
    </BottomSheet>
  );
}
