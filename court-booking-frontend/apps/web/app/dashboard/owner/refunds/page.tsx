"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ErrorState } from "@/components/error-state";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR, formatWhen } from "@/lib/format";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import type { OwnerRefund } from "@court-booking/types";

/** Section 32 Part 10: the owner's "Refunds to pay" screen. A refund here was always sent
 * OUTSIDE the app (JazzCash/bank) -- there is no payment gateway. This screen only records
 * that it happened, with a reference the owner can point to later if a player disputes it. */
export default function OwnerRefundsPage() {
  const { activeVenueId, isLoading: venuesLoading } = useOwnerVenues();
  const queryClient = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["owner-refunds", activeVenueId],
    queryFn: () => api.owners.refunds(activeVenueId),
    enabled: !!activeVenueId,
  });

  const list = query.data ?? [];
  const open = list.find((r) => r.id === openId) ?? null;

  return (
    <div className="p-8 max-w-3xl flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Refunds to pay</h1>
        <p className="text-owner-ink-faint text-sm">
          {list.length === 0 ? "Nothing owed right now" : `${list.length} refund${list.length === 1 ? "" : "s"} owed`}
        </p>
      </div>

      {venuesLoading || query.isLoading ? (
        <p className="p-10 text-center text-owner-ink-faint">Loading…</p>
      ) : query.isError ? (
        <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} tone="owner" />
      ) : list.length === 0 ? (
        <div className="bg-owner-surface border border-owner-border rounded-xl p-10 text-center text-owner-ink-faint">
          No refunds are waiting to be paid out.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {list.map((refund) => (
            <div
              key={refund.id}
              className="bg-owner-surface border rounded-xl p-4 flex items-center justify-between gap-4"
              style={{ borderColor: refund.is_overdue ? "#DDBAB1" : undefined }}
            >
              <div className="flex flex-col gap-0.5 min-w-0">
                <p className="font-bold truncate">{refund.player_name ?? refund.player_phone ?? "Player"}</p>
                <p className="text-owner-ink-muted text-[13px]">
                  {refund.court_name} · {formatWhen(refund.starts_at)}
                </p>
                {refund.is_overdue ? (
                  <p className="text-[12px] font-semibold" style={{ color: "#A8432C" }}>
                    Overdue -- flagged {formatWhen(refund.created_at)}
                  </p>
                ) : null}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="font-mono font-bold text-[15px]">PKR {formatPKR(refund.refund_amount)}</span>
                <button
                  onClick={() => setOpenId(refund.id)}
                  className="px-4 h-10 rounded-lg text-white font-semibold text-[13.5px]"
                  style={{ background: "#0E6274" }}
                >
                  Mark Refunded
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {open ? (
        <MarkRefundedDialog
          refund={open}
          onClose={() => setOpenId(null)}
          onDone={async () => {
            setOpenId(null);
            await queryClient.invalidateQueries({ queryKey: ["owner-refunds"] });
            await queryClient.invalidateQueries({ queryKey: ["owner-ledger"] });
          }}
        />
      ) : null}
    </div>
  );
}

function MarkRefundedDialog({ refund, onClose, onDone }: { refund: OwnerRefund; onClose: () => void; onDone: () => void }) {
  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState(String(Math.round(refund.refund_amount)));
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const trimmedReference = reference.trim();
    if (!trimmedReference) {
      setError("Add a reference (e.g. the JazzCash/bank transaction id) so this can be traced later.");
      return;
    }
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
      setError("Enter a valid amount.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.owners.markRefundPaid(refund.id, trimmedReference, parsedAmount, screenshot ?? undefined);
      onDone();
    } catch (e) {
      setError(friendlyErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-owner-surface rounded-xl p-6 w-full max-w-md flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 className="text-lg font-bold">Mark refund as sent</h2>
          <p className="text-owner-ink-faint text-[13px]">
            {refund.player_name ?? refund.player_phone} · {refund.court_name} · owed PKR {formatPKR(refund.refund_amount)}
          </p>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold text-owner-ink-muted">Amount refunded (PKR)</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="numeric"
            className="h-11 px-3.5 rounded-lg border border-owner-border outline-none text-sm font-mono"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold text-owner-ink-muted">Reference (required)</span>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="e.g. JazzCash TXN 12345, or bank transfer ref"
            className="h-11 px-3.5 rounded-lg border border-owner-border outline-none text-sm"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold text-owner-ink-muted">Screenshot (optional)</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => setScreenshot(e.target.files?.[0] ?? null)}
            className="text-sm"
          />
        </label>

        {error ? <p className="text-[13px] font-semibold" style={{ color: "#A8432C" }}>{error}</p> : null}

        <div className="flex gap-2.5 mt-2">
          <button onClick={onClose} className="flex-1 h-12 rounded-xl border border-owner-border font-semibold">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="flex-1 h-12 rounded-xl text-white font-semibold disabled:opacity-60"
            style={{ background: "#0E6274" }}
          >
            {busy ? "Saving…" : "Confirm refunded"}
          </button>
        </div>
      </div>
    </div>
  );
}
