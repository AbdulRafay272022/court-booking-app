"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ApiError } from "@court-booking/api-client";
import { addDays, pktDateString, type ExcessChoice } from "@court-booking/types";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useT } from "@/components/i18n/lang-provider";
import { useFmt } from "@/lib/use-fmt";
import { Sheet } from "@/components/fl";
import { parseRupees, pkrText } from "@/lib/paisa-v2";
import { usePaisaT } from "@/lib/use-paisa-v2";
import { Choice, ErrorText, PrimaryButton, Select, TextField } from "@/components/owner/paisa-v2/ui";

type Method = "cash" | "transfer";

/**
 * Ledger v2 "Paisa darj karein" (contract 2.4, founder 12 Nov answer 4). Cash or Transfer only (old "other" money is only shown,
 * never recorded). Cash is recorded now, on today's business day or an earlier one (with a note). Transfer needs its screenshot
 * and goes to Approvals; nothing counts until it is approved (the owner can approve it right here). All the money is
 * recorded: above the booking total the server asks (409 EXCESS_CHOICE_REQUIRED) whether the extra goes back to the player
 * (preselected) or into their credit (owner only, when the booking has an account or phone). Same amount + method within 10
 * minutes asks for a confirm (409 POSSIBLE_DUPLICATE).
 */
export function RecordPaymentSheet({
  bookingId, // i18n-ignore
  playerLabel, // i18n-ignore
  owed, // i18n-ignore
  isOwner, // i18n-ignore
  onClose, // i18n-ignore
  onDone, // i18n-ignore
}: {
  bookingId: string;
  playerLabel: string;
  owed: number;
  isOwner: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const pt = usePaisaT();
  const fmt = useFmt();
  const today = pktDateString();
  const [amount, setAmount] = useState(owed > 0 ? String(owed) : "");
  const [method, setMethod] = useState<Method>("cash");
  const [day, setDay] = useState(today);
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [excess, setExcess] = useState<{ amount: number; canCredit: boolean } | null>(null);
  const [choice, setChoice] = useState<ExcessChoice>("refund");
  const [dup, setDup] = useState<{ when: string; by: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState<{ paymentId: string; amount: number } | null>(null);
  const [approved, setApproved] = useState(false);

  const typed = parseRupees(amount);
  const days = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(today, -i)), [today]);
  const backdated = method === "cash" && day !== today;
  const needsNote = backdated && note.trim() === "";
  const ready = Number.isFinite(typed) && typed > 0 && !needsNote && (method === "cash" || !!file);

  function handleError(e: unknown) {
    if (e instanceof ApiError && e.code === "EXCESS_CHOICE_REQUIRED") {
      const d = (e.details ?? {}) as { excess_pkr?: number; can_credit?: boolean };
      setExcess({ amount: Number(d.excess_pkr ?? 0), canCredit: d.can_credit === true && isOwner });
      setChoice("refund");
      return;
    }
    if (e instanceof ApiError && e.code === "POSSIBLE_DUPLICATE") {
      const d = (e.details ?? {}) as { recorded_at?: string; by?: string | null };
      setDup({ when: d.recorded_at ? fmt.time(d.recorded_at) : "", by: d.by ?? "" });
      return;
    }
    setError(friendlyErrorMessage(e, t));
  }

  async function submit(confirmDuplicate = false) {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (method === "cash") {
        await api.payments.recordEntry(bookingId, {
          amount_pkr: typed,
          method: "cash_at_venue",
          note: note.trim() || undefined,
          business_date: backdated ? day : undefined,
          excess_choice: excess ? choice : undefined,
          confirm_duplicate: confirmDuplicate || undefined,
        });
        onDone();
        return;
      }
      const payment = await api.payments.recordTransfer(
        bookingId,
        { amount_pkr: typed, note: note.trim() || undefined, excess_choice: excess ? choice : undefined },
        file as File,
        file?.name || "transfer.jpg",
        file?.type || "image/jpeg",
      );
      setQueued({ paymentId: payment.id, amount: typed });
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  }

  async function approveNow() {
    if (!queued || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.payments.approve(queued.paymentId, queued.amount, undefined, false, excess ? choice : undefined);
      setApproved(true);
    } catch (e) {
      if (e instanceof ApiError && e.code === "EXCESS_CHOICE_REQUIRED") {
        handleError(e);
      } else {
        setError(friendlyErrorMessage(e, t));
      }
    } finally {
      setBusy(false);
    }
  }

  const choiceBlock = excess ? (
    <div className="flex flex-col gap-2 rounded-xl border border-owner-warn-soft-border bg-owner-warn-soft p-3" data-testid="excess-choice">
      <b className="text-[14px] text-owner-ink">{pt("paisa.rec.extra", { amount: excess.amount.toLocaleString("en-US") })}</b>
      <Choice<ExcessChoice>
        value={choice}
        onChange={setChoice}
        options={[
          { value: "refund", label: pt("paisa.rec.toPlayer") },
          { value: "credit", label: pt("paisa.rec.toCredit"), disabled: !excess.canCredit },
        ]}
      />
      {!excess.canCredit && isOwner ? <span className="text-[12.5px] text-owner-ink-muted">{pt("paisa.rec.noCredit")}</span> : null}
    </div>
  ) : null;

  return (
    <Sheet open onClose={onClose} title={pt("paisa.rec.title")} subtitle={`${playerLabel} · ${pt("paisa.rec.owed", { amount: pkrText(owed) })}`} data-testid="record-payment-sheet">
      {queued ? (
        <div className="flex flex-col gap-3" data-testid="record-transfer-queued">
          <p className="rounded-xl bg-owner-bg px-3 py-3 text-[14px] text-owner-ink">{approved ? pt("paisa.rec.done") : pt("paisa.rec.transferQueued")}</p>
          {choiceBlock}
          <ErrorText text={error} />
          <div className="flex flex-wrap gap-2">
            {!approved && isOwner ? <PrimaryButton label={pt("paisa.act.approveNow")} onClick={approveNow} busy={busy} testId="record-approve-now" /> : null}
            {!approved ? (
              <Link href="/dashboard/owner/approvals" className="inline-flex min-h-11 items-center rounded-xl border border-owner-border px-4 text-[14px] font-bold text-owner-ink">
                {pt("paisa.act.openApprovals")}
              </Link>
            ) : null}
            <PrimaryButton label={pt("paisa.act.cancelForm")} tone="ghost" onClick={onDone} />
          </div>
        </div>
      ) : dup ? (
        <div className="flex flex-col gap-3" data-testid="record-duplicate">
          <b className="text-[15px]">{pt("paisa.rec.dupTitle")}</b>
          <p className="text-[14px] text-owner-ink-muted">{pt("paisa.rec.dupBody", { when: dup.when, by: dup.by })}</p>
          <div className="flex flex-wrap gap-2">
            <PrimaryButton
              label={pt("paisa.rec.dupYes")}
              onClick={() => {
                setDup(null);
                void submit(true);
              }}
              busy={busy}
            />
            <PrimaryButton label={pt("paisa.act.cancelForm")} tone="ghost" onClick={() => setDup(null)} />
          </div>
        </div>
      ) : (
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <TextField label={pt("paisa.rec.amount")} value={amount} onChange={(v) => { setAmount(v); setExcess(null); }} inputMode="numeric" testId="record-amount" autoFocus />
          <Choice<Method>
            label={pt("paisa.rec.how")}
            value={method}
            onChange={(m) => { setMethod(m); setExcess(null); }}
            testId="record-method"
            options={[
              { value: "cash", label: pt("paisa.rec.cash") },
              { value: "transfer", label: pt("paisa.rec.transfer") },
            ]}
          />
          {method === "cash" ? (
            <Select label={pt("paisa.rec.day")} value={day} onChange={setDay} testId="record-day" options={days.map((d) => ({ value: d, label: fmt.dateRelative(`${d}T12:00:00+05:00`) }))} />
          ) : (
            <label className="flex flex-col gap-1">
              <span className="text-[12.5px] font-semibold text-owner-ink-muted">{pt("paisa.rec.screenshot")}</span>
              <input type="file" accept="image/jpeg,image/png,image/webp" data-testid="record-screenshot" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="min-h-11 text-sm" />
            </label>
          )}
          <TextField label={pt("paisa.rec.note")} value={note} onChange={setNote} error={needsNote ? pt("paisa.rec.noteNeeded") : null} testId="record-note" />
          {choiceBlock}
          <ErrorText text={error} />
          <PrimaryButton type="submit" label={pt("paisa.act.record")} disabled={!ready} busy={busy} testId="record-submit" />
        </form>
      )}
    </Sheet>
  );
}
