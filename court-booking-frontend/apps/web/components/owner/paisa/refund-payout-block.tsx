"use client";

/**
 * fix/nov-9 items 10-12 on the owner's Wapas dena row:
 * - where the player wants the refund: masked (****6789) until "Number dikhayein", which fetches the full number (only for
 *   the venue that owes it, only while owed; every view is in the audit log), then copy buttons for number and title;
 * - each refund already sent: amount, the screenshot check (Match / Farq hai) and the player's Mil gaya / Nahi mila, with
 *   a reply box for "Nahi mila".
 */
import { useState } from "react";
import { refundCheckLabel, refundCheckReasons, type OwnerRefund, type RefundPayout, type RefundTransfer } from "@court-booking/types";
import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR } from "@/lib/format";
import { useFmt } from "@/lib/use-fmt";
import { useLang } from "@/components/i18n/lang-provider";

function CopyButton({ value, label, en }: { value: string; label: string; en: boolean }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="min-h-11 rounded-lg border border-owner-border px-3 text-[13px] font-semibold text-owner-ink"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard blocked: the value is on screen to copy by hand */
        }
      }}
      data-testid={`copy-${label}`}
    >
      {done ? (en ? "Copied" : "Copy ho gaya") : en ? `Copy ${label}` : `${label} copy karein`}
    </button>
  );
}

export function RefundPayoutBlock({ refund, onChanged }: { refund: OwnerRefund; onChanged: () => void }) {
  const en = useLang() === "en";
  const L = (ru: string, en_: string) => (en ? en_ : ru);
  const [full, setFull] = useState<RefundPayout | null>(null);
  const [busy, setBusy] = useState(false);
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
  return (
    <div className="mt-1 flex flex-col gap-2" data-testid="refund-payout-block">
      {p ? (
        <div className="rounded-lg border border-owner-border bg-owner-bg/40 px-3 py-2 text-[13.5px]">
          <p className="font-semibold text-owner-ink">
            {L("Refund yahan bhejein", "Send the refund to")}: {p.method_label}{p.bank ? ` · ${p.bank}` : ""}
          </p>
          <p className="tabular-nums text-owner-ink" data-testid="refund-payout-account">
            {full?.account ?? p.account_masked} {p.title ? <span className="text-owner-ink-muted">({p.title})</span> : null}
          </p>
          <div className="mt-1 flex flex-wrap gap-2">
            {full?.account ? (
              <>
                <CopyButton value={full.account} label={p.method === "bank" ? "IBAN" : L("number", "number")} en={en} />
                {p.title ? <CopyButton value={p.title} label={L("title", "title")} en={en} /> : null}
              </>
            ) : owed ? (
              <button
                type="button"
                className="min-h-11 rounded-lg border border-owner-border px-3 text-[13px] font-semibold text-owner-ink"
                onClick={reveal}
                disabled={busy}
                data-testid="refund-payout-reveal"
              >
                {L("Poora number dikhayein", "Show full number")}
              </button>
            ) : null}
          </div>
          {error ? <p className="text-[12.5px] font-semibold text-fl-danger" role="alert">{error}</p> : null}
        </div>
      ) : owed ? (
        <p className="text-[12.5px] text-owner-ink-faint" data-testid="refund-payout-missing">
          {L("Player ne abhi account nahi bataya (app mein poocha gaya hai).", "The player has not given an account yet (asked in the app).")}
        </p>
      ) : null}
      {(refund.transfers ?? []).map((t) => (
        <TransferLine key={t.id} t={t} en={en} onChanged={onChanged} />
      ))}
    </div>
  );
}

function TransferLine({ t, en, onChanged }: { t: RefundTransfer; en: boolean; onChanged: () => void }) {
  const fmt = useFmt();
  const L = (ru: string, en_: string) => (en ? en_ : ru);
  const lang = en ? "en" : "ru";
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
  const tone = t.ocr_verdict === "match" ? "text-owner-success-dark" : t.ocr_verdict === "mismatch" ? "text-fl-danger" : "text-owner-ink-muted";
  return (
    <div className="rounded-lg border border-owner-border px-3 py-2 text-[13px]" data-testid="refund-transfer-line">
      <p className="font-semibold text-owner-ink">
        {L("Bheja", "Sent")}: PKR {formatPKR(t.amount)} <span className="font-normal text-owner-ink-muted">· {fmt.when(t.sent_at)}</span>
      </p>
      <p className={`font-semibold ${tone}`}>
        {L("Check", "Check")}: {refundCheckLabel(t.ocr_verdict, lang)}
        {t.ocr_reasons.length ? <span className="font-normal"> · {refundCheckReasons(t.ocr_reasons, lang).join(", ")}</span> : null}
      </p>
      <p className="text-owner-ink">
        {t.player_response === "received"
          ? L("Player: mil gaya", "Player: received")
          : t.player_response === "not_received"
            ? `${L("Player: nahi mila", "Player: not received")}${t.player_note ? ` (${t.player_note})` : ""}`
            : L("Player ne abhi nahi bataya", "Player has not answered yet")}
      </p>
      {t.owner_reply ? <p className="text-owner-ink-muted">{L("Aap ka jawab", "Your reply")}: {t.owner_reply}</p> : null}
      {t.player_response === "not_received" && !t.owner_reply ? (
        <div className="mt-1 flex flex-col gap-1">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder={L("Player ko jawab (jaise transfer ki detail)", "Reply to the player (e.g. transfer details)")}
            className="rounded-lg border border-owner-border px-2 py-1 text-[13px]"
            data-testid="refund-reply-text"
          />
          <button
            type="button"
            className="min-h-11 self-start rounded-lg bg-owner-ink px-3 text-[13px] font-semibold text-white"
            onClick={reply}
            disabled={busy || !note.trim()}
          >
            {L("Jawab bhejein", "Send reply")}
          </button>
        </div>
      ) : null}
      {error ? <p className="text-[12.5px] font-semibold text-fl-danger" role="alert">{error}</p> : null}
    </div>
  );
}
