"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ShortPaymentDue } from "@court-booking/types";
import { api } from "@/lib/api";
import { formatPKR } from "@/lib/format";
import { useFmt } from "@/lib/use-fmt";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { useT } from "@/components/i18n/lang-provider";

/** audit 2026-10-28 Phase 3 items 4 + 5: money still due on finished bookings ("kam mila"), carried per venue. A disputed one
 * ("Ghalat hai") is decided here (collect / waive); any open one is settled with "Done" once the rest is received. */
export default function OwnerDuesPage() {
  const t = useT();
  const fmt = useFmt();
  const queryClient = useQueryClient();
  const { activeVenueId, isLoading: venuesLoading } = useOwnerVenues();
  const q = useQuery({ queryKey: ["owner-dues", activeVenueId], queryFn: () => api.phase3.dues(activeVenueId!), enabled: !!activeVenueId });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      await queryClient.invalidateQueries({ queryKey: ["owner-dues"] });
      await queryClient.invalidateQueries({ queryKey: ["owner-approvals-queue"] });
    } catch (e) {
      setError(friendlyErrorMessage(e, t));
    } finally {
      setBusy(null);
    }
  }

  const status = (d: ShortPaymentDue) =>
    d.status === "disputed"
      ? d.owner_decision === "collect"
        ? t("odash.p3.st.collect")
        : t("odash.p3.st.disputed")
      : d.status === "confirmed"
        ? t("odash.p3.st.confirmed")
        : d.status === "no_reply"
          ? t("odash.p3.st.no_reply")
          : t("odash.p3.st.awaiting_reply");

  return (
    <div className="flex min-w-0 max-w-4xl flex-col gap-6 p-4 sm:p-8" data-testid="owner-dues">
      <div>
        <h1 className="text-2xl font-bold">{t("odash.p3.duesTitle")}</h1>
        <p className="text-sm text-owner-ink-muted">{t("odash.p3.duesSubtitle")}</p>
      </div>
      {error ? (
        <p className="text-owner-danger" role="alert">
          {error}
        </p>
      ) : null}
      {q.isError ? (
        <p className="text-owner-danger">{friendlyErrorMessage(q.error, t)}</p>
      ) : venuesLoading || q.isLoading || !q.data ? (
        <p className="text-owner-ink-faint">…</p>
      ) : q.data.length === 0 ? (
        <p className="rounded-xl border border-owner-border bg-white p-5 text-owner-ink-muted">{t("odash.p3.duesEmpty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {q.data.map((d) => (
            <li key={d.id} className="flex flex-col gap-2 rounded-xl border border-owner-border bg-white p-4" data-testid="due-row">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-bold">{`${d.player_name ?? t("appr.player")} · ${d.code}${d.starts_at ? ` · ${fmt.dateRelative(d.starts_at)}` : ""}`}</span>
                <span className="font-mono text-[16px] font-bold">{`PKR ${formatPKR(d.due_pkr)}`}</span>
              </div>
              <span className="text-[13px] text-owner-ink-muted">{status(d)}</span>
              {d.player_reason ? <span className="text-[13.5px]">{t("odash.p3.playerReason", { reason: d.player_reason })}</span> : null}
              <div className="flex flex-wrap gap-2">
                {d.status === "disputed" && !d.owner_decision ? (
                  <>
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={() => act(`c${d.id}`, () => api.phase3.decideShort(d.id, "collect"))}
                      className="cursor-pointer whitespace-nowrap rounded-full border border-owner-ink px-4 py-1.5 text-[13px] font-bold disabled:opacity-60"
                    >
                      {t("odash.p3.collect")}
                    </button>
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={() => act(`w${d.id}`, () => api.phase3.decideShort(d.id, "waive"))}
                      className="cursor-pointer whitespace-nowrap rounded-full border border-owner-border px-4 py-1.5 text-[13px] font-bold disabled:opacity-60"
                    >
                      {t("odash.p3.waive")}
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => act(`d${d.id}`, () => api.phase3.dueDone(d.id))}
                  className="cursor-pointer whitespace-nowrap rounded-full bg-owner-ink px-4 py-1.5 text-[13px] font-bold text-white disabled:opacity-60"
                >
                  {t("odash.p3.doneReceived")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
