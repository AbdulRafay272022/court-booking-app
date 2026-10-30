"use client";

import { useId, useState } from "react";
import { ApiError } from "@court-booking/api-client";
import { dueDoneProblem, noshowReverseProblem, type MoneyMethod } from "@court-booking/types";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { pkr } from "@/lib/overview-helpers";
import { useT } from "@/components/i18n/lang-provider";
import { ModalShell } from "@/components/owner/modal-shell";

type T = ReturnType<typeof useT>;

function moneyErrorText(e: unknown, t: T): string {
  if (e instanceof ApiError && (e.code as string) === "PROOF_REQUIRED") return t("nsw.rev.err.screenshot");
  if (e instanceof ApiError && (e.code as string) === "PAYMENT_ALREADY_SUBMITTED") return t("nsw.rev.err.pending");
  return friendlyErrorMessage(e, t);
}

function toAmount(raw: string): number | null {
  const cleaned = raw.replace(/[,\s]/g, "");
  return /^\d+$/.test(cleaned) ? Number(cleaned) : null;
}

/** Cash / Transfer chips and, for a transfer, the screenshot picker (shared by both dialogs). */
function MethodPicker({
  method,
  setMethod,
  file,
  setFile,
  showFile,
  invalidFile,
}: {
  method: MoneyMethod | null;
  setMethod: (m: MoneyMethod) => void;
  file: File | null;
  setFile: (f: File | null) => void;
  showFile: boolean;
  invalidFile: boolean;
}) {
  const t = useT();
  const fileId = useId();
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[14px] font-bold text-owner-ink">{t("nsw.rev.method")}</span>
      <div role="group" aria-label={t("nsw.rev.method")} className="flex flex-wrap gap-2">
        {(["cash", "transfer"] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={method === m}
            data-testid={`money-method-${m}`}
            onClick={() => setMethod(m)}
            className={`min-h-11 whitespace-nowrap rounded-full border-[1.5px] px-5 text-[14px] font-bold ${
              method === m ? "border-owner-ink bg-owner-ink text-white" : "border-owner-border bg-owner-surface text-owner-ink"
            }`}
          >
            {m === "cash" ? t("nsw.rev.cash") : t("nsw.rev.transfer")}
          </button>
        ))}
      </div>
      {showFile ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={fileId} className="text-[14px] font-bold text-owner-ink">
            {t("nsw.rev.screenshot")}
          </label>
          <input
            id={fileId}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            data-testid="money-screenshot"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-[14px]"
          />
          <p className={`text-[13px] ${invalidFile ? "font-semibold text-owner-danger" : "text-owner-ink-muted"}`}>
            {invalidFile ? t("nsw.rev.err.screenshot") : file ? file.name : t("nsw.rev.screenshotHint")}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export interface ReverseTarget {
  bookingId: string;
  /** a short line naming the booking (player · court · time) */
  label: string;
  total: number;
  paid: number;
  replyId?: string | null;
}

/**
 * audit fixes 2026-10-31: taking back a no-show. Final price, money received NOW (on top of what is recorded), cash or
 * transfer; a transfer with money needs the screenshot, which goes to Approvals and is credited only once approved. The full
 * price is never assumed.
 */
export function NoShowReverseDialog({ target, onClose, onDone }: { target: ReverseTarget; onClose: () => void; onDone: (transfer: boolean) => void }) {
  const t = useT();
  const titleId = useId();
  const [price, setPrice] = useState(String(target.total));
  const [received, setReceived] = useState("0");
  const [method, setMethod] = useState<MoneyMethod | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finalPrice = toAmount(price);
  const got = toAmount(received);
  const problem = noshowReverseProblem({ finalPrice, received: got, method, hasScreenshot: !!file }, target.paid);
  const room = finalPrice != null ? Math.max(0, finalPrice - target.paid) : 0;
  const dueAfter = finalPrice != null && got != null ? Math.max(0, finalPrice - target.paid - got) : null;

  async function save() {
    setTouched(true);
    if (problem || saving || finalPrice == null || got == null || method == null) return;
    setSaving(true);
    setError(null);
    try {
      await api.phase3.reverseNoShow(
        target.bookingId,
        { final_price_pkr: finalPrice, received_pkr: got, method, reply_id: target.replyId ?? null },
        method === "transfer" && got > 0 ? file : null,
      );
      onDone(method === "transfer" && got > 0);
    } catch (e) {
      setError(moneyErrorText(e, t));
      setSaving(false);
    }
  }

  const fieldClass = (bad: boolean) =>
    `h-12 min-w-0 w-full rounded-xl border-[1.5px] bg-owner-surface px-4 text-[18px] text-owner-ink tabular-nums ${bad ? "border-owner-danger" : "border-owner-border"}`;

  return (
    <ModalShell labelledBy={titleId} onClose={onClose} maxWidthClass="md:max-w-[540px]">
      <div className="flex flex-col gap-5 p-6 md:p-8" data-testid="noshow-reverse-dialog">
        <div>
          <h2 id={titleId} className="font-khelo-display text-[26px] font-extrabold leading-tight text-owner-ink">
            {t("nsw.rev.title")}
          </h2>
          <p className="mt-1 break-words text-[14px] text-owner-ink-muted">{target.label}</p>
          <p className="mt-1 text-[14px] text-owner-ink-muted">{t("nsw.rev.alreadyPaid", { paid: pkr(target.paid) })}</p>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-[14px] font-bold text-owner-ink">{t("nsw.rev.price")}</span>
          <input
            value={price}
            data-testid="reverse-price"
            inputMode="numeric"
            onChange={(e) => setPrice(e.target.value.replace(/[^0-9,]/g, ""))}
            aria-invalid={touched && problem === "price"}
            className={fieldClass(touched && problem === "price")}
          />
          {touched && problem === "price" ? (
            <span className="text-[13px] font-semibold text-owner-danger">{t("nsw.rev.err.price", { paid: pkr(target.paid) })}</span>
          ) : null}
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[14px] font-bold text-owner-ink">{t("nsw.rev.received")}</span>
          <input
            value={received}
            data-testid="reverse-received"
            inputMode="numeric"
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setReceived(e.target.value.replace(/[^0-9,]/g, ""))}
            aria-invalid={touched && problem === "received"}
            className={fieldClass(touched && problem === "received")}
          />
          <span className={`text-[13px] ${touched && problem === "received" ? "font-semibold text-owner-danger" : "text-owner-ink-muted"}`}>
            {t("nsw.rev.receivedHint", { max: pkr(room) })}
          </span>
        </label>
        <MethodPicker
          method={method}
          setMethod={setMethod}
          file={file}
          setFile={setFile}
          showFile={method === "transfer" && (got ?? 0) > 0}
          invalidFile={touched && problem === "screenshot"}
        />
        {touched && problem === "method" ? <p className="text-[13px] font-semibold text-owner-danger">{t("nsw.rev.err.method")}</p> : null}
        <div aria-live="polite" role="status" className="text-[14px] text-owner-ink-muted">
          {method === "transfer" && (got ?? 0) > 0
            ? t("nsw.rev.transferNote")
            : dueAfter != null && dueAfter > 0
              ? t("nsw.rev.dueAfter", { due: pkr(dueAfter) })
              : null}
        </div>
        <p role="alert" className={error ? "rounded-xl bg-owner-danger-soft px-4 py-3 text-[14px] font-semibold text-owner-danger" : "sr-only"}>
          {error}
        </p>
        <div className="flex flex-wrap justify-end gap-3">
          <button type="button" onClick={onClose} className="min-h-12 rounded-xl border-2 border-owner-ink px-6 text-[15px] font-bold text-owner-ink">
            {t("ovw.cmp.cancel")}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            data-testid="reverse-save"
            className="min-h-12 rounded-xl bg-fl-teal px-6 text-[15px] font-bold text-fl-white disabled:opacity-60"
          >
            {saving ? t("ovw.cmp.saving") : t("nsw.rev.save")}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

/** audit fixes 2026-10-31: dues "Done": cash (settled now) or transfer (screenshot to Approvals, settled once approved). */
export function DueDoneDialog({
  claimId,
  label,
  due,
  onClose,
  onDone,
}: {
  claimId: string;
  label: string;
  due: number;
  onClose: () => void;
  onDone: (transfer: boolean) => void;
}) {
  const t = useT();
  const titleId = useId();
  const [method, setMethod] = useState<MoneyMethod | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = dueDoneProblem(method, !!file);

  async function save() {
    setTouched(true);
    if (problem || saving || method == null) return;
    setSaving(true);
    setError(null);
    try {
      await api.phase3.dueDone(claimId, method, method === "transfer" ? file : null);
      onDone(method === "transfer");
    } catch (e) {
      setError(moneyErrorText(e, t));
      setSaving(false);
    }
  }

  return (
    <ModalShell labelledBy={titleId} onClose={onClose} maxWidthClass="md:max-w-[500px]">
      <div className="flex flex-col gap-5 p-6 md:p-8" data-testid="due-done-dialog">
        <div>
          <h2 id={titleId} className="font-khelo-display text-[24px] font-extrabold leading-tight text-owner-ink">
            {t("odash.p3.done.title", { due: pkr(due) })}
          </h2>
          <p className="mt-1 break-words text-[14px] text-owner-ink-muted">{label}</p>
        </div>
        <MethodPicker method={method} setMethod={setMethod} file={file} setFile={setFile} showFile={method === "transfer"} invalidFile={touched && problem === "screenshot"} />
        {touched && problem === "method" ? <p className="text-[13px] font-semibold text-owner-danger">{t("nsw.rev.err.method")}</p> : null}
        <p className="text-[13.5px] text-owner-ink-muted">{method === "transfer" ? t("odash.p3.done.transferNote") : t("odash.p3.done.cashNote")}</p>
        <p role="alert" className={error ? "rounded-xl bg-owner-danger-soft px-4 py-3 text-[14px] font-semibold text-owner-danger" : "sr-only"}>
          {error}
        </p>
        <div className="flex flex-wrap justify-end gap-3">
          <button type="button" onClick={onClose} className="min-h-12 rounded-xl border-2 border-owner-ink px-6 text-[15px] font-bold text-owner-ink">
            {t("ovw.cmp.cancel")}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            data-testid="due-done-save"
            className="min-h-12 rounded-xl bg-fl-teal px-6 text-[15px] font-bold text-fl-white disabled:opacity-60"
          >
            {saving ? t("ovw.cmp.saving") : t("odash.p3.done.save")}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
