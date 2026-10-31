"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { IdentityStatus, OwnerIdentity } from "@court-booking/types";
import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { ErrorState } from "@/components/error-state";
import { useT } from "@/components/i18n/lang-provider";
import { PrimaryButton, SectionCard, SectionLabel } from "@/components/setup/ui";
import { CnicFields, identityDraftReady } from "./cnic-fields";
import { identityErrorMessage } from "./identity-errors";
import type { IdentityDraft } from "./identity-draft-store";

export const IDENTITY_QUERY_KEY = ["owner-identity"] as const;

/** GET /owners/identity (never the number, only the masked form). */
export function useOwnerIdentity(enabled = true) {
  return useQuery({ queryKey: IDENTITY_QUERY_KEY, queryFn: () => api.owners.identity(), enabled, retry: false, staleTime: 60_000 });
}

const EMPTY: IdentityDraft = { number: "", front: null, back: null };

/** Status chip: icon + text, never colour alone. */
export function IdentityStatusChip({ status }: { status: IdentityStatus }) {
  const t = useT();
  const look =
    status === "verified"
      ? { icon: "\u2713", cls: "bg-owner-success-soft text-owner-success-dark border-owner-success-soft" }
      : status === "rejected"
        ? { icon: "\u2715", cls: "bg-owner-danger/10 text-owner-danger border-owner-danger/30" }
      : status === "submitted"
        ? { icon: "\u23F3", cls: "bg-owner-bg text-owner-ink-muted border-owner-border" }
        : { icon: "!", cls: "bg-owner-warn-soft text-owner-warn-dark border-owner-warn-soft-border" };
  return (
    <span data-testid="cnic-status" data-status={status} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[12px] font-semibold ${look.cls}`}>
      <span aria-hidden="true">{look.icon}</span>
      {t(`cnic.status.${status}` as "cnic.status.missing")}
    </span>
  );
}

/** Venue Settings: CNIC status, the masked number and a replace flow (POST /owners/identity, replace allowed). */
export function IdentityCard() {
  const t = useT();
  const query = useOwnerIdentity();
  return (
    <SectionCard>
      <div data-testid="identity-card" className="flex flex-col gap-4">
        <SectionLabel>{t("cnic.title")}</SectionLabel>
        {query.isError ? (
          <ErrorState message={friendlyErrorMessage(query.error, t)} onRetry={() => query.refetch()} tone="owner" />
        ) : query.data ? (
          <IdentityBody identity={query.data} />
        ) : (
          <p className="text-owner-ink-faint">{t("setup.set.loading")}</p>
        )}
      </div>
    </SectionCard>
  );
}

function IdentityBody({ identity }: { identity: OwnerIdentity }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(identity.status === "missing" || identity.status === "rejected");
  const [draft, setDraft] = useState<IdentityDraft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  // Arriving from the "CNIC dein" banner (/dashboard/owner/settings#cnic): the card loads after the page, so scroll once it is here.
  useEffect(() => {
    if (window.location.hash === "#cnic") document.getElementById("cnic")?.scrollIntoView({ block: "start" });
  }, []);

  async function submit() {
    if (!draft.front || !draft.back) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await api.owners.submitIdentity(draft.number, draft.front, draft.back);
      queryClient.setQueryData(IDENTITY_QUERY_KEY, res);
      setDraft(EMPTY);
      setEditing(false);
      setMessage({ kind: "ok", text: t("cnic.saved") });
    } catch (e) {
      setMessage({ kind: "error", text: identityErrorMessage(e, t) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <IdentityStatusChip status={identity.status} />
        {identity.masked ? (
          <span data-testid="cnic-masked" className="font-mono text-[14px] font-medium text-owner-ink">
            {identity.masked}
          </span>
        ) : null}
      </div>
      <p className="text-[13px] text-owner-ink-muted">{t(`cnic.help.${identity.status}` as "cnic.help.missing")}</p>
      {identity.status === "rejected" && identity.rejection_reason ? (
        // audit 2026-10-28 Phase 2 item 1: why the admin did not approve it
        <p className="rounded-lg border border-owner-danger/30 bg-owner-danger/5 px-3 py-2 text-[13px] font-semibold text-owner-danger" data-testid="cnic-rejection">
          {t("cnic.rejectedReason", { reason: identity.rejection_reason })}
        </p>
      ) : null}
      {editing ? (
        <>
          <CnicFields value={draft} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} />
          <div className="flex flex-col gap-2 sm:flex-row">
            <PrimaryButton label={identity.status === "missing" ? t("cnic.submit") : t("cnic.replaceSubmit")} onClick={submit} busy={saving} ready={identityDraftReady(draft)} />
            {identity.status !== "missing" ? (
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setDraft(EMPTY);
                }}
                className="min-h-12 w-full rounded-[10px] border border-owner-border px-5 text-[14.5px] font-semibold text-owner-ink sm:w-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0C1F1D]"
              >
                {t("cnic.cancelReplace")}
              </button>
            ) : null}
          </div>
        </>
      ) : (
        <button
          type="button"
          data-testid="cnic-replace"
          onClick={() => {
            setMessage(null);
            setEditing(true);
          }}
          className="self-start min-h-11 rounded-lg border border-owner-border px-4 text-[13.5px] font-semibold text-owner-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0C1F1D]"
        >
          {t("cnic.replace")}
        </button>
      )}
      <div aria-live="polite">
        {message ? (
          <p data-testid="cnic-message" className={`text-[13.5px] font-semibold ${message.kind === "ok" ? "text-owner-accent" : "text-owner-danger"}`}>
            <span aria-hidden="true">{message.kind === "ok" ? "\u2713 " : "! "}</span>
            {message.text}
          </p>
        ) : null}
      </div>
    </>
  );
}
