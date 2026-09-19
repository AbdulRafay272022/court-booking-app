"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ErrorState } from "@/components/error-state";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR, formatTimeRange } from "@/lib/format";
import { pollInterval } from "@/lib/polling";
import { useOwnerVenues } from "@/lib/use-owner-venues";

const REJECT_REASONS = ["Amount doesn't match", "Screenshot unreadable", "Looks like a duplicate", "Other"];

export default function OwnerApprovalsPage() {
  const { activeVenueId } = useOwnerVenues();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  const query = useQuery({
    queryKey: ["owner-pending-approvals", activeVenueId],
    queryFn: () => api.owners.pendingApprovals(activeVenueId),
    refetchInterval: (query) => pollInterval(query, 15_000),
  });

  const list = query.data ?? [];
  const current = list[0];

  function resetRejectSheet() {
    setRejecting(false);
    setRejectReason(null);
    setRejectNote("");
  }

  async function handleApprove() {
    if (!current) return;
    setBusy(true);
    try {
      await api.payments.approve(current.payment_id);
      await queryClient.invalidateQueries({ queryKey: ["owner-pending-approvals"] });
      await queryClient.invalidateQueries({ queryKey: ["owner-today"] });
    } catch (e) {
      alert(friendlyErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitReject() {
    if (!current) return;
    const reason = rejectReason === "Other" ? rejectNote.trim() : rejectReason;
    if (!reason) {
      alert("Choose a reason (or write one) before rejecting.");
      return;
    }
    setBusy(true);
    try {
      await api.payments.reject(current.payment_id, reason);
      resetRejectSheet();
      await queryClient.invalidateQueries({ queryKey: ["owner-pending-approvals"] });
      await queryClient.invalidateQueries({ queryKey: ["owner-today"] });
    } catch (e) {
      alert(friendlyErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const verdict = current?.ocr_verdict ?? null;
  const tone = verdict === "match" ? "match" : verdict === "mismatch" ? "mismatch" : "unreadable";

  return (
    <div className="p-8 max-w-2xl flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Payment review</h1>
        <p className="text-owner-ink-faint text-sm">{list.length === 0 ? "Nothing waiting" : `1 of ${list.length} waiting`}</p>
      </div>

      {query.isError && list.length === 0 ? (
        <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} tone="owner" />
      ) : !current ? (
        <div className="bg-owner-surface border border-owner-border rounded-xl p-10 text-center text-owner-ink-faint">
          All caught up — no payment screenshots are waiting for review.
        </div>
      ) : (
        <>
          <div
            className="rounded-xl p-4 flex items-center gap-3.5"
            style={{
              background: tone === "match" ? "#E4F0EA" : tone === "mismatch" ? "#F8E5E0" : "#EFF2F3",
              border: `1px solid ${tone === "match" ? "#A9CFBD" : tone === "mismatch" ? "#DDBAB1" : "#DCE3E6"}`,
            }}
          >
            <div className="flex flex-col">
              <span className="font-bold text-[14.5px]" style={{ color: tone === "match" ? "#14563A" : tone === "mismatch" ? "#8C3823" : "#5B7079" }}>
                {tone === "match" ? "Amount matches" : tone === "mismatch" ? "Amount mismatch" : "Couldn't read the screenshot"}
              </span>
              <span className="text-[12.5px]" style={{ color: tone === "match" ? "#3D7A5E" : "#5B7079" }}>
                {current.ocr_amount != null
                  ? `We read PKR ${formatPKR(current.ocr_amount)} · expected PKR ${formatPKR(current.expected_amount)}`
                  : `Expected PKR ${formatPKR(current.expected_amount)}`}
              </span>
            </div>
          </div>

          <div className="bg-owner-surface border border-owner-border rounded-xl p-5 flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-owner-accent text-white flex items-center justify-center font-semibold">
                {(current.player_name ?? "?").slice(0, 2).toUpperCase()}
              </div>
              <div>
                <p className="font-bold">{current.player_name ?? "Player"}</p>
                {current.player_phone ? <p className="font-mono text-[12.5px] text-owner-ink-muted">{current.player_phone}</p> : null}
              </div>
            </div>
            <div className="h-px bg-owner-border-light" />
            <Row label="Slot" value={`${current.court_name} · ${formatTimeRange(current.starts_at, current.ends_at)}`} />
            <Row label="Advance due" value={`PKR ${formatPKR(current.expected_amount)}`} />
            <Row label="Submitted" value={`${current.minutes_since_submission.toFixed(0)} min ago`} />
          </div>

          {current.proof_url ? (
            <div className="bg-owner-surface border border-owner-border rounded-xl p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={current.proof_url} alt="Payment proof" className="w-full max-h-80 object-contain rounded-lg" />
            </div>
          ) : (
            <div className="bg-owner-surface border border-owner-border rounded-xl p-5 text-owner-ink-faint text-sm">No screenshot on file.</div>
          )}

          {rejecting ? (
            <div className="flex flex-col gap-3">
              <p className="font-semibold text-owner-ink-muted text-sm">Why are you rejecting this?</p>
              <div className="flex flex-wrap gap-2">
                {REJECT_REASONS.map((r) => (
                  <button
                    key={r}
                    onClick={() => setRejectReason(r)}
                    className="px-3.5 py-2.5 rounded-lg text-[13px] font-semibold"
                    style={{ background: rejectReason === r ? "#8C3823" : "#F4F6F7", color: rejectReason === r ? "#fff" : "#5B7079" }}
                  >
                    {r}
                  </button>
                ))}
              </div>
              {rejectReason === "Other" ? (
                <input
                  value={rejectNote}
                  onChange={(e) => setRejectNote(e.target.value)}
                  placeholder="Describe the issue"
                  className="h-11 px-3.5 rounded-lg border border-owner-border outline-none text-sm"
                />
              ) : null}
              <div className="flex gap-2.5">
                <button onClick={resetRejectSheet} className="flex-1 h-12 rounded-xl border border-owner-border font-semibold">Cancel</button>
                <button onClick={submitReject} disabled={busy} className="flex-1 h-12 rounded-xl text-white font-semibold disabled:opacity-60" style={{ background: "#8C3823" }}>
                  Confirm reject
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2.5">
              <button onClick={handleApprove} disabled={busy} className="flex-1 h-13 rounded-xl text-white font-bold disabled:opacity-60" style={{ background: "#1F7A52", height: 52 }}>
                Approve
              </button>
              <button onClick={() => setRejecting(true)} disabled={busy} className="w-28 h-13 rounded-xl font-bold border" style={{ borderColor: "#DDBAB1", color: "#A8432C", height: 52 }}>
                Reject
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-owner-ink-muted text-[13.5px]">{label}</span>
      <span className="font-mono font-semibold text-[13.5px]">{value}</span>
    </div>
  );
}
