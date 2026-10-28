"use client";

import { use, useEffect, useRef, useState } from "react";
import { PaymentInstructionsCard } from "@/components/booking/payment-instructions-card";
import { useRequireAuth } from "@/lib/use-require-auth";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ErrorState } from "@/components/error-state";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR } from "@/lib/format";
import { useBookingFlowStore } from "@/lib/booking-flow-store";
import { supportWhatsAppUrl } from "@/lib/support";
import { useT } from "@/components/i18n/lang-provider";
import { useFmt } from "@/lib/use-fmt";
import { journeySteps, windowMs } from "@court-booking/ui-tokens";
import { ArrowLeft, Banner, Button, CountdownRing, IconButton, StatusPill, Timeline, X, useFlLang } from "@/components/fl";

function useCountdown(target: string | null | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!target) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [target]);
  if (!target) return null;
  return Math.max(0, Math.floor((new Date(target).getTime() - now) / 1000));
}

function PayPageInner({ params }: PageProps<"/booking/[id]/pay">) {
  const { id } = use(params);
  const t = useT();
  const fmt = useFmt();
  const lang = useFlLang();
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

  // Section 29 Part C: a real pre-purchase disclosure -- the player should know the venue's
  // cancellation policy before paying, not discover it later if they try to cancel and can't.
  const courtQuery = useQuery({
    queryKey: ["court", booking?.court_id],
    queryFn: () => api.courts.get(booking!.court_id),
    enabled: !!booking?.court_id,
  });
  const policyText = courtQuery.data ? fmt.cancellationPolicy(courtQuery.data) : "";

  useEffect(() => {
    if (booking?.status === "cancelled" && booking.cancelled_by === "owner" && !rejectionReason) {
      api.payments
        .listForBooking(id)
        .then((payments) => {
          const rejected = payments.find((p) => p.review_verdict === "rejected");
          setRejectionReason(rejected?.rejection_reason ?? booking.cancellation_reason ?? t("play.pay.rejectedDefault"));
        })
        .catch(() => setRejectionReason(booking.cancellation_reason ?? t("play.pay.rejectedDefault")));
    }
  }, [booking, id, rejectionReason, t]);

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
        alert(t("play.pay.mismatch"));
      } else if (result.payment.ocr_verdict === "unreadable") {
        alert(t("play.pay.unreadable"));
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
    return <main className="min-h-screen flex items-center justify-center text-fl-muted2">{t("play.loading")}</main>;
  }

  if (booking.status === "cancelled" && booking.cancelled_by === "owner") {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 bg-fl-ground px-6 py-10 font-fl-body text-fl-night">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-fl-danger-tint text-fl-danger" aria-hidden>
            <X size={26} strokeWidth={2.6} />
          </div>
          <h1 className="font-fl-display text-2xl font-extrabold">{t("play.pay.rejectedTitle")}</h1>
          <StatusPill booking={booking} />
          <p className="text-fl-muted">{t("play.pay.rejectedBody")}</p>
        </div>
        <div className="flex flex-col gap-2 rounded-fl-card border-[1.5px] border-fl-danger-border bg-fl-white p-5">
          <span className="text-[12px] font-extrabold tracking-widest text-fl-danger">{t("play.pay.venueSaid")}</span>
          <p className="font-semibold">&quot;{rejectionReason ?? "…"}&quot;</p>
        </div>
        <div className="rounded-fl-card bg-fl-white p-5">
          <Timeline steps={journeySteps({ ...booking, proofSent: true }, lang)} />
        </div>
        <p className="text-center text-sm text-fl-muted">{t("play.pay.slotOpenAgain")}</p>
        <Button label={t("play.pay.findAnother")} block onClick={() => router.push("/search")} />
      </main>
    );
  }

  if (booking.status === "cancelled" || expired) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-fl-ground px-8 text-center font-fl-body text-fl-night">
        <h1 className="font-fl-display text-xl font-extrabold">{expired ? t("play.pay.expiredTitle") : t("play.pay.cancelledTitle")}</h1>
        {!expired ? <StatusPill booking={booking} /> : null}
        <p className="text-fl-muted">{expired ? t("play.pay.expiredBody") : t("play.pay.cancelledBody")}</p>
        <Button label={t("play.tryAgain")} onClick={() => router.push("/search")} />
      </main>
    );
  }

  const isWaitingReview = booking.status === "payment_submitted";

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col bg-fl-ground font-fl-body text-fl-night">
      <div className="flex items-center gap-3 border-b border-fl-line bg-fl-white px-4 py-3 sm:px-6">
        <IconButton icon={ArrowLeft} aria-label={t("play.pay.back")} variant="mist" onClick={() => router.back()} />
        <h1 className="flex-1 text-[17px] font-extrabold">{isWaitingReview ? t("play.pay.titleWaiting") : t("play.pay.titleHold")}</h1>
        <a
          href={supportWhatsAppUrl(t("play.pay.helpMessage", { id }))}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center whitespace-nowrap text-[13px] font-extrabold text-fl-orange-deep hover:underline"
        >
          {t("play.pay.help")}
        </a>
      </div>

      <div className="flex flex-1 flex-col gap-5 p-4 sm:p-6">
        <section className="flex flex-col items-center gap-4 rounded-fl-card bg-fl-night p-6 text-center text-fl-white" data-testid="pay-hero">
          <StatusPill booking={booking} />
          {booking.status === "held" && booking.held_until ? (
            <CountdownRing expiresAt={booking.held_until} totalMs={windowMs(booking.created_at, booking.held_until)} caption={t("play.pay.ringCaption")} />
          ) : null}
          <div className="flex flex-col gap-1">
            <span className="text-[12px] font-extrabold tracking-widest text-fl-on-dark-muted">{isWaitingReview ? t("play.pay.sent") : t("play.pay.advanceDue")}</span>
            <span className="font-fl-display text-4xl font-extrabold tabular-nums">PKR {formatPKR(booking.advance_amount)}</span>
            {booking.balance_due > 0 ? <span className="text-[14px] text-fl-on-dark-muted">{t("play.pay.balance", { amount: `PKR ${formatPKR(booking.balance_due)}` })}</span> : null}
          </div>
        </section>

        <div className="rounded-fl-card bg-fl-white p-5" data-testid="pay-journey">
          <Timeline steps={journeySteps(booking, lang)} />
        </div>

        {isWaitingReview ? (
          <Banner tone="waiting" body={t("play.pay.reviewing")} />
        ) : (
          <>
            <PaymentInstructionsCard bookingId={id} fallback={paymentInstructions ?? null} />

            {previewUrl ? (
              <div className="flex flex-col items-center gap-2 rounded-fl-card bg-fl-white p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewUrl} alt={t("play.pay.previewAlt")} className="max-h-56 rounded-fl-sm object-contain" />
                <button
                  type="button"
                  onClick={() => {
                    setFile(null);
                    setPreviewUrl(null);
                  }}
                  className="inline-flex min-h-11 items-center px-2 text-[13px] font-extrabold text-fl-danger"
                >
                  {t("play.pay.remove")}
                </button>
              </div>
            ) : (
              <div
                role="button"
                tabIndex={0}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  pickFile(e.dataTransfer.files[0]);
                }}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                className={`flex cursor-pointer flex-col items-center gap-2 rounded-fl-card border-2 border-dashed p-10 text-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fl-night ${
                  dragOver ? "border-fl-orange bg-fl-orange-tint" : "border-fl-line-strong bg-fl-white"
                }`}
              >
                <span className="text-[15px] font-extrabold">{t("play.pay.attach")}</span>
                <span className="text-[13px] text-fl-muted">{t("play.pay.attachHint")}</span>
                <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} />
              </div>
            )}

            {policyText ? (
              <p className="px-2 text-center text-[13px] leading-[1.4] text-fl-muted" data-testid="pay-policy">
                {policyText}
              </p>
            ) : null}
          </>
        )}
      </div>

      {!isWaitingReview ? (
        <div className="flex flex-col gap-2.5 border-t border-fl-line bg-fl-white px-4 py-4 sm:px-6">
          {submitting ? (
            <div className="h-1.5 overflow-hidden rounded-full bg-fl-mist">
              <div className="h-full rounded-full bg-fl-orange transition-all" style={{ width: `${Math.max(6, Math.round(uploadProgress * 100))}%` }} />
            </div>
          ) : null}
          <Button
            block
            disabled={!file || submitting}
            loading={submitting}
            label={submitting ? t("play.pay.uploading", { pct: Math.round(uploadProgress * 100) }) : t("play.pay.submit")}
            onClick={submitProof}
          />
        </div>
      ) : null}
    </main>
  );
}

/** Booking screens need a session: a signed-out visitor is sent to log in and brought back here,
 * instead of the page silently signing them out on the first 401 with no explanation. */
export default function PayPage(props: PageProps<"/booking/[id]/pay">) {
  const { ready } = useRequireAuth();
  if (!ready) return null;
  return <PayPageInner {...props} />;
}
