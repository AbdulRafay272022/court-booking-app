"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdminOwnerInvoice, AdminOwnerPayment, RecordablePaymentMethod } from "@court-booking/types";
import { api } from "@/lib/api";
import { ErrorState } from "@/components/error-state";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatDateString, formatPKR, formatRelativeTime } from "@/lib/format";

const KEYS = ["admin-owner-payments-submitted", "admin-owner-invoices-issued", "admin-owner-payments-approved"] as const;

export default function PremiumPaymentsPage() {
  const qc = useQueryClient();
  const refresh = () => Promise.all(KEYS.map((k) => qc.invalidateQueries({ queryKey: [k] })));

  const submitted = useQuery({ queryKey: [KEYS[0]], queryFn: () => api.admin.ownerPayments("submitted"), refetchInterval: 30_000 });
  const waiting = useQuery({ queryKey: [KEYS[1]], queryFn: () => api.admin.ownerInvoices("issued") });
  const approved = useQuery({ queryKey: [KEYS[2]], queryFn: () => api.admin.ownerPayments("approved") });

  return (
    <div className="p-4 sm:p-8 max-w-4xl flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold">Premium payments</h1>
        <p className="text-owner-ink-faint text-sm mt-1">
          Screenshots owners have sent for their premium invoices, invoices still waiting to be paid, and recent payments you can
          correct. Approving a payment pays the invoice and moves each feature&apos;s paid-through date forward.
        </p>
      </div>

      <Section title={`Screenshots to check (${submitted.data?.length ?? 0})`}>
        <Loaded q={submitted} empty="Nothing is waiting for you.">
          {(rows) => rows.map((p) => <ReviewCard key={p.id} payment={p} onDone={refresh} />)}
        </Loaded>
      </Section>

      <Section title={`Waiting for payment (${waiting.data?.length ?? 0})`}>
        <Loaded q={waiting} empty="No unpaid invoices.">
          {(rows) => rows.map((inv) => <UnpaidRow key={inv.id} invoice={inv} onDone={refresh} />)}
        </Loaded>
      </Section>

      <Section title="Recently approved">
        <Loaded q={approved} empty="No approved payments yet.">
          {(rows) => rows.map((p) => <ApprovedRow key={p.id} payment={p} onDone={refresh} />)}
        </Loaded>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-bold">{title}</h2>
      {children}
    </section>
  );
}

function Loaded<T>({
  q,
  empty,
  children,
}: {
  q: { data?: T[]; isLoading: boolean; isError: boolean; error: unknown; refetch: () => void };
  empty: string;
  children: (rows: T[]) => React.ReactNode;
}) {
  if (q.isLoading) return <p className="text-owner-ink-faint text-sm">Loading…</p>;
  if (q.isError) return <ErrorState message={friendlyErrorMessage(q.error)} onRetry={() => q.refetch()} tone="owner" />;
  if (!q.data || q.data.length === 0) return <p className="text-owner-ink-faint text-sm">{empty}</p>;
  return <div className="flex flex-col gap-3">{children(q.data)}</div>;
}

function who(name: string | null, phone: string) {
  return `${name ?? "No name"} · ${phone}`;
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="bg-owner-surface border border-owner-border rounded-xl px-5 py-4 flex flex-col gap-2">{children}</div>;
}

function Lines({ lines }: { lines: AdminOwnerPayment["lines"] }) {
  return (
    <ul className="text-xs text-owner-ink-faint list-disc pl-5">
      {lines.map((l) => (
        <li key={l.feature_key + l.period_start}>
          {l.description ?? l.feature_key}: PKR {formatPKR(l.amount_pkr)}
        </li>
      ))}
    </ul>
  );
}

function ReviewCard({ payment, onDone }: { payment: AdminOwnerPayment; onDone: () => Promise<unknown> }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const approve = useMutation({ mutationFn: () => api.admin.approveOwnerPayment(payment.id), onSuccess: onDone });
  const reject = useMutation({ mutationFn: () => api.admin.rejectOwnerPayment(payment.id, reason.trim()), onSuccess: onDone });
  const busy = approve.isPending || reject.isPending;
  const error = approve.error ?? reject.error;

  return (
    <Card>
      <div className="flex flex-wrap justify-between gap-2">
        <p className="font-semibold text-sm">{who(payment.owner_name, payment.owner_phone)}</p>
        <p className="font-mono font-bold">PKR {formatPKR(payment.amount_pkr)}</p>
      </div>
      <p className="text-xs text-owner-ink-faint">
        {formatDateString(payment.invoice_period_start)} to {formatDateString(payment.invoice_period_end)} · sent {formatRelativeTime(payment.created_at)}
      </p>
      <Lines lines={payment.lines} />
      {payment.note ? <p className="text-xs font-semibold">{payment.note}</p> : null}
      {payment.proof_url ? (
        <a href={payment.proof_url} target="_blank" rel="noreferrer" className="text-sm font-semibold underline w-fit" style={{ color: "#0E6274" }}>
          Open the screenshot
        </a>
      ) : null}
      {rejecting ? (
        <div className="flex flex-wrap gap-2 items-center">
          <input
            data-testid={`reject-reason-${payment.id}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why? The owner will see this"
            className="flex-1 min-w-[200px] h-10 px-3 rounded-lg border border-owner-border text-sm"
          />
          <button
            data-testid={`confirm-reject-${payment.id}`}
            disabled={!reason.trim() || busy}
            onClick={() => reject.mutate()}
            className="h-10 px-4 rounded-lg text-sm font-semibold text-white disabled:opacity-40"
            style={{ background: "#B3261E" }}
          >
            Reject
          </button>
          <button onClick={() => setRejecting(false)} className="h-10 px-3 text-sm font-semibold">
            Back
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            data-testid={`approve-${payment.id}`}
            disabled={busy}
            onClick={() => approve.mutate()}
            className="h-10 px-4 rounded-lg text-sm font-semibold text-white disabled:opacity-40"
            style={{ background: "#1F7A52" }}
          >
            {approve.isPending ? "Approving…" : "Approve"}
          </button>
          <button
            data-testid={`start-reject-${payment.id}`}
            disabled={busy}
            onClick={() => setRejecting(true)}
            className="h-10 px-4 rounded-lg text-sm font-semibold border border-owner-border"
          >
            Reject
          </button>
        </div>
      )}
      {error ? (
        <p role="alert" className="text-xs font-semibold text-owner-danger">
          {friendlyErrorMessage(error)}
        </p>
      ) : null}
    </Card>
  );
}

function UnpaidRow({ invoice, onDone }: { invoice: AdminOwnerInvoice; onDone: () => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<RecordablePaymentMethod>("bank_transfer");
  const [note, setNote] = useState("");
  const record = useMutation({
    mutationFn: () => api.admin.recordOwnerPayment(invoice.id, method, note.trim()),
    onSuccess: async () => {
      setOpen(false);
      await onDone();
    },
  });
  return (
    <Card>
      <div className="flex flex-wrap justify-between gap-2">
        <p className="font-semibold text-sm">{who(invoice.owner_name, invoice.owner_phone)}</p>
        <p className="font-mono font-bold">PKR {formatPKR(invoice.total_pkr)}</p>
      </div>
      <p className="text-xs text-owner-ink-faint">
        {formatDateString(invoice.period_start)} to {formatDateString(invoice.period_end)} · due {formatDateString(invoice.due_date)}
      </p>
      <Lines lines={invoice.lines} />
      {open ? (
        <div className="flex flex-wrap gap-2 items-center">
          <select
            data-testid={`method-${invoice.id}`}
            value={method}
            onChange={(e) => setMethod(e.target.value as RecordablePaymentMethod)}
            className="h-10 px-2 rounded-lg border border-owner-border text-sm"
          >
            <option value="bank_transfer">Bank transfer</option>
            <option value="cash">Cash</option>
            <option value="other">Other</option>
          </select>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional)"
            className="flex-1 min-w-[160px] h-10 px-3 rounded-lg border border-owner-border text-sm"
          />
          <button
            data-testid={`confirm-record-${invoice.id}`}
            disabled={record.isPending}
            onClick={() => record.mutate()}
            className="h-10 px-4 rounded-lg text-sm font-semibold text-white disabled:opacity-40"
            style={{ background: "#0E6274" }}
          >
            Record as paid
          </button>
        </div>
      ) : (
        <button
          data-testid={`record-${invoice.id}`}
          onClick={() => setOpen(true)}
          className="h-10 px-4 rounded-lg text-sm font-semibold border border-owner-border w-fit"
        >
          Payment received outside the app
        </button>
      )}
      {record.isError ? (
        <p role="alert" className="text-xs font-semibold text-owner-danger">
          {friendlyErrorMessage(record.error)}
        </p>
      ) : null}
    </Card>
  );
}

function ApprovedRow({ payment, onDone }: { payment: AdminOwnerPayment; onDone: () => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const reverse = useMutation({
    mutationFn: () => api.admin.reverseOwnerPayment(payment.id, reason.trim()),
    onSuccess: async () => {
      setOpen(false);
      await onDone();
    },
  });
  return (
    <Card>
      <div className="flex flex-wrap justify-between gap-2">
        <p className="font-semibold text-sm">{who(payment.owner_name, payment.owner_phone)}</p>
        <p className="font-mono font-bold">PKR {formatPKR(payment.amount_pkr)}</p>
      </div>
      <p className="text-xs text-owner-ink-faint">
        {formatDateString(payment.invoice_period_start)} to {formatDateString(payment.invoice_period_end)} · {payment.method.replaceAll("_", " ")}
        {payment.reviewed_at ? ` · ${formatRelativeTime(payment.reviewed_at)}` : ""}
      </p>
      {payment.reversed ? (
        <p className="text-xs font-semibold text-owner-danger">Reversed</p>
      ) : open ? (
        <div className="flex flex-wrap gap-2 items-center">
          <input
            data-testid={`reverse-reason-${payment.id}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this being reversed?"
            className="flex-1 min-w-[200px] h-10 px-3 rounded-lg border border-owner-border text-sm"
          />
          <button
            data-testid={`confirm-reverse-${payment.id}`}
            disabled={!reason.trim() || reverse.isPending}
            onClick={() => reverse.mutate()}
            className="h-10 px-4 rounded-lg text-sm font-semibold text-white disabled:opacity-40"
            style={{ background: "#B3261E" }}
          >
            Reverse payment
          </button>
        </div>
      ) : (
        <button
          data-testid={`reverse-${payment.id}`}
          onClick={() => setOpen(true)}
          className="h-9 px-3 rounded-lg text-xs font-semibold border border-owner-border w-fit"
        >
          Reverse
        </button>
      )}
      {reverse.isError ? (
        <p role="alert" className="text-xs font-semibold text-owner-danger">
          {friendlyErrorMessage(reverse.error)}
        </p>
      ) : null}
    </Card>
  );
}
