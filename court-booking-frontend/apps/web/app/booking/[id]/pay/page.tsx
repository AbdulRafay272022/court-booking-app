"use client";

import { use, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ErrorState } from "@/components/error-state";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR } from "@/lib/format";
import { useBookingFlowStore } from "@/lib/booking-flow-store";
import { supportWhatsAppUrl } from "@/lib/support";

function useCountdown(target: string | null | undefined) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!target) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [target]);
  if (!target) return null;
  return Math.max(0, Math.floor((new Date(target).getTime() - now) / 1000));
}

export default function PayPage({ params }: PageProps<"/booking/[id]/pay">) {
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();
  const paymentInstructions = useBookingFlowStore((s) => s.paymentInstructionsByBookingId[id]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);

  const bookingQuery = useQuery({
    queryKey: ["booking", id],
    queryFn: () => api.bookings.get(id),
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === "held" || s === "payment_submitted" ? 4000 : false;
    },
  });
  const booking = bookingQuery.data;
  const secondsLeft = useCountdown(booking?.status === "held" ? booking.held_until : null);
  const expired = booking?.status === "held" && secondsLeft === 0;

  useEffect(() => {
    if (booking?.status === "cancelled" && booking.cancelled_by === "owner" && !rejectionReason) {
      api.payments
        .listForBooking(id)
        .then((payments) => {
          const rejected = payments.find((p) => p.review_verdict === "rejected");
          setRejectionReason(rejected?.rejection_reason ?? booking.cancellation_reason ?? "The venue couldn't confirm your payment.");
        })
        .catch(() => setRejectionReason(booking.cancellation_reason ?? "The venue couldn't confirm your payment."));
    }
  }, [booking, id, rejectionReason]);

  useEffect(() => {
    if (booking?.status === "booked") router.replace(`/booking/${id}/done`);
  }, [booking?.status, id, router]);

  function pickFile(f: File | undefined | null) {
    if (!f) return;
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
  }

  async function submitProof() {
    if (!file) return;
    setSubmitting(true);
    setUploadProgress(0);
    try {
      const result = await api.bookings.submitPaymentProof(id, file, file.name, file.type || "image/jpeg", setUploadProgress);
      queryClient.setQueryData(["booking", id], result.booking);
      if (result.booking.status !== "booked" && result.payment.ocr_verdict === "mismatch") {
        alert("We noticed a mismatch — the amount in your screenshot doesn't quite match. The venue will review this manually.");
      } else if (result.payment.ocr_verdict === "unreadable") {
        alert("We couldn't read the screenshot automatically — the venue will review it manually.");
      }
    } catch (e) {
      alert(friendlyErrorMessage(e));
    } finally {
      setSubmitting(false);
      setUploadProgress(0);
    }
  }

  if (bookingQuery.isError && !booking) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <ErrorState message={friendlyErrorMessage(bookingQuery.error)} onRetry={() => bookingQuery.refetch()} tone="player" />
      </main>
    );
  }

  if (bookingQuery.isLoading || !booking) {
    return <main className="min-h-screen flex items-center justify-center text-player-ink-faint">Loading…</main>;
  }

  if (booking.status === "cancelled" && booking.cancelled_by === "owner") {
    return (
      <main className="max-w-lg mx-auto min-h-screen flex flex-col px-6 py-10 gap-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="w-14 h-14 rounded-full bg-player-danger-soft flex items-center justify-center text-2xl">✕</div>
          <h1 className="text-2xl font-extrabold">Payment not confirmed</h1>
          <p className="text-player-ink-muted">The venue couldn't match your screenshot.</p>
        </div>
        <div className="border-[1.5px] border-player-danger-soft-border rounded-2xl p-5 flex flex-col gap-2">
          <span className="text-[11px] font-bold tracking-widest text-player-danger">WHAT THE VENUE SAID</span>
          <p className="font-semibold">&quot;{rejectionReason ?? "…"}&quot;</p>
        </div>
        <p className="text-center text-player-ink-muted text-sm">Your slot is open again — you're welcome to try booking it once more.</p>
        <button onClick={() => router.push("/search")} className="h-14 rounded-2xl bg-player-accent text-white font-bold">
          Find another slot
        </button>
      </main>
    );
  }

  if (booking.status === "cancelled" || expired) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4 px-8 text-center">
        <h1 className="text-xl font-extrabold">{expired ? "This hold expired" : "This booking was cancelled"}</h1>
        <p className="text-player-ink-muted">
          {expired ? "You didn't complete payment in time, so the slot was released." : "This slot is available for someone else now."}
        </p>
        <button onClick={() => router.push("/search")} className="px-6 h-12 rounded-2xl bg-player-accent text-white font-bold">
          Try again
        </button>
      </main>
    );
  }

  const isWaitingReview = booking.status === "payment_submitted";
  const minutes = secondsLeft != null ? Math.floor(secondsLeft / 60) : null;
  const seconds = secondsLeft != null ? secondsLeft % 60 : null;

  return (
    <main className="max-w-lg mx-auto min-h-screen flex flex-col">
      <div className="px-6 py-5 bg-player-surface border-b border-player-border-light flex items-center gap-3">
        <button onClick={() => router.back()} className="w-10 h-10 rounded-xl bg-player-surface-2 flex items-center justify-center">←</button>
        <h1 className="font-bold text-[17px] flex-1">{isWaitingReview ? "Waiting for the venue" : "Pay to hold your slot"}</h1>
        <a
          href={supportWhatsAppUrl(`I need help with a payment for booking ${id}`)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[13px] font-semibold text-player-accent whitespace-nowrap"
        >
          Need help?
        </a>
      </div>

      <div className="flex-1 p-6 flex flex-col gap-5">
        {booking.status === "held" && secondsLeft != null ? (
          <div
            className="text-center py-2.5 rounded-xl font-mono text-[13px] font-semibold"
            style={{ background: secondsLeft < 120 ? "#F8E5E0" : "#FDF6E9", color: secondsLeft < 120 ? "#8C3823" : "#8A5A0A" }}
          >
            Held · {minutes}:{String(seconds).padStart(2, "0")} left
          </div>
        ) : null}

        <div className="bg-player-ink text-white rounded-2xl p-6 flex flex-col gap-1.5">
          <span className="text-[11px] font-bold tracking-widest text-white/60">{isWaitingReview ? "SENT" : "ADVANCE DUE NOW"}</span>
          <span className="font-mono text-4xl font-semibold">{formatPKR(booking.advance_amount)}</span>
          <span className="text-[13.5px] text-white/65">Balance {formatPKR(booking.balance_due)} payable at the venue</span>
        </div>

        {isWaitingReview ? (
          <div className="bg-player-surface border border-player-border-light rounded-2xl p-5 text-player-ink-muted text-sm">
            The venue is reviewing your screenshot. This page will update automatically.
          </div>
        ) : (
          <>
            {paymentInstructions ? (
              <div className="bg-player-surface border border-player-border-light rounded-2xl p-5 flex flex-col gap-3">
                <span className="text-[11px] font-bold tracking-widest text-player-ink-fainter">SEND TO</span>
                {paymentInstructions.bank ? <Row label="Bank" value={paymentInstructions.bank} /> : null}
                {paymentInstructions.account_title ? <Row label="Account title" value={paymentInstructions.account_title} /> : null}
                {paymentInstructions.account_number ? <Row label="Account number" value={paymentInstructions.account_number} mono /> : null}
                {paymentInstructions.iban ? <Row label="IBAN" value={paymentInstructions.iban} mono /> : null}
              </div>
            ) : (
              <div className="bg-player-surface border border-player-border-light rounded-2xl p-5 text-player-ink-faint text-[13px]">
                Payment details were shown when this hold was created — check your chat with the venue if you need them again.
              </div>
            )}

            {previewUrl ? (
              <div className="bg-player-surface border border-player-border-light rounded-2xl p-3 flex flex-col items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewUrl} alt="Payment proof preview" className="max-h-56 rounded-xl object-contain" />
                <button onClick={() => { setFile(null); setPreviewUrl(null); }} className="text-player-danger text-[13px] font-semibold">
                  Remove and choose another
                </button>
              </div>
            ) : (
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); pickFile(e.dataTransfer.files[0]); }}
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed rounded-2xl p-10 flex flex-col items-center gap-2 cursor-pointer text-center"
                style={{ borderColor: dragOver ? "#EF5A2C" : "#E0D9D4", background: dragOver ? "#FFF3EE" : "transparent" }}
              >
                <span className="font-bold text-[15px]">Attach payment screenshot</span>
                <span className="text-[13px] text-player-ink-muted">Drag and drop, or click to browse. We read the amount automatically.</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => pickFile(e.target.files?.[0])}
                />
              </div>
            )}
          </>
        )}
      </div>

      {!isWaitingReview ? (
        <div className="px-6 py-5 bg-player-surface border-t border-player-border-light flex flex-col gap-2.5">
          {submitting ? (
            <div className="h-1.5 rounded-full bg-player-surface-2 overflow-hidden">
              <div
                className="h-full rounded-full bg-player-accent transition-all"
                style={{ width: `${Math.max(6, Math.round(uploadProgress * 100))}%` }}
              />
            </div>
          ) : null}
          <button
            onClick={submitProof}
            disabled={!file || submitting}
            className="w-full h-14 rounded-2xl bg-player-accent text-white font-bold disabled:opacity-50"
          >
            {submitting ? `Uploading… ${Math.round(uploadProgress * 100)}%` : "Submit payment proof"}
          </button>
        </div>
      ) : null}
    </main>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-player-ink-faint text-sm">{label}</span>
      <span className={`text-sm font-semibold ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}
