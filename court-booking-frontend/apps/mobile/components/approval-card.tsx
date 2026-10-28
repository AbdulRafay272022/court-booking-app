import { useState } from "react";
import { View } from "react-native";
import { Ban, TriangleAlert } from "lucide-react-native";
import { approvalSummary, type ApprovalQueueItem, type ApproveAcceptMode } from "@court-booking/types";
import { palette, radius, shadow, space } from "@court-booking/ui-tokens";
import { Avatar, Banner, Button, Input, MoneyRows, Pill, RadioGroup, Text } from "@/components/ui";

import { formatPKR } from "@/lib/format";
import { duplicateChipCount, duplicateUsedText } from "@/lib/overview";
import { refundAmountFor } from "@/lib/refund-confirm";
import { STATE_CHIP, isGrey, parsePkr, slotWhen } from "@/lib/round2-format";
import { waitLabel } from "@/lib/owner-floodlight";
import { BottomSheet, DangerButton, OutlineButton, PrimaryButton } from "@/components/overview/ui";
import { BookingLinks } from "@/components/booking-links";
import { ScreenshotThumb } from "@/components/screenshot-viewer";

/** Client-side reject presets (the API takes free text, contract: POST /payments/{id}/reject {reason}). "Kuch aur" = type
 * your own. */
export const REJECT_REASONS = ["Amount match nahi karta", "Screenshot parha nahi ja raha", "Duplicate lagta hai", "Kuch aur"];

/**
 * Approvals board: "Chahiye" (what this booking needs now) next to "Screenshot mein" (what OCR read), each a text box, so
 * a match / difference / unread screenshot is told by words + a tick, never by colour alone.
 */
function AmountBoxes({ item }: { item: ApprovalQueueItem }) {
  const v = item.ocr_verdict;
  const read =
    item.ocr_amount != null
      ? `PKR ${formatPKR(item.ocr_amount)}${v === "match" ? " ✓" : ""}`
      : "Parha nahi gaya";
  const word = v === "match" ? "Match" : v === "mismatch" ? "Farq hai" : "Khud dekhein";
  const box = v === "match" ? { bg: palette.openTint, fg: palette.open } : v === "mismatch" ? { bg: palette.dangerTint, fg: palette.danger } : { bg: palette.waitingTint, fg: palette.waiting };
  return (
    <View testID="amount-chip" accessible accessibilityLabel={`Chahiye PKR ${formatPKR(item.expected_amount)}. Screenshot mein ${read}. ${word}`} style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      <View style={{ flexGrow: 1, flexBasis: 96, backgroundColor: palette.ground, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: space[2], gap: 2 }}>
        <Text variant="caption" weight="bold" tone="muted">
          Chahiye
        </Text>
        <Text variant="bodyStrong">{`PKR ${formatPKR(item.expected_amount)}`}</Text>
      </View>
      <View style={{ flexGrow: 1, flexBasis: 96, backgroundColor: box.bg, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: space[2], gap: 2 }}>
        <Text variant="caption" weight="bold" color={box.fg}>
          {`Screenshot mein · ${word}`}
        </Text>
        <Text variant="bodyStrong" color={box.fg}>
          {read}
        </Text>
      </View>
    </View>
  );
}

/** Stage 2 (B.a): "this screenshot was already used on N other bookings" (icon + text). */
export function duplicateText(n: number): string {
  return duplicateUsedText(n);
}

function DuplicateChip({ n }: { n: number }) {
  return (
    <View testID="duplicate-chip" style={{ flexDirection: "row", alignItems: "flex-start", gap: 6, backgroundColor: palette.dangerTint, borderRadius: radius.xs, paddingHorizontal: 10, paddingVertical: 7 }}>
      <TriangleAlert size={15} color={palette.danger} />
      <Text variant="meta" weight="bold" tone="danger" style={{ flexShrink: 1 }}>
        {`Duplicate: ${duplicateText(n)}`}
      </Text>
    </View>
  );
}

export function ApprovalCard({
  item,
  courtText,
  busy,
  error,
  locked = false,
  onDetails,
  onApprove,
  onReject,
  onAcknowledge,
}: {
  item: ApprovalQueueItem;
  courtText: string;
  busy: boolean;
  error: string | null;
  /** Staff without the approve permission (known up front from /owners/me/permissions, or after a 403
   * NOT_STAFF_PERMITTED): no action buttons, one clear note. */
  locked?: boolean;
  onDetails: () => void;
  onApprove: () => void;
  onReject: () => void;
  onAcknowledge: (moneyReceived: boolean) => void;
}) {
  const grey = isGrey(item);
  const dupN = grey ? null : duplicateChipCount(item.duplicate);
  const hasShot = item.has_screenshot || !!item.proof_url;
  return (
    <View
      testID={grey ? "approval-card-grey" : "approval-card"}
      accessibilityLabel={`${item.player_name ?? "Player"} approval`}
      style={{ backgroundColor: grey ? palette.mist : palette.white, borderRadius: radius.card, padding: 14, gap: space[3], boxShadow: grey ? undefined : shadow.card }}
    >
      {grey ? <Pill tone="neutral" icon={<Ban size={13} color={palette.body} />} label={STATE_CHIP[item.state as Exclude<typeof item.state, "awaiting">]} /> : null}
      {item.is_balance ? <Pill tone="info" label="Baqi raqam (balance) ka screenshot" size="sm" testID="balance-chip" /> : null}

      <View style={{ flexDirection: "row", alignItems: "center", gap: space[3] }}>
        <Avatar name={item.player_name ?? "?"} size={44} tone={grey ? "neutral" : "info"} uri={item.player_avatar_url} />
        <View style={{ flex: 1, gap: 1 }}>
          <Text variant="bodyStrong">{item.player_name ?? "Player"}</Text>
          <Text variant="meta" tone="muted">
            {courtText}
          </Text>
          <Text testID="approval-when" variant="meta" weight="bold">
            {slotWhen(item.starts_at, item.ends_at)}
          </Text>
        </View>
        {!grey ? (
          <Text variant="caption" weight="bold" tone="muted">
            {waitLabel(Math.max(0, Math.round(item.minutes_since_submission ?? 0)))}
          </Text>
        ) : null}
      </View>

      {!grey ? (
        <View style={{ flexDirection: "row", gap: space[3], alignItems: "flex-start" }}>
          {hasShot ? <ScreenshotThumb compact paymentId={item.payment_id} url={item.proof_url} alt={`${item.player_name ?? "Player"} ka screenshot`} /> : null}
          <View style={{ flex: 1, gap: space[2] }}>
            <AmountBoxes item={item} />
            {dupN != null ? <DuplicateChip n={dupN} /> : null}
          </View>
        </View>
      ) : hasShot ? (
        <ScreenshotThumb paymentId={item.payment_id} url={item.proof_url} alt={`${item.player_name ?? "Player"} ka screenshot`} />
      ) : null}

      <BookingLinks bookingId={item.booking_id} startsAt={item.starts_at} onDetails={onDetails} />

      {error ? (
        <Text variant="meta" weight="bold" tone="danger">
          {error}
        </Text>
      ) : null}

      {locked ? (
        <View testID="approval-locked">
          <Banner tone="neutral" body="Aap ke paas is kaam ki ijazat nahi. Owner se ijazat mangein." />
        </View>
      ) : grey ? (
        item.has_screenshot ? (
          <View style={{ gap: space[2] }}>
            <Text variant="meta" tone="muted">
              Player ne screenshot bheja tha. Kya paisa aapke account mein aaya?
            </Text>
            <Button label="Paisa nahi aaya - Theek hai" variant="soft" size="md" block disabled={busy} onPress={() => onAcknowledge(false)} />
            <Button label="Paisa aa gaya - Refund banayein" variant="primary" size="md" block disabled={busy} onPress={() => onAcknowledge(true)} />
          </View>
        ) : (
          <Button label="Theek hai" variant="primary" size="md" block disabled={busy} onPress={() => onAcknowledge(false)} />
        )
      ) : (
        <View style={{ flexDirection: "row", gap: space[2] }}>
          <Button label="Approve" variant="primary" size="md" disabled={busy} onPress={onApprove} style={{ flex: 2 }} />
          <Button label="Reject" variant="danger" size="md" disabled={busy} onPress={onReject} style={{ flex: 1, paddingHorizontal: space[3] }} />
        </View>
      )}
    </View>
  );
}

/** Approve: confirm the amount really received; when the screenshot shows MORE than the advance, two choices. */
export function ApproveSheet({
  item,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  item: ApprovalQueueItem;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (amount: number | undefined, mode: ApproveAcceptMode | undefined) => void;
}) {
  const over = item.overpayment;
  const checks = item.checks ?? null;
  const [text, setText] = useState(String(over?.ocr_amount ?? checks?.paid_amount ?? item.expected_amount));
  const [mode, setMode] = useState<ApproveAcceptMode>("advance_only");
  const amount = parsePkr(text);
  const summary = checks && amount !== null && amount > 0 ? approvalSummary(checks, amount, "ru") : null;
  const valid = !checks || (amount !== null && amount > 0);

  return (
    <BottomSheet
      title="Approve karein?"
      subtitle={`${item.player_name ?? "Player"} - ${slotWhen(item.starts_at, item.ends_at)}`}
      onClose={onClose}
      footer={
        <View style={{ flexDirection: "row", gap: space[3] }}>
          <OutlineButton flex label="Wapas" onPress={onClose} />
          <PrimaryButton
            flex
            label={busy ? "Approve ho raha hai" : "Approve karein"}
            disabled={!valid || busy}
            onPress={() => onConfirm(checks ? (amount ?? undefined) : undefined, over ? mode : undefined)}
          />
        </View>
      }
    >
      {over ? (
        <View testID="overpayment-banner">
          <Banner
            tone="waiting"
            title={`Screenshot mein PKR ${formatPKR(over.ocr_amount)} hain, advance sirf PKR ${formatPKR(over.expected)} chahiye tha.`}
            body="Screenshot ki parhai sirf ishara hai. Faisla aap karein."
          />
        </View>
      ) : null}
      {over ? (
        <RadioGroup
          accessibilityLabel="Kitna manzoor"
          value={mode}
          onChange={setMode}
          options={[
            { value: "advance_only", label: `Sirf PKR ${formatPKR(over.expected)} manzoor - baqi PKR ${formatPKR(over.excess)} wapas karna hoga`, hint: "Baqi raqam Refunds mein chali jayegi." },
            { value: "full", label: `Poora PKR ${formatPKR(over.ocr_amount)} manzoor (extra advance)`, hint: "Poori raqam is booking ki payment mein jama hogi." },
          ]}
        />
      ) : null}

      {checks ? (
        <Input
          label="Asal mein kitna mila? (PKR)"
          value={text}
          onChangeText={setText}
          keyboardType="number-pad"
          accessibilityLabel="Asal mein kitna mila, PKR"
          error={valid ? null : "Sahi raqam likhein"}
          help={summary ? `${summary.text}. Approve ke baad mila PKR ${formatPKR(summary.totalAfter)}, venue par baqi PKR ${formatPKR(summary.balanceAfter)}.` : undefined}
        />
      ) : null}
      {error ? (
        <Text variant="meta" weight="bold" tone="danger">
          {error}
        </Text>
      ) : null}
    </BottomSheet>
  );
}

/** Stage 2 (B.a): a SEPARATE confirm before approving a screenshot that was already used on other bookings (also opened
 * when the server answers 409 DUPLICATE_PROOF_CONFIRM_REQUIRED). Only "Phir bhi approve karein" sends confirm_duplicate. */
export function DuplicateConfirmSheet({
  item,
  usedOn,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  item: ApprovalQueueItem;
  usedOn: number;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <BottomSheet
      title="Duplicate screenshot"
      subtitle={`${item.player_name ?? "Player"} - ${slotWhen(item.starts_at, item.ends_at)}`}
      onClose={onClose}
      footer={
        <View style={{ flexDirection: "row", gap: space[3] }}>
          <OutlineButton flex label="Wapas" onPress={onClose} />
          <DangerButton flex label={busy ? "Approve ho raha hai" : "Phir bhi approve karein"} disabled={busy} onPress={onConfirm} />
        </View>
      }
    >
      <View testID="duplicate-confirm">
        <Banner tone="danger" icon={TriangleAlert} title={`${duplicateText(usedOn)}. Phir bhi approve karein?`} body="Pehle apne account mein check karein ke ye paisa is booking ke liye alag se aaya hai." />
      </View>
      {error ? (
        <Text variant="meta" weight="bold" tone="danger">
          {error}
        </Text>
      ) : null}
    </BottomSheet>
  );
}

/** "Paisa aa gaya - Refund banayein" is a money action: confirm it with the amount and the booking first. */
export function RefundConfirmSheet({
  item,
  courtText,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  item: ApprovalQueueItem;
  courtText: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const amount = refundAmountFor(item);
  return (
    <BottomSheet
      title="Refund banayein?"
      subtitle="Player ne booking cancel kar di thi, lekin paisa aap ke account mein aa gaya."
      onClose={onClose}
      footer={
        <View style={{ flexDirection: "row", gap: space[3] }}>
          <OutlineButton flex label="Wapas" onPress={onClose} />
          <PrimaryButton flex label={busy ? "Ban raha hai" : "Haan, refund banayein"} disabled={busy} onPress={onConfirm} />
        </View>
      }
    >
      <View testID="refund-confirm" style={{ backgroundColor: palette.tealTint, borderRadius: radius.input, padding: space[4], gap: space[2] }}>
        <Text variant="meta" weight="bold" tone="info">
          Wapas karna hoga
        </Text>
        <Text testID="refund-confirm-amount" variant="h3">{`PKR ${formatPKR(amount)}`}</Text>
        <Text variant="bodyStrong">{item.player_name ?? "Player"}</Text>
        <Text variant="meta" tone="muted">{`${courtText} - ${slotWhen(item.starts_at, item.ends_at)}`}</Text>
      </View>
      <Text variant="meta" tone="muted">
        Ye refund &quot;Refunds&quot; mein chala jayega. Paisa app ke bahar (JazzCash/bank) bhejein, phir wahan &quot;Paid&quot; mark karein.
      </Text>
      {error ? (
        <Text variant="meta" weight="bold" tone="danger">
          {error}
        </Text>
      ) : null}
    </BottomSheet>
  );
}

/** OSheets frame 2 "Payment reject karein?": reason radios (client presets) + free text; the reason is required. */
export function RejectSheet({
  item,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  item: ApprovalQueueItem;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const reason = picked === "Kuch aur" ? note.trim() : picked && note.trim() ? `${picked}. ${note.trim()}` : picked;
  return (
    <BottomSheet
      title="Payment reject karein?"
      subtitle={`${item.player_name ?? "Player"} · ${slotWhen(item.starts_at, item.ends_at)} · PKR ${formatPKR(item.expected_amount)}`}
      onClose={onClose}
      footer={
        <View style={{ flexDirection: "row", gap: space[3] }}>
          <OutlineButton flex label="Wapas" onPress={onClose} />
          <DangerButton flex label={busy ? "Reject ho raha hai" : "Reject karein"} disabled={!reason || busy} onPress={() => reason && onConfirm(reason)} />
        </View>
      }
    >
      <Text variant="bodyBold">Wajah chunein</Text>
      <RadioGroup
        danger
        accessibilityLabel="Reject ki wajah"
        value={picked}
        onChange={setPicked}
        options={REJECT_REASONS.map((r) => ({ value: r, label: r }))}
        testID="reject-reasons"
      />
      <Input
        label={picked === "Kuch aur" ? "Apni wajah (zaroori)" : "Player ke liye note (optional)"}
        value={note}
        onChangeText={setNote}
        multiline
        placeholder="Apni wajah likhein"
        accessibilityLabel="Reject ki wajah"
        help="Keyboard ke mic se bolein"
      />
      <Banner tone="waiting" body="Reject karne par slot fori khul jayega aur player ko wajah WhatsApp/push par milegi." />
      {error ? (
        <Text variant="meta" weight="bold" tone="danger">
          {error}
        </Text>
      ) : null}
    </BottomSheet>
  );
}

/** Bulk "Sab approve" confirm: lists exactly which payments go (OCR-matched only) and their amounts before anything is
 * sent. There is no batch endpoint (B8): the screen sends them one by one. */
export function BulkApproveSheet({
  items,
  busy,
  progress,
  error,
  onClose,
  onConfirm,
}: {
  items: ApprovalQueueItem[];
  busy: boolean;
  progress: string | null;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <BottomSheet
      title={`${items.length} payments approve karein?`}
      subtitle="Sirf woh jin ke screenshot ka amount bilkul match hai, koi duplicate nahi."
      onClose={onClose}
      testID="bulk-approve-sheet"
      footer={
        <View style={{ flexDirection: "row", gap: space[3] }}>
          <OutlineButton flex label="Wapas" onPress={onClose} />
          <PrimaryButton flex label={busy ? "Approve ho rahe hain" : "Haan, sab approve"} disabled={busy || items.length === 0} onPress={onConfirm} testID="bulk-approve-confirm" />
        </View>
      }
    >
      <MoneyRows rows={items.map((it) => ({ label: `${it.player_name ?? "Player"} · ${slotWhen(it.starts_at, it.ends_at)}`, value: `PKR ${formatPKR(it.expected_amount)}` }))} />
      <Text variant="meta" tone="muted">
        Har payment alag se approve hogi. Koi ek ruk jaye (maslan player ne cancel kar di) to woh card wahin rahega, baqi chalti rahengi.
      </Text>
      {progress ? (
        <Text variant="meta" weight="bold" tone="info" testID="bulk-progress">
          {progress}
        </Text>
      ) : null}
      {error ? (
        <Text variant="meta" weight="bold" tone="danger">
          {error}
        </Text>
      ) : null}
    </BottomSheet>
  );
}

