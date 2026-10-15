"use client";

import { useOwnerCourtSports } from "@/lib/court-sports";

import { courtLabel } from "@/components/court-label";

import { useState } from "react";
import { approvalSummary } from "@court-booking/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ErrorState } from "@/components/error-state";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR } from "@/lib/format";
import { useT } from "@/components/i18n/lang-provider";
import { useFmt } from "@/lib/use-fmt";
import type { MessageKey } from "@/lib/i18n";
import { pollInterval } from "@/lib/polling";
import { useOwnerVenues } from "@/lib/use-owner-venues";

// The English value is what is sent to the backend (and shown to the player); only the label on the button is translated.
const REJECT_REASONS: { value: string; label: MessageKey }[] = [
  { value: "Amount doesn't match", label: "odash.approvals.reason.amount" },
  { value: "Screenshot unreadable", label: "odash.approvals.reason.unreadable" },
  { value: "Looks like a duplicate", label: "odash.approvals.reason.duplicate" },
  { value: "Other", label: "odash.approvals.reason.other" },
];

export default function OwnerApprovalsPage() {
  const t = useT();
  const fmt = useFmt();
  const sports = useOwnerCourtSports();
  const { activeVenueId, isLoading: venuesLoading } = useOwnerVenues();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  const query = useQuery({
    queryKey: ["owner-pending-approvals", activeVenueId],
    queryFn: () => api.owners.pendingApprovals(activeVenueId),
    // Was unconditional before -- fired once with activeVenueId still undefined (an unscoped
    // fetch across every venue the owner has) and again once it resolved. Gating on it, like
    // every other owner screen, avoids that flash and keeps this query's own isLoading
    // meaningful once combined with venuesLoading below (Section 29 Part A).
    enabled: !!activeVenueId,
    refetchInterval: (query) => pollInterval(query, 15_000),
  });

  const list = query.data ?? [];
  const current = list[0];

  // Money-correctness: the owner confirms how much the player really paid. Pre-filled with the screenshot
  // amount (else the expected one); editing it re-labels the card and is what gets credited on Approve.
  const [amountEdit, setAmountEdit] = useState<{ paymentId: string; text: string } | null>(null);
  const defaultAmount = current?.checks?.paid_amount ?? current?.expected_amount ?? 0;
  const amountText = amountEdit && amountEdit.paymentId === current?.payment_id ? amountEdit.text : String(defaultAmount);
  const amountValue = /^\d+$/.test(amountText.trim()) ? Number(amountText.trim()) : null;
  const summary = current?.checks && amountValue !== null && amountValue > 0 ? approvalSummary(current.checks, amountValue) : null;

  function resetRejectSheet() {
    setRejecting(false);
    setRejectReason(null);
    setRejectNote("");
  }

  async function handleApprove() {
    if (!current) return;
    if (current.checks && (amountValue === null || amountValue <= 0)) {
      alert(t("odash.approvals.alert.amount"));
      return;
    }
    setBusy(true);
    try {
      await api.payments.approve(current.payment_id, current.checks ? (amountValue ?? undefined) : undefined);
      await queryClient.invalidateQueries({ queryKey: ["owner-pending-approvals"] });
      await queryClient.invalidateQueries({ queryKey: ["owner-today"] });
    } catch (e) {
      alert(friendlyErrorMessage(e, t));
    } finally {
      setBusy(false);
    }
  }

  async function submitReject() {
    if (!current) return;
    const reason = rejectReason === "Other" ? rejectNote.trim() : rejectReason;
    if (!reason) {
      alert(t("odash.approvals.alert.reason"));
      return;
    }
    setBusy(true);
    try {
      await api.payments.reject(current.payment_id, reason);
      resetRejectSheet();
      await queryClient.invalidateQueries({ queryKey: ["owner-pending-approvals"] });
      await queryClient.invalidateQueries({ queryKey: ["owner-today"] });
    } catch (e) {
      alert(friendlyErrorMessage(e, t));
    } finally {
      setBusy(false);
    }
  }

  const summaryText = summary
    ? summary.status === "paid_in_full"
      ? t("odash.approvals.sum.paid_in_full")
      : t(summary.status === "overpaid" ? "odash.approvals.sum.overpaid" : "odash.approvals.sum.underpaid", {
          amount: `PKR ${formatPKR(Math.abs((amountValue ?? 0) - (current?.checks?.expected_amount ?? 0)))}`,
        })
    : "";
  const verdict = current?.ocr_verdict ?? null;
  const tone = verdict === "match" ? "match" : verdict === "mismatch" ? "mismatch" : "unreadable";

  return (
    <div className="p-8 max-w-2xl flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">{t("odash.approvals.title")}</h1>
        <p className="text-owner-ink-faint text-sm">{list.length === 0 ? t("odash.approvals.none") : t("odash.approvals.count", { n: list.length })}</p>
      </div>

      {venuesLoading || query.isLoading ? (
        <p className="p-10 text-center text-owner-ink-faint">{t("odash.approvals.loading")}</p>
      ) : query.isError && list.length === 0 ? (
        <ErrorState message={friendlyErrorMessage(query.error, t)} onRetry={() => query.refetch()} tone="owner" />
      ) : !current ? (
        <div className="bg-owner-surface border border-owner-border rounded-xl p-10 text-center text-owner-ink-faint">
          {t("odash.approvals.empty")}
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
                {t(`odash.approvals.tone.${tone}`)}
              </span>
              <span className="text-[12.5px]" style={{ color: tone === "match" ? "#3D7A5E" : "#5B7079" }}>
                {current.ocr_amount != null
                  ? t("odash.approvals.read", { read: formatPKR(current.ocr_amount), expected: formatPKR(current.expected_amount) })
                  : t("odash.approvals.expected", { expected: formatPKR(current.expected_amount) })}
              </span>
            </div>
          </div>

          <div className="bg-owner-surface border border-owner-border rounded-xl p-5 flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-owner-accent text-white flex items-center justify-center font-semibold">
                {(current.player_name ?? "?").slice(0, 2).toUpperCase()}
              </div>
              <div>
                <p className="font-bold">{current.player_name ?? t("odash.approvals.player")}</p>
                {current.player_phone ? <p className="font-mono text-[12.5px] text-owner-ink-muted">{current.player_phone}</p> : null}
              </div>
            </div>
            <div className="h-px bg-owner-border-light" />
            <Row label={t("odash.approvals.row.slot")} value={`${courtLabel(current.court_name, current.court_sport ?? sports.byName(current.court_name))} \u00b7 ${fmt.timeRange(current.starts_at, current.ends_at)}`} />
            <Row label={t("odash.approvals.row.advance")} value={`PKR ${formatPKR(current.expected_amount)}`} />
            <Row label={t("odash.approvals.row.submitted")} value={t("odash.approvals.minAgo", { n: current.minutes_since_submission.toFixed(0) })} />
          </div>

          {current.checks ? (
            <div className="bg-owner-surface border border-owner-border rounded-xl p-5 flex flex-col gap-2.5">
              <p className="font-bold text-owner-ink text-[13.5px]">{t("odash.approvals.checks")}</p>
              <CheckRow check={current.checks.name} />
              <CheckRow check={current.checks.amount} />
              <div className="flex flex-col gap-2 rounded-lg border border-owner-border p-3 -mx-1">
                <label className="text-[13px] font-semibold text-owner-ink" htmlFor="amount-received">
                  {t("odash.approvals.amountReceived")}
                </label>
                <input
                  id="amount-received"
                  inputMode="numeric"
                  value={amountText}
                  onChange={(e) => setAmountEdit({ paymentId: current.payment_id, text: e.target.value })}
                  className="h-11 px-3.5 rounded-lg border border-owner-border outline-none text-sm font-mono"
                />
                {summary ? (
                  <>
                    <p
                      className="text-[14px] font-bold"
                      style={{ color: summary.status === "paid_in_full" ? "#14563A" : summary.status === "overpaid" ? "#8A5A00" : "#8C3823" }}
                    >
                      {summaryText}
                    </p>
                    <p className="font-mono text-owner-ink-muted text-[12.5px]">
                      {t("odash.approvals.totals", { total: formatPKR(summary.totalAfter + summary.balanceAfter), paid: formatPKR(summary.totalAfter), balance: formatPKR(summary.balanceAfter) })}
                    </p>
                    {summary.excess > 0 ? (
                      <p className="text-[12.5px]" style={{ color: "#8A5A00" }}>
                        {t("odash.approvals.excess", { amount: formatPKR(summary.excess) })}
                      </p>
                    ) : null}
                  </>
                ) : null}
              </div>
              <CheckRow check={current.checks.time} />
              <CheckRow check={current.checks.bank} />
              <CheckRow check={current.checks.duplicate} />
            </div>
          ) : null}

          {current.proof_url ? (
            <div className="bg-owner-surface border border-owner-border rounded-xl p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={current.proof_url} alt={t("odash.approvals.proofAlt")} className="w-full max-h-80 object-contain rounded-lg" />
            </div>
          ) : (
            <div className="bg-owner-surface border border-owner-border rounded-xl p-5 text-owner-ink-faint text-sm">{t("odash.approvals.noProof")}</div>
          )}

          {rejecting ? (
            <div className="flex flex-col gap-3">
              <p className="font-semibold text-owner-ink-muted text-sm">{t("odash.approvals.why")}</p>
              <div className="flex flex-wrap gap-2">
                {REJECT_REASONS.map((r) => (
                  <button
                    key={r.value}
                    onClick={() => setRejectReason(r.value)}
                    className="px-3.5 py-2.5 rounded-lg text-[13px] font-semibold"
                    style={{ background: rejectReason === r.value ? "#8C3823" : "#F4F6F7", color: rejectReason === r.value ? "#fff" : "#5B7079" }}
                  >
                    {t(r.label)}
                  </button>
                ))}
              </div>
              {rejectReason === "Other" ? (
                <input
                  value={rejectNote}
                  onChange={(e) => setRejectNote(e.target.value)}
                  placeholder={t("odash.approvals.describe")}
                  className="h-11 px-3.5 rounded-lg border border-owner-border outline-none text-sm"
                />
              ) : null}
              <div className="flex gap-2.5">
                <button onClick={resetRejectSheet} className="flex-1 h-12 rounded-xl border border-owner-border font-semibold">{t("odash.approvals.cancel")}</button>
                <button onClick={submitReject} disabled={busy} className="flex-1 h-12 rounded-xl text-white font-semibold disabled:opacity-60" style={{ background: "#8C3823" }}>
                  {t("odash.approvals.confirmReject")}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2.5">
              <button onClick={handleApprove} disabled={busy} className="flex-1 h-13 rounded-xl text-white font-bold disabled:opacity-60" style={{ background: "#1F7A52", height: 52 }}>
                {t("odash.approvals.approve")}
              </button>
              <button onClick={() => setRejecting(true)} disabled={busy} className="w-28 h-13 rounded-xl font-bold border" style={{ borderColor: "#DDBAB1", color: "#A8432C", height: 52 }}>
                {t("odash.approvals.reject")}
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

/** Section 32 Part 7 -- tick/warning/cross colors for the five plain-
 * language checks. "not_available"/"not_configured" are neutral (grey),
 * never a failure color -- they mean "nothing to compare," not "bad."
 * Kept in step with mobile's CHECK_COLORS in apps/mobile/app/(owner)/approvals.tsx. */
const CHECK_COLORS: Record<string, string> = {
  match: "#1F7A52",
  mismatch: "#A8432C",
  warning: "#B8860B",
  not_available: "#8399A1",
  not_configured: "#8399A1",
};

function CheckRow({ check }: { check: { verdict: string; text: string } }) {
  const color = CHECK_COLORS[check.verdict] ?? "#8399A1";
  return (
    <div className="flex items-start gap-2.5">
      <span className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: color }} />
      <span className="flex-1 text-owner-ink text-[13px] leading-[18px]">{check.text}</span>
    </div>
  );
}
