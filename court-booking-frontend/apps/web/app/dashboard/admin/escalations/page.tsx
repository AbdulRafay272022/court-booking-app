"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { escalationKindLabel, refundCheckLabel, refundCheckReasons, type AdminEscalation } from "@court-booking/types";
import { api } from "@/lib/api";
import { formatPKR } from "@/lib/format";
import { useFmt } from "@/lib/use-fmt";
import { ErrorState } from "@/components/error-state";
import { friendlyErrorMessage } from "@/lib/error-messages";

/** fix/nov-9 items 9 + 12: "Khelo se shikayat karein" -- a player took a venue's "no" (no-show kept, amount due kept, refund
 * not received) to Khelo. The admin decides for the player or the venue with a one-line reason both sides see. Deciding for
 * the player waives the due / makes the refund owed again / reopens the no-show for the owner. (English, like the console.) */
export default function AdminEscalationsPage() {
  const [tab, setTab] = useState<"open" | "decided">("open");
  const q = useQuery({ queryKey: ["admin-escalations", tab], queryFn: () => api.refundDisputes.adminList(tab) });
  return (
    <div className="flex min-w-0 flex-col gap-5 px-4 py-6 sm:px-8" data-testid="admin-escalations">
      <h1 className="text-2xl font-bold">Complaints to Khelo</h1>
      <div className="flex gap-2" role="tablist">
        {(["open", "decided"] as const).map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={tab === s}
            onClick={() => setTab(s)}
            className={`min-h-11 rounded-lg px-4 text-sm font-semibold ${tab === s ? "bg-owner-ink text-white" : "border border-owner-border"}`}
          >
            {s === "open" ? "Open" : "Decided"}
          </button>
        ))}
      </div>
      {q.isError ? (
        <ErrorState message={friendlyErrorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : !q.data ? (
        <p className="text-owner-ink-faint">Loading…</p>
      ) : q.data.length === 0 ? (
        <p className="text-owner-ink-muted">{tab === "open" ? "No open complaints." : "Nothing decided yet."}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {q.data.map((e) => (
            <EscalationCard key={e.id} e={e} />
          ))}
        </ul>
      )}
    </div>
  );
}

function EscalationCard({ e }: { e: AdminEscalation }) {
  const fmt = useFmt();
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function decide(decision: "player" | "venue") {
    if (!note.trim()) return setError("Write a one-line reason first; both sides see it.");
    setBusy(true);
    setError(null);
    try {
      await api.refundDisputes.adminDecide(e.id, decision, note.trim());
      await qc.invalidateQueries({ queryKey: ["admin-escalations"] });
    } catch (err) {
      setError(friendlyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  const d = e.detail;
  const t = d.transfer;
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-owner-border bg-white p-4" data-testid="admin-escalation">
      <p className="flex flex-wrap items-center gap-2 font-bold">
        <span className="rounded-full border border-owner-border px-2 py-0.5 text-[12px]">{escalationKindLabel(e.kind, "en")}</span>
        {e.booking_code} · {e.venue_name} · {e.court_name}
      </p>
      <p className="text-[13.5px] text-owner-ink-muted">
        {e.player_name ?? "Player"}{e.player_phone ? ` (${e.player_phone})` : ""}
        {e.starts_at ? ` · ${fmt.when(e.starts_at)}` : ""}
        {e.price != null ? ` · price PKR ${formatPKR(e.price)}, paid PKR ${formatPKR(e.amount_paid ?? 0)}` : ""}
      </p>
      {e.reason ? <p className="text-[14px]">Player: “{e.reason}”</p> : null}
      {d.player_note ? <p className="text-[13.5px] text-owner-ink-muted">Earlier note: {d.player_note}</p> : null}
      {d.due_pkr != null ? (
        <p className="text-[13.5px]">Total PKR {formatPKR(d.total_pkr ?? 0)} · paid PKR {formatPKR(d.paid_pkr ?? 0)} · due PKR {formatPKR(d.due_pkr)}</p>
      ) : null}
      {t ? (
        <div className="flex flex-col gap-1 rounded-lg border border-owner-border p-3 text-[13.5px]">
          <p>
            Venue sent PKR {formatPKR(t.amount)} on {fmt.when(t.sent_at)}{t.reference ? ` (ref ${t.reference})` : ""} · check:{" "}
            <b>{refundCheckLabel(t.ocr_verdict, "en")}</b>
            {t.ocr_reasons.length ? ` (${refundCheckReasons(t.ocr_reasons, "en").join(", ")})` : ""}
          </p>
          {t.ocr_amount != null || t.ocr_receiver ? (
            <p className="text-owner-ink-muted">Screenshot read: {t.ocr_amount != null ? `PKR ${formatPKR(t.ocr_amount)}` : "no amount"}{t.ocr_receiver ? ` · to ${t.ocr_receiver}` : ""}</p>
          ) : null}
          {d.payout ? (
            <p className="text-owner-ink-muted">Player&apos;s account: {d.payout.method_label} {d.payout.account_masked} ({d.payout.title})</p>
          ) : null}
          {t.player_note ? <p>Player: {t.player_note}</p> : null}
          {t.owner_reply ? <p>Venue replied: {t.owner_reply}</p> : null}
          {t.screenshot_url ? (
            <a href={t.screenshot_url} target="_blank" rel="noopener noreferrer" className="font-semibold text-owner-accent underline">
              Open the venue&apos;s screenshot
            </a>
          ) : null}
        </div>
      ) : null}
      {e.status === "decided" ? (
        <p className="text-[14px] font-semibold">
          Decided for the {e.admin_decision} {e.decided_at ? `on ${fmt.when(e.decided_at)}` : ""}: {e.admin_note}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <textarea
            value={note}
            onChange={(ev) => setNote(ev.target.value)}
            rows={2}
            maxLength={1000}
            placeholder="One-line reason (both sides see it)"
            className="rounded-lg border border-owner-border px-3 py-2 text-[14px]"
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => decide("player")} className="min-h-11 rounded-lg bg-owner-ink px-4 text-sm font-semibold text-white">
              Player is right
            </button>
            <button type="button" disabled={busy} onClick={() => decide("venue")} className="min-h-11 rounded-lg border border-owner-border px-4 text-sm font-semibold">
              Venue is right
            </button>
          </div>
          <p className="text-[12.5px] text-owner-ink-faint">
            {e.kind === "short_payment"
              ? "Player is right = the amount due is waived."
              : e.kind === "refund"
                ? "Player is right = this transfer is taken back and the venue owes it again."
                : "Player is right = the venue's 'keep no-show' is undone; the owner removes it with the real amounts."}
          </p>
          {error ? <p className="text-[13px] font-semibold text-fl-danger" role="alert">{error}</p> : null}
        </div>
      )}
    </li>
  );
}
