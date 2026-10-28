"use client";

import { useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatPKR } from "@/lib/format";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useT } from "@/components/i18n/lang-provider";

/**
 * audit 2026-10-28 item 20: the ONE "send your payment here" card for the advance (pay page) and the balance (booking page):
 * bank, account title, account number / IBAN, the amount, the booking code to write in the transfer note, and a Raast QR with
 * the amount filled in when the `iban_qr` flag is on and the venue saved a valid IBAN. Read fresh from the server, so it no
 * longer depends on the hold response being remembered in this browser.
 */
export function PaymentInstructionsCard({ bookingId, fallback }: { bookingId: string; fallback?: { bank: string | null; account_title: string | null; account_number: string | null; iban: string | null } | null }) {
  const t = useT();
  const query = useQuery({ queryKey: ["payment-instructions", bookingId], queryFn: () => api.bookings.paymentInstructions(bookingId) });
  const d = query.data;
  const bank = d ?? fallback;
  if (d && d.kind === "none") return null;
  const has = !!bank && !!(bank.account_number || bank.iban);
  if (!has) {
    return query.isLoading ? null : <div className="rounded-fl-card bg-fl-white p-5 text-[13px] text-fl-muted">{t("play.pay.noDetails")}</div>;
  }
  return (
    <div className="flex flex-col gap-3 rounded-fl-card bg-fl-white p-5" data-testid="payment-instructions">
      <span className="text-[12px] font-extrabold tracking-widest text-fl-muted2">
        {d?.kind === "balance" ? t("play.pay.sendBalanceTo") : t("play.pay.sendTo")}
      </span>
      {d ? <Row label={t("play.pay.amountNow")} value={`PKR ${formatPKR(d.amount)}`} /> : null}
      {bank!.bank ? <Row label={t("play.pay.bank")} value={bank!.bank} /> : null}
      {bank!.account_title ? <Row label={t("play.pay.accountTitle")} value={bank!.account_title} /> : null}
      {bank!.account_number ? <Row label={t("play.pay.accountNumber")} value={bank!.account_number} mono /> : null}
      {bank!.iban ? <Row label={t("play.pay.iban")} value={bank!.iban} mono /> : null}
      {d ? <Row label={t("play.pay.reference")} value={d.reference} mono /> : null}
      {d?.qr_payload ? (
        <div className="flex flex-col items-center gap-2 pt-2" data-testid="raast-qr">
          <div className="rounded-xl bg-white p-3">
            <QRCodeSVG value={d.qr_payload} size={196} level="M" />
          </div>
          <p className="text-center text-[12.5px] text-fl-muted">{t("play.pay.qrHint")}</p>
        </div>
      ) : null}
      {d?.kind === "balance" && d.balance_upload && d.balance_upload !== "off" ? <BalanceUpload bookingId={bookingId} state={d.balance_upload} /> : null}
    </div>
  );
}

/** audit 2026-10-28 Phase 3 item 2 (flag balance_proof): a screenshot for the BALANCE of a booked booking; same checks as the
 * advance, the owner always looks at it, and the booking stays booked either way. */
function BalanceUpload({ bookingId, state }: { bookingId: string; state: "open" | "pending" }) {
  const t = useT();
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  if (state === "pending") {
    return <p className="rounded-xl bg-fl-ground px-4 py-3 text-[13px] text-fl-night" data-testid="balance-proof-pending">{t("play.pay.balanceUploadPending")}</p>;
  }
  async function send(file: File) {
    setBusy(true);
    setMessage(null);
    try {
      await api.bookings.submitPaymentProof(bookingId, file, file.name, file.type || "image/jpeg");
      setMessage({ ok: true, text: t("play.pay.balanceUploadSent") });
      await queryClient.invalidateQueries({ queryKey: ["payment-instructions", bookingId] });
    } catch (e) {
      setMessage({ ok: false, text: friendlyErrorMessage(e, t) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-2 border-t border-fl-line pt-3" data-testid="balance-proof-upload">
      <p className="text-[13px] text-fl-muted">{t("play.pay.balanceUploadHint")}</p>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        data-testid="balance-proof-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void send(f);
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        className="cursor-pointer self-start whitespace-nowrap rounded-full bg-fl-night px-5 py-2.5 text-[14px] font-bold text-white disabled:cursor-wait disabled:opacity-60"
      >
        {busy ? "..." : t("play.pay.balanceUploadButton")}
      </button>
      {message ? <p className={`text-[13px] ${message.ok ? "text-fl-open" : "text-fl-danger"}`} role="status">{message.text}</p> : null}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 text-[14px]">
      <span className="text-fl-muted">{label}</span>
      <span className={`select-all font-bold text-fl-night ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}
