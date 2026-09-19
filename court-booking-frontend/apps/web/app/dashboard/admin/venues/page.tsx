"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ErrorState } from "@/components/error-state";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { capitalize } from "@/lib/format";

const REASONS = ["Missing bank details", "Address looks incomplete", "Photos needed", "Other"];

export default function AdminVenuesPage() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["admin-pending-venues"], queryFn: () => api.admin.pendingVenues() });
  const venues = query.data ?? [];
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionFor, setActionFor] = useState<{ venueId: string; type: "reject" | "changes" } | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState("");

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["admin-pending-venues"] });
  }

  async function approve(venueId: string) {
    setBusyId(venueId);
    try {
      await api.admin.approveVenue(venueId);
      await refresh();
    } catch (e) {
      alert(friendlyErrorMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  async function submitAction() {
    if (!actionFor) return;
    const finalReason = reason === "Other" ? note.trim() : reason;
    if (!finalReason) {
      alert("Choose or write a reason first.");
      return;
    }
    setBusyId(actionFor.venueId);
    try {
      if (actionFor.type === "reject") await api.admin.rejectVenue(actionFor.venueId, finalReason);
      else await api.admin.requestVenueChanges(actionFor.venueId, finalReason);
      setActionFor(null);
      setReason(null);
      setNote("");
      await refresh();
    } catch (e) {
      alert(friendlyErrorMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="p-8 max-w-3xl flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Pending venues</h1>
        <p className="text-owner-ink-faint text-sm">{venues.length} awaiting review</p>
      </div>

      {query.isLoading ? (
        <p className="text-owner-ink-faint">Loading…</p>
      ) : query.isError && venues.length === 0 ? (
        <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} tone="owner" />
      ) : venues.length === 0 ? (
        <div className="bg-owner-surface border border-owner-border rounded-xl p-10 text-center text-owner-ink-faint">
          No venues waiting for review.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {venues.map((v) => (
            <div key={v.id} className="bg-owner-surface border border-owner-border rounded-xl p-6 flex flex-col gap-4">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="font-bold text-lg">{v.name}</h2>
                  <p className="text-owner-ink-muted text-sm">{v.address}, {v.area ?? v.city}</p>
                  <p className="text-owner-ink-faint text-xs mt-1">{v.sports.map(capitalize).join(", ")} · {v.courts.length} court(s)</p>
                </div>
                <span className="px-2.5 py-1 rounded-md bg-owner-warn-soft text-owner-warn text-[11px] font-bold uppercase">{v.status}</span>
              </div>

              {v.bank_details ? (
                <div className="text-sm text-owner-ink-muted">
                  Bank: {v.bank_details.bank} · {v.bank_details.account_title} · {v.bank_details.account_number}
                </div>
              ) : (
                <div className="text-sm text-owner-danger">No bank details provided.</div>
              )}

              {actionFor?.venueId === v.id ? (
                <div className="flex flex-col gap-3 border-t border-owner-border-light pt-4">
                  <p className="text-sm font-semibold text-owner-ink-muted">
                    {actionFor.type === "reject" ? "Why are you rejecting this venue?" : "What changes are needed?"}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {REASONS.map((r) => (
                      <button
                        key={r}
                        onClick={() => setReason(r)}
                        className="px-3 py-2 rounded-lg text-[13px] font-semibold"
                        style={{ background: reason === r ? "#8C3823" : "#F4F6F7", color: reason === r ? "#fff" : "#5B7079" }}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                  {reason === "Other" ? (
                    <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Describe what's needed" className="h-11 px-3.5 rounded-lg border border-owner-border text-sm" />
                  ) : null}
                  <div className="flex gap-2">
                    <button onClick={() => { setActionFor(null); setReason(null); }} className="flex-1 h-11 rounded-lg border border-owner-border font-semibold text-sm">
                      Cancel
                    </button>
                    <button onClick={submitAction} disabled={busyId === v.id} className="flex-1 h-11 rounded-lg text-white font-semibold text-sm" style={{ background: "#8C3823" }}>
                      Confirm
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2.5">
                  <button onClick={() => approve(v.id)} disabled={busyId === v.id} className="flex-1 h-11 rounded-lg text-white font-bold text-sm disabled:opacity-60" style={{ background: "#1F7A52" }}>
                    Approve
                  </button>
                  <button onClick={() => setActionFor({ venueId: v.id, type: "changes" })} className="px-4 h-11 rounded-lg border border-owner-border font-semibold text-sm">
                    Request changes
                  </button>
                  <button onClick={() => setActionFor({ venueId: v.id, type: "reject" })} className="px-4 h-11 rounded-lg border font-semibold text-sm" style={{ borderColor: "#DDBAB1", color: "#A8432C" }}>
                    Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
