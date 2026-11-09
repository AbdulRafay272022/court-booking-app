"use client";

/**
 * fix/nov-9 items 9-12 on the player's booking page:
 * - "Refund kahan bhejein?": JazzCash / Easypaisa number or bank IBAN + account title (or the account used last time);
 * - each refund the venue sent: amount, screenshot, the check (Match / Farq hai) and "Mil gaya" / "Nahi mila";
 * - "Khelo se shikayat karein" after the venue said no (no-show kept, due kept, refund not received), and Khelo's decision.
 * The number is shown masked here (****6789); only the venue that owes the refund sees it in full.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  escalationKindLabel,
  escalationStatusLine,
  payoutInputError,
  refundCheckLabel,
  refundCheckReasons,
  type EscalationKind,
  type EscalationState,
  type PayoutMethod,
  type PlayerRefundState,
  type RefundTransfer,
} from "@court-booking/types";
import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR } from "@/lib/format";
import { useFmt } from "@/lib/use-fmt";
import { Button, useFlLang } from "@/components/fl";

const input = "w-full rounded-fl-input border border-fl-line-strong px-3 py-2 text-[15px] text-fl-night";

export function RefundDisputeCard({ bookingId }: { bookingId: string }) {
  const lang = useFlLang();
  const L = (ru: string, en: string) => (lang === "en" ? en : ru);
  const q = useQuery({ queryKey: ["booking-disputes", bookingId], queryFn: () => api.refundDisputes.forBooking(bookingId) });
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["booking-disputes", bookingId] });
    qc.invalidateQueries({ queryKey: ["booking-detail", bookingId] });
  };
  const data = q.data;
  if (!data || (!data.refund && data.escalations.length === 0)) return null;
  const refundEsc = data.escalations.find((e) => e.kind === "refund");
  const others = data.escalations.filter((e) => e.kind !== "refund");
  return (
    <>
      {data.refund ? (
        <section className="flex flex-col gap-3 rounded-fl-card bg-fl-white p-5" data-testid="refund-card" id="refund">
          <h2 className="font-fl-display text-[17px] font-extrabold text-fl-night">{L("Aap ka refund", "Your refund")}</h2>
          <RefundSummary r={data.refund} L={L} />
          {data.refund.needs_payout ? (
            <PayoutForm bookingId={bookingId} previous={data.refund.previous_payout} onDone={refresh} L={L} />
          ) : data.refund.payout ? (
            <PayoutLine r={data.refund} bookingId={bookingId} onDone={refresh} L={L} />
          ) : null}
          {data.refund.transfers.map((t) => (
            <TransferRow key={t.id} t={t} lang={lang} L={L} onDone={refresh} />
          ))}
          {refundEsc ? <EscalateBlock bookingId={bookingId} state={refundEsc} lang={lang} L={L} onDone={refresh} /> : null}
        </section>
      ) : null}
      {others.map((e) => (
        <section key={e.kind} className="flex flex-col gap-2 rounded-fl-card bg-fl-white p-5" data-testid={`escalation-${e.kind}`}>
          <h2 className="font-fl-display text-[17px] font-extrabold text-fl-night">{escalationKindLabel(e.kind, lang)}</h2>
          <EscalateBlock bookingId={bookingId} state={e} lang={lang} L={L} onDone={refresh} />
        </section>
      ))}
    </>
  );
}

type Lx = (ru: string, en: string) => string;

function RefundSummary({ r, L }: { r: PlayerRefundState; L: Lx }) {
  return (
    <p className="text-[14px] text-fl-night" data-testid="refund-summary">
      {L("Refund", "Refund")}: <b>PKR {formatPKR(r.amount)}</b>
      {r.sent > 0 ? <> · {L("Bheja", "Sent")}: <b>PKR {formatPKR(r.sent)}</b></> : null}
      {r.status === "owed" ? <> · {L("Baqi", "Remaining")}: <b className="text-fl-waiting">PKR {formatPKR(r.remaining)}</b></> : null}
    </p>
  );
}

function PayoutLine({ r, bookingId, onDone, L }: { r: PlayerRefundState; bookingId: string; onDone: () => void; L: Lx }) {
  const [editing, setEditing] = useState(false);
  const p = r.payout!;
  if (editing) return <PayoutForm bookingId={bookingId} previous={null} onDone={() => { setEditing(false); onDone(); }} L={L} />;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-fl-input bg-fl-ground px-3 py-2 text-[14px]" data-testid="payout-line">
      <span>
        {L("Refund yahan aayega", "Refund goes to")}: <b>{p.method_label} {p.account_masked}</b>
        {p.title ? ` (${p.title})` : ""}
        {p.bank ? ` · ${p.bank}` : ""}
      </span>
      {r.status === "owed" ? (
        <button type="button" className="min-h-11 font-bold text-fl-teal underline" onClick={() => setEditing(true)}>
          {L("Badlein", "Change")}
        </button>
      ) : null}
    </div>
  );
}

function PayoutForm({
  bookingId, previous, onDone, L,
}: { bookingId: string; previous: PlayerRefundState["previous_payout"]; onDone: () => void; L: Lx }) {
  const lang = useFlLang();
  const [method, setMethod] = useState<PayoutMethod>("jazzcash");
  const [account, setAccount] = useState("");
  const [title, setTitle] = useState("");
  const [bank, setBank] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(usePrevious = false) {
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
  const methods: [PayoutMethod, string][] = [["jazzcash", "JazzCash"], ["easypaisa", "Easypaisa"], ["bank", L("Bank (IBAN)", "Bank (IBAN)")]];
  return (
    <div className="flex flex-col gap-3 rounded-fl-input border border-fl-line-strong p-3" data-testid="payout-form">
      <p className="text-[15px] font-extrabold text-fl-night">{L("Refund kahan bhejein?", "Where should we send the refund?")}</p>
      {previous ? (
        <Button
          label={L(`Pichla account: ${previous.method_label} ${previous.account_masked}`, `Last account: ${previous.method_label} ${previous.account_masked}`)}
          variant="secondary"
          block
          disabled={busy}
          onClick={() => save(true)}
        />
      ) : null}
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={L("Tareeqa", "Method")}>
        {methods.map(([m, label]) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={method === m}
            onClick={() => setMethod(m)}
            className={`min-h-11 rounded-full px-4 text-[14px] font-extrabold ${method === m ? "bg-fl-night text-fl-white" : "border border-fl-line-strong text-fl-night"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <label className="flex flex-col gap-1 text-[13px] font-bold text-fl-night">
        {method === "bank" ? "IBAN" : L("Mobile number", "Mobile number")}
        <input
          className={input}
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          inputMode={method === "bank" ? "text" : "tel"}
          placeholder={method === "bank" ? "PK36 SCBL 0000 0011 2345 6702" : "0300 1234567"}
          data-testid="payout-account"
        />
      </label>
      <label className="flex flex-col gap-1 text-[13px] font-bold text-fl-night">
        {L("Account title (account par naam)", "Account title (name on the account)")}
        <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} data-testid="payout-title" />
      </label>
      {method === "bank" ? (
        <label className="flex flex-col gap-1 text-[13px] font-bold text-fl-night">
          {L("Bank ka naam", "Bank name")}
          <input className={input} value={bank} onChange={(e) => setBank(e.target.value)} placeholder="Meezan Bank" />
        </label>
      ) : null}
      {error ? <p className="text-[13px] font-bold text-fl-danger" role="alert">{error}</p> : null}
      <Button label={L("Save karein", "Save")} block loading={busy} onClick={() => save(false)} />
      <p className="text-[12px] text-fl-muted">{L("Poora number sirf us venue ko dikhta hai jis ne refund dena hai.", "Only the venue that owes the refund sees the full number.")}</p>
    </div>
  );
}

function TransferRow({ t, lang, L, onDone }: { t: RefundTransfer; lang: "ru" | "en"; L: Lx; onDone: () => void }) {
  const fmt = useFmt();
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
  const tone = t.ocr_verdict === "match" ? "text-fl-open" : t.ocr_verdict === "mismatch" ? "text-fl-danger" : "text-fl-muted";
  return (
    <div className="flex flex-col gap-2 border-t border-fl-line pt-3" data-testid="refund-transfer">
      <p className="text-[15px] font-extrabold text-fl-night">
        {L("Venue ne refund bhej diya", "The venue sent the refund")}: PKR {formatPKR(t.amount)}
      </p>
      <p className="text-[13px] text-fl-muted">{fmt.when(t.sent_at)}{t.reference ? ` · Ref ${t.reference}` : ""}</p>
      {t.screenshot_url ? (
        <a href={t.screenshot_url} target="_blank" rel="noopener noreferrer" className="block w-fit">
          {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL, not a static asset */}
          <img src={t.screenshot_url} alt={L("Refund ka screenshot", "Refund screenshot")} className="max-h-48 rounded-fl-input border border-fl-line" />
        </a>
      ) : null}
      <p className={`text-[14px] font-bold ${tone}`} data-testid="refund-check">
        {L("Check", "Check")}: {refundCheckLabel(t.ocr_verdict, lang)}
        {t.ocr_reasons.length ? <span className="font-normal"> · {refundCheckReasons(t.ocr_reasons, lang).join(", ")}</span> : null}
      </p>
      {t.player_response === "received" ? (
        <p className="text-[14px] font-bold text-fl-open">{L("Aap ne kaha: mil gaya", "You said: received")}</p>
      ) : t.player_response === "not_received" ? (
        <>
          <p className="text-[14px] font-bold text-fl-danger">{L("Aap ne kaha: nahi mila", "You said: not received")}</p>
          {t.owner_reply ? <p className="text-[14px] text-fl-night">{L("Venue ka jawab", "Venue's reply")}: {t.owner_reply}</p> : null}
          {t.can_answer ? (
            <Button label={L("Ab mil gaya", "I got it now")} variant="secondary" disabled={busy} onClick={() => answer("received")} />
          ) : null}
        </>
      ) : t.can_answer ? (
        asking ? (
          <div className="flex flex-col gap-2">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder={L("Kya hua? (zaroori nahi)", "What happened? (optional)")}
              className="rounded-fl-input border border-fl-line-strong px-3 py-2 text-[14px]"
            />
            <Button label={L("Nahi mila, venue ko batayein", "Not received, tell the venue")} block disabled={busy} onClick={() => answer("not_received")} />
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button label={L("Mil gaya", "Received")} disabled={busy} onClick={() => answer("received")} />
            <Button label={L("Nahi mila", "Not received")} variant="secondary" disabled={busy} onClick={() => setAsking(true)} />
          </div>
        )
      ) : null}
      {error ? <p className="text-[13px] font-bold text-fl-danger" role="alert">{error}</p> : null}
    </div>
  );
}

function EscalateBlock({
  bookingId, state, lang, L, onDone,
}: { bookingId: string; state: EscalationState; lang: "ru" | "en"; L: Lx; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send(kind: EscalationKind) {
    setBusy(true);
    setError(null);
    try {
      await api.refundDisputes.escalate(bookingId, kind, reason.trim());
      onDone();
    } catch (e) {
      setError(friendlyErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-2" data-testid={`escalate-${state.kind}`}>
      {state.escalation ? (
        <p className={`text-[14px] font-bold ${state.escalation.status === "open" ? "text-fl-waiting" : "text-fl-night"}`}>
          {escalationStatusLine(state.escalation, lang)}
        </p>
      ) : null}
      {state.can_escalate ? (
        open ? (
          <>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder={L("Khelo ko batayein kya hua", "Tell Khelo what happened")}
              className="rounded-fl-input border border-fl-line-strong px-3 py-2 text-[14px]"
            />
            <Button label={L("Shikayat bhejein", "Send")} block loading={busy} onClick={() => send(state.kind)} />
          </>
        ) : (
          <>
            <p className="text-[13px] text-fl-muted">
              {L("Venue ki baat se mutmain nahi? Khelo dono taraf dekh kar faisla karega.", "Not happy with the venue's answer? Khelo looks at both sides and decides.")}
            </p>
            <Button label={L("Khelo se shikayat karein", "Report to Khelo")} variant="secondary" block onClick={() => setOpen(true)} />
          </>
        )
      ) : null}
      {error ? <p className="text-[13px] font-bold text-fl-danger" role="alert">{error}</p> : null}
    </div>
  );
}
