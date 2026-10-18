"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError } from "@court-booking/api-client";
import { api } from "@/lib/api";
import { useT } from "@/components/i18n/lang-provider";
import { Lightbox } from "./lightbox";

export interface ScreenshotThumbProps {
  paymentId: string;
  alt: string;
  /** Optional signed URL the caller already has (e.g. the approvals queue's `proof_url`); saves one request per card. */
  initialSrc?: string | null;
}

/**
 * Inline payment-screenshot thumbnail (Round 2, A3): at most 160px high, whole image visible, rounded, caption
 * "Bara karke dekhein". It is a real button (keyboard + 44px target) that opens the shared Lightbox.
 * The signed URL comes from `api.payments.proofUrl`; when the image fails (the URL expired) it is fetched again once.
 */
export function ScreenshotThumb({ paymentId, alt, initialSrc }: ScreenshotThumbProps) {
  const t = useT();
  const [useFetched, setUseFetched] = useState(!initialSrc);
  const [thumbRetried, setThumbRetried] = useState(false);
  const [thumbFailed, setThumbFailed] = useState(false);
  const [open, setOpen] = useState(false);

  const query = useQuery({
    queryKey: ["payment-proof-url", paymentId],
    queryFn: () => api.payments.proofUrl(paymentId),
    enabled: useFetched,
    // The URL lives 300 s on the server; refetch before it runs out.
    staleTime: 240_000,
    gcTime: 300_000,
    retry: false,
  });

  const src = useFetched ? (query.data?.url ?? null) : (initialSrc ?? null);
  const missing = useFetched && query.error instanceof ApiError && query.error.status === 404;
  const loadFailed = useFetched && query.isError && !missing;

  /** A fresh signed URL (used by the thumbnail once, and by the lightbox when its image expires). */
  function refresh() {
    if (!useFetched) setUseFetched(true);
    else void query.refetch();
  }

  function onThumbError() {
    if (!thumbRetried) {
      setThumbRetried(true);
      refresh();
    } else {
      setThumbFailed(true);
    }
  }

  function retry() {
    setThumbFailed(false);
    setThumbRetried(false);
    refresh();
  }

  if (missing) {
    return (
      <div data-testid="shot-thumb" className="inline-flex min-h-11 items-center rounded-xl border border-dashed border-owner-border bg-owner-bg px-4 text-[13.5px] text-owner-ink-muted">
        {t("media.thumb.none")}
      </div>
    );
  }

  if (thumbFailed || loadFailed) {
    return (
      <div data-testid="shot-thumb" className="flex flex-wrap items-center gap-3 rounded-xl border border-owner-border bg-owner-bg px-4 py-2">
        <span role="alert" className="text-[13.5px] font-semibold text-owner-danger">
          {t("media.thumb.error")}
        </span>
        <button
          type="button"
          onClick={retry}
          className="min-h-11 rounded-xl border border-owner-border bg-owner-surface px-4 text-[13.5px] font-bold text-owner-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-owner-accent"
        >
          {t("media.thumb.retry")}
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        data-testid="shot-thumb"
        disabled={!src}
        onClick={() => setOpen(true)}
        aria-label={t("media.thumb.openAria", { alt })}
        className="group inline-flex max-w-full cursor-zoom-in flex-col items-start gap-1.5 rounded-xl p-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-owner-accent disabled:cursor-default"
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL, not an optimisable static asset
          <img
            key={src}
            src={src}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={onThumbError}
            className="block h-auto max-h-40 w-auto max-w-full rounded-lg border border-owner-border bg-white object-contain"
            style={{ minWidth: 64, minHeight: 64 }}
          />
        ) : (
          <span role="status" className="block h-40 w-28 animate-pulse rounded-lg bg-owner-border-light">
            <span className="sr-only">{t("media.thumb.loading")}</span>
          </span>
        )}
        <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-owner-accent underline-offset-2 group-hover:underline">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" />
            <path d="M16 16l4.5 4.5M11 8.5v5M8.5 11h5" />
          </svg>
          {t("media.thumb.caption")}
        </span>
      </button>
      {open ? <Lightbox src={src ?? ""} alt={alt} onClose={() => setOpen(false)} onExpired={refresh} /> : null}
    </>
  );
}
