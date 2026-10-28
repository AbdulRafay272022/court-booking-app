"use client";

import { useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdminIdentityFull, AdminIdentityRow } from "@court-booking/types";
import { api } from "@/lib/api";
import { ErrorState } from "@/components/error-state";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useT } from "@/components/i18n/lang-provider";
import { useFmt } from "@/lib/use-fmt";
import { ModalShell } from "@/components/owner/modal-shell";
import { Lightbox } from "@/components/media/lightbox";
import { IdentityStatusChip } from "@/components/identity/identity-card";
import { formatCnic } from "@/components/identity/cnic";

type Filter = "missing" | "duplicates" | "unverified" | "all";
const FILTERS: Filter[] = ["unverified", "duplicates", "missing", "all"];
const DUPLICATE_FLAG = "duplicate_cnic";

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0C1F1D]";

/**
 * Admin: owners' CNICs (Stage 2). The list is masked only. "Poora dekhein" calls the full endpoint, which writes an
 * audit_log row (`owner_identity.viewed`) on EVERY call, so it is only fetched on that click and the page says so.
 */
export default function AdminIdentitiesPage() {
  const t = useT();
  const [filter, setFilter] = useState<Filter>("unverified");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<AdminIdentityRow | null>(null);
  const query = useQuery({
    queryKey: ["admin-identities", filter, page],
    queryFn: () => api.admin.ownerIdentities(filter, page),
  });
  const data = query.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / Math.max(1, data.page_size))) : 1;

  return (
    <div className="p-4 sm:p-8 max-w-5xl flex flex-col gap-6 min-w-0">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">{t("cnic.admin.title")}</h1>
        <p className="text-[13px] font-medium text-owner-ink-muted" data-testid="identities-logged-note">
          <span aria-hidden="true">! </span>
          {t("cnic.admin.loggedNote")}
        </p>
      </div>

      <div role="group" aria-label={t("cnic.admin.filterAria")} className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            data-testid={`identities-filter-${f}`}
            aria-pressed={filter === f}
            onClick={() => {
              setFilter(f);
              setPage(1);
            }}
            className={`min-h-11 whitespace-nowrap rounded-full border px-4 text-[13.5px] font-semibold ${focusRing} ${
              filter === f ? "border-owner-accent bg-owner-accent text-white" : "border-owner-border bg-owner-surface text-owner-ink-muted"
            }`}
          >
            {filter === f ? <span aria-hidden="true">{"\u2713 "}</span> : null}
            {t(`cnic.admin.filter.${f}` as "cnic.admin.filter.all")}
          </button>
        ))}
      </div>

      <div aria-live="polite" className="flex flex-col gap-3">
        {query.isError ? (
          <ErrorState message={friendlyErrorMessage(query.error, t)} onRetry={() => query.refetch()} tone="owner" />
        ) : !data ? (
          <p className="text-owner-ink-faint">{t("setup.set.loading")}</p>
        ) : data.items.length === 0 ? (
          <p className="text-owner-ink-faint" data-testid="identities-empty">
            {t("cnic.admin.empty")}
          </p>
        ) : (
          <>
            <p className="text-[13px] text-owner-ink-faint">{t("cnic.admin.total", { total: data.total })}</p>
            <ul className="flex flex-col gap-3" data-testid="identities-list">
              {data.items.map((row) => (
                <IdentityRow key={row.user_id} row={row} onOpen={() => setOpen(row)} />
              ))}
            </ul>
            {pages > 1 ? (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className={`min-h-11 rounded-lg border border-owner-border px-4 text-[13.5px] font-semibold disabled:opacity-50 ${focusRing}`}
                >
                  {t("cnic.admin.prev")}
                </button>
                <span className="text-[13px] text-owner-ink-muted">{t("cnic.admin.page", { page })}</span>
                <button
                  type="button"
                  disabled={page >= pages}
                  onClick={() => setPage((p) => p + 1)}
                  className={`min-h-11 rounded-lg border border-owner-border px-4 text-[13.5px] font-semibold disabled:opacity-50 ${focusRing}`}
                >
                  {t("cnic.admin.next")}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>

      {open ? <FullView row={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function DuplicateChip() {
  const t = useT();
  return (
    <span
      data-testid="identity-duplicate"
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-owner-danger-soft-border bg-owner-danger-soft px-2.5 py-0.5 text-[12px] font-semibold text-owner-danger"
    >
      <span aria-hidden="true">!</span>
      {t("cnic.admin.duplicate")}
    </span>
  );
}

function IdentityRow({ row, onOpen }: { row: AdminIdentityRow; onOpen: () => void }) {
  const t = useT();
  const fmt = useFmt();
  return (
    <li data-testid="identity-row" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-owner-border bg-owner-surface px-4 py-3 min-w-0">
      <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
        <span className="font-semibold text-owner-ink break-words">{row.owner_name ?? t("cnic.admin.noName")}</span>
        <span className="text-[12.5px] text-owner-ink-muted">
          {t("cnic.admin.phone")}: <span className="font-mono">{row.phone_last4 ?? "-"}</span>
        </span>
      </div>
      <div className="flex min-w-0 flex-1 basis-56 flex-col gap-1">
        <span className="font-mono text-[14px] text-owner-ink" data-testid="identity-masked">
          {row.masked ?? "-"}
        </span>
        {row.submitted_at ? (
          <span className="text-[12px] text-owner-ink-faint">
            {t("cnic.admin.submittedAt")}: {fmt.when(row.submitted_at)}
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <IdentityStatusChip status={row.status} />
        {row.flags.includes(DUPLICATE_FLAG) ? <DuplicateChip /> : null}
      </div>
      {row.status !== "missing" ? (
        <button
          type="button"
          data-testid="identity-view-full"
          onClick={onOpen}
          className={`min-h-11 whitespace-nowrap rounded-lg border border-owner-border px-4 text-[13.5px] font-semibold text-owner-accent ${focusRing}`}
        >
          {t("cnic.admin.viewFull")}
        </button>
      ) : null}
    </li>
  );
}

function FullView({ row, onClose }: { row: AdminIdentityRow; onClose: () => void }) {
  const t = useT();
  const titleId = useId();
  const queryClient = useQueryClient();
  // Each fetch writes an audit row: no retries, no refetch on focus, never cached between openings.
  const full = useQuery({
    queryKey: ["admin-identity-full", row.user_id],
    queryFn: () => api.admin.ownerIdentity(row.user_id),
    retry: false,
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const [photo, setPhoto] = useState<"front" | "back" | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [verified, setVerified] = useState<AdminIdentityFull | null>(null);
  // audit 2026-10-28 Phase 2 item 1: "Not approve" with a required reason
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const data = verified ?? full.data;

  async function verify() {
    setVerifying(true);
    setMessage(null);
    try {
      const res = await api.admin.verifyOwnerIdentity(row.user_id);
      setVerified(res);
      setMessage({ kind: "ok", text: t("cnic.admin.verified") });
      await queryClient.invalidateQueries({ queryKey: ["admin-identities"] });
    } catch (e) {
      setMessage({ kind: "error", text: friendlyErrorMessage(e, t) });
    } finally {
      setVerifying(false);
    }
  }

  async function reject() {
    if (reason.trim().length < 3) return;
    setVerifying(true);
    setMessage(null);
    try {
      const res = await api.admin.rejectOwnerIdentity(row.user_id, reason.trim());
      setVerified(res);
      setRejecting(false);
      setReason("");
      setMessage({ kind: "ok", text: t("cnic.admin.rejected") });
      await queryClient.invalidateQueries({ queryKey: ["admin-identities"] });
    } catch (e) {
      setMessage({ kind: "error", text: friendlyErrorMessage(e, t) });
    } finally {
      setVerifying(false);
    }
  }

  const sideLabel = (s: "front" | "back") => t(s === "front" ? "cnic.admin.front" : "cnic.admin.back");

  return (
    <>
      <ModalShell labelledBy={titleId} onClose={onClose} maxWidthClass="md:max-w-[720px]">
        <div className="flex flex-col gap-4 p-5 sm:p-6" data-testid="identity-full">
          <h2 id={titleId} className="text-lg font-bold break-words">
            {t("cnic.admin.fullTitle", { name: row.owner_name ?? t("cnic.admin.noName") })}
          </h2>
          <p className="rounded-lg border border-owner-warn-soft-border bg-owner-warn-soft px-3 py-2 text-[12.5px] font-semibold text-owner-warn-dark" data-testid="identity-full-logged">
            <span aria-hidden="true">! </span>
            {t("cnic.admin.loggedNote")}
          </p>
          <div aria-live="polite">
            {full.isError ? (
              <ErrorState message={friendlyErrorMessage(full.error, t)} onRetry={() => full.refetch()} tone="owner" />
            ) : !data ? (
              <p className="text-owner-ink-faint">{t("setup.set.loading")}</p>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-[13px] font-semibold text-owner-ink-muted">{t("cnic.admin.number")}</span>
                  <span className="font-mono text-[18px] font-semibold text-owner-ink" data-testid="identity-full-number">
                    {formatCnic(data.number)}
                  </span>
                  <IdentityStatusChip status={data.status} />
                  {data.flags.includes(DUPLICATE_FLAG) ? <DuplicateChip /> : null}
                </div>
                {data.flags.includes("not_cnic_like") ? (
                  <p className="rounded-lg border border-owner-danger/30 bg-owner-danger/5 px-3 py-2 text-[13px] font-semibold text-owner-danger" data-testid="identity-not-card">
                    <span aria-hidden="true">! </span>
                    {t("cnic.admin.notCardLike")}
                  </p>
                ) : null}
                {data.status === "rejected" && data.rejection_reason ? (
                  <p className="text-[13px] text-owner-ink-muted" data-testid="identity-rejection">
                    {t("cnic.rejectedReason", { reason: data.rejection_reason })}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-3">
                  {(["front", "back"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      data-testid={`identity-photo-${s}`}
                      aria-label={t("cnic.admin.openPhoto", { side: sideLabel(s) })}
                      onClick={() => setPhoto(s)}
                      className={`flex min-w-0 flex-1 basis-56 flex-col gap-1 rounded-xl border border-owner-border bg-owner-bg p-2 text-left ${focusRing}`}
                    >
                      <span className="text-[12.5px] font-semibold text-owner-ink-muted">{sideLabel(s)}</span>
                      {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
                      <img src={s === "front" ? data.front_url : data.back_url} alt="" className="aspect-[1.6] w-full rounded-lg object-contain" />
                    </button>
                  ))}
                </div>
                {data.status !== "verified" ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      data-testid="identity-verify"
                      disabled={verifying}
                      onClick={verify}
                      className={`min-h-11 rounded-lg bg-owner-accent px-5 text-[14px] font-semibold text-white disabled:opacity-60 ${focusRing}`}
                    >
                      {t("cnic.admin.verify")}
                    </button>
                    {data.status !== "rejected" ? (
                      <button
                        type="button"
                        data-testid="identity-reject"
                        disabled={verifying}
                        onClick={() => setRejecting((v) => !v)}
                        className={`min-h-11 rounded-lg border border-owner-danger/40 px-5 text-[14px] font-semibold text-owner-danger disabled:opacity-60 ${focusRing}`}
                      >
                        {t("cnic.admin.reject")}
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {rejecting ? (
                  <div className="flex flex-col gap-2" data-testid="identity-reject-form">
                    <label className="text-[13px] font-semibold text-owner-ink" htmlFor={`${titleId}-reason`}>
                      {t("cnic.admin.rejectReason")}
                    </label>
                    <textarea
                      id={`${titleId}-reason`}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      rows={3}
                      maxLength={500}
                      className={`rounded-lg border px-3 py-2 text-[14px] ${reason.trim().length < 3 ? "border-owner-danger" : "border-owner-border"}`}
                    />
                    <button
                      type="button"
                      data-testid="identity-reject-confirm"
                      disabled={verifying || reason.trim().length < 3}
                      onClick={reject}
                      className={`min-h-11 self-start rounded-lg bg-owner-danger px-5 text-[14px] font-semibold text-white disabled:opacity-60 ${focusRing}`}
                    >
                      {t("cnic.admin.rejectConfirm")}
                    </button>
                  </div>
                ) : null}
                {message ? (
                  <p className={`text-[13.5px] font-semibold ${message.kind === "ok" ? "text-owner-accent" : "text-owner-danger"}`} data-testid="identity-verify-message">
                    <span aria-hidden="true">{message.kind === "ok" ? "\u2713 " : "! "}</span>
                    {message.text}
                  </p>
                ) : null}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`min-h-11 self-end rounded-lg border border-owner-border px-5 text-[14px] font-semibold ${focusRing}`}
          >
            {t("cnic.admin.close")}
          </button>
        </div>
      </ModalShell>
      {photo && data ? (
        <Lightbox
          src={photo === "front" ? data.front_url : data.back_url}
          alt={sideLabel(photo)}
          onClose={() => setPhoto(null)}
        />
      ) : null}
    </>
  );
}
