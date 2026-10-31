import { useState } from "react";
import { Pressable, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useMutation } from "@tanstack/react-query";
import { acceptReceivedInput, dueDoneProblem, noshowReverseProblem, receivedPrompt, type MoneyMethod } from "@court-booking/types";
import { ApiError } from "@court-booking/api-client";
import { palette, radius, space } from "@court-booking/ui-tokens";
import { Banner, Input, Text } from "@/components/ui";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR } from "@/lib/format";
import { prepareProofImage } from "@/lib/proof-image";
import { parsePkr } from "@/lib/round2-format";
import { BottomSheet, OutlineButton, PrimaryButton } from "@/components/overview/ui";

type Shot = { file: string | Blob; name: string };

function moneyErrorText(e: unknown): string {
  if (e instanceof ApiError && e.status === 403) return "Aapke paas payments record karne ki ijazat nahi hai.";
  if (e instanceof ApiError && (e.code as string) === "PROOF_REQUIRED") return "Transfer ka screenshot lagayein.";
  if (e instanceof ApiError && e.code === "PAYMENT_ALREADY_SUBMITTED") return "Is booking ka ek screenshot pehle se Approvals mein hai.";
  return friendlyErrorMessage(e);
}

/** Cash / Transfer chips and, for a transfer, the screenshot picker (both sheets). */
function MethodPicker({ method, setMethod, shot, setShot, showShot }: {
  method: MoneyMethod | null;
  setMethod: (m: MoneyMethod) => void;
  shot: Shot | null;
  setShot: (s: Shot | null) => void;
  showShot: boolean;
}) {
  const [pickError, setPickError] = useState<string | null>(null);
  async function pick() {
    setPickError(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== "granted") {
      setPickError("Screenshot lagane ke liye photos ki ijazat dein (phone Settings).");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
    if (result.canceled || !result.assets[0]) return;
    const proof = await prepareProofImage(result.assets[0]);
    setShot({ file: proof.blob ?? proof.uri, name: proof.name });
  }
  return (
    <View style={{ gap: space[2] }}>
      <Text variant="bodyStrong">Kaise mila?</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
        {(["cash", "transfer"] as const).map((m) => (
          <Pressable
            key={m}
            onPress={() => setMethod(m)}
            accessibilityRole="button"
            accessibilityState={{ selected: method === m }}
            testID={`money-method-${m}`}
            style={{ minHeight: 48, justifyContent: "center", paddingHorizontal: space[5], borderRadius: radius.pill, borderWidth: 1.5, borderColor: method === m ? palette.night : palette.line, backgroundColor: method === m ? palette.night : palette.white }}
          >
            <Text variant="bodyStrong" tone={method === m ? "onDark" : "primary"}>{m === "cash" ? "Cash" : "Transfer"}</Text>
          </Pressable>
        ))}
      </View>
      {showShot ? (
        <View style={{ gap: space[1] }}>
          <OutlineButton label={shot ? "Screenshot badlein" : "Transfer ka screenshot lagayein"} onPress={pick} />
          <Text variant="caption" tone={shot ? "primary" : "muted"}>{shot ? shot.name : "Transfer ke liye screenshot zaroori hai."}</Text>
          {pickError ? <Text variant="meta" weight="bold" tone="danger">{pickError}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

export interface ReverseTarget {
  bookingId: string;
  subtitle: string;
  total: number;
  paid: number;
  replyId?: string | null;
}

/** audit fixes 2026-10-31: "No-show hatayein": final price, money received NOW, cash or transfer. A transfer with money needs
 * the screenshot, which goes to Approvals and is recorded only once approved. The full price is never assumed as cash. */
export function NoShowReverseSheet({ target, onClose, onSaved }: { target: ReverseTarget; onClose: () => void; onSaved: (transfer: boolean) => void }) {
  const [price, setPrice] = useState(String(Math.round(target.total)));
  const [received, setReceived] = useState("0");
  const [blocked, setBlocked] = useState(false);
  const [method, setMethod] = useState<MoneyMethod | null>(null);
  const [shot, setShot] = useState<Shot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const finalPrice = parsePkr(price);
  const got = parsePkr(received);
  const problem = noshowReverseProblem({ finalPrice, received: got, method, hasScreenshot: !!shot }, target.paid);
  const room = finalPrice != null ? Math.max(0, finalPrice - target.paid) : 0;
  const transfer = method === "transfer" && (got ?? 0) > 0;
  const dueAfter = finalPrice != null && got != null ? Math.max(0, finalPrice - target.paid - got) : null;

  const save = useMutation({
    mutationFn: () =>
      api.phase3.reverseNoShow(
        target.bookingId,
        { final_price_pkr: finalPrice as number, received_pkr: got as number, method: method as MoneyMethod, reply_id: target.replyId ?? null },
        transfer ? shot?.file : null,
      ),
    onSuccess: () => {
      onSaved(transfer);
      onClose();
    },
    onError: (e) => setError(moneyErrorText(e)),
  });

  return (
    <BottomSheet
      title="No-show hatayein"
      subtitle={target.subtitle}
      onClose={onClose}
      footer={
        <View style={{ flexDirection: "row", gap: space[3] }}>
          <OutlineButton flex label="Wapas" onPress={onClose} />
          <PrimaryButton flex label={save.isPending ? "Save ho raha hai" : "No-show hatayein"} disabled={!!problem || save.isPending} onPress={() => save.mutate()} />
        </View>
      }
    >
      <View testID="noshow-reverse-sheet" style={{ gap: space[3] }}>
        <Text variant="meta" tone="muted">{`Pehle se mila: PKR ${formatPKR(target.paid)}`}</Text>
        <Input
          label="Aakhri qeemat (PKR)"
          value={price}
          onChangeText={(t) => {
            setPrice(t);
            setError(null);
            // a lower price shrinks what is left: the received amount never stays above it
            const p = parsePkr(t);
            if (p != null && got != null && got > Math.max(0, p - target.paid)) setReceived(String(Math.max(0, p - target.paid)));
          }}
          keyboardType="number-pad"
          error={problem === "price" && price !== "" ? `Pehle mile hue paison (PKR ${formatPKR(target.paid)}) se kam nahi ho sakti.` : null}
        />
        <Input
          label={receivedPrompt(target.paid, room)}
          value={received}
          onChangeText={(t) => {
            // audit fixes 2026-10-31: more than what is left of the final price can't be typed
            const next = acceptReceivedInput(t, room, received);
            setBlocked(next.blocked);
            setReceived(next.value);
            setError(null);
          }}
          keyboardType="number-pad"
          accessibilityLabel={receivedPrompt(target.paid, room)}
          help={`0 se PKR ${formatPKR(room)} tak (pehle wale paison ke ilawa).`}
          error={blocked ? `Baqi Rs ${formatPKR(room)} se zyada nahi likh sakte.` : problem === "received" && received !== "" ? `Sirf 0 se PKR ${formatPKR(room)} tak likhein.` : null}
        />
        <MethodPicker method={method} setMethod={setMethod} shot={shot} setShot={setShot} showShot={transfer} />
        {transfer ? (
          <Banner tone="waiting" body="Screenshot Approvals mein jayega. Approve karne par hi paisa likha jayega." />
        ) : dueAfter != null && dueAfter > 0 ? (
          <Banner tone="danger" body={`Is ke baad baqi: PKR ${formatPKR(dueAfter)}`} />
        ) : null}
        {error ? <Text variant="meta" weight="bold" tone="danger">{error}</Text> : null}
      </View>
    </BottomSheet>
  );
}

/** audit fixes 2026-10-31: dues "Done": cash (recorded today, due 0) or transfer (screenshot to Approvals, due 0 once
 * approved). The price never changes here; only "waive" lowers it. */
export function DueDoneSheet({ claimId, subtitle, due, onClose, onSaved }: { claimId: string; subtitle: string; due: number; onClose: () => void; onSaved: (transfer: boolean) => void }) {
  const [method, setMethod] = useState<MoneyMethod | null>(null);
  const [shot, setShot] = useState<Shot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const problem = dueDoneProblem(method, !!shot);
  const save = useMutation({
    mutationFn: () => api.phase3.dueDone(claimId, method as MoneyMethod, method === "transfer" ? shot?.file : null),
    onSuccess: () => {
      onSaved(method === "transfer");
      onClose();
    },
    onError: (e) => setError(moneyErrorText(e)),
  });
  return (
    <BottomSheet
      title={`Baqi PKR ${formatPKR(due)} mil gaye?`}
      subtitle={subtitle}
      onClose={onClose}
      footer={
        <View style={{ flexDirection: "row", gap: space[3] }}>
          <OutlineButton flex label="Wapas" onPress={onClose} />
          <PrimaryButton flex label={save.isPending ? "Save ho raha hai" : "Done"} disabled={!!problem || save.isPending} onPress={() => save.mutate()} />
        </View>
      }
    >
      <View testID="due-done-sheet" style={{ gap: space[3] }}>
        <MethodPicker method={method} setMethod={setMethod} shot={shot} setShot={setShot} showShot={method === "transfer"} />
        <Text variant="meta" tone="muted">
          {method === "transfer"
            ? "Transfer: screenshot Approvals mein jayega. Approve karne par baqi 0 ho jayega."
            : "Cash: aaj ki tareekh mein likha jayega aur baqi 0 ho jayega. Qeemat wahi rahegi."}
        </Text>
        {error ? <Text variant="meta" weight="bold" tone="danger">{error}</Text> : null}
      </View>
    </BottomSheet>
  );
}
