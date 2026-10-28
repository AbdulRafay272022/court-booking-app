"use client";

import Link from "next/link";
import { useState } from "react";
import { useAuthStore } from "@/lib/auth-store";
import { useT } from "@/components/i18n/lang-provider";
import { useOwnerIdentity } from "./identity-card";

const DISMISS_KEY = "khelo.cnic-banner-dismissed";

function dismissedThisSession(): boolean {
  try {
    return typeof window !== "undefined" && window.sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Soft "CNIC dein" banner at the top of the owner dashboard for an OWNER (not staff) whose CNIC is missing. Never locks
 * anything; "Baad mein" hides it for this browser session only. Renders nothing while loading, on error, or once a CNIC
 * has been submitted.
 */
export function CnicBanner() {
  const t = useT();
  const role = useAuthStore((s) => s.user?.role);
  const isOwner = role === "owner";
  const query = useOwnerIdentity(isOwner);
  const [dismissed, setDismissed] = useState(dismissedThisSession);
  const rejected = query.data?.status === "rejected";
  // audit 2026-10-28 Phase 2 item 1: a NOT approved CNIC shows the banner too, with the admin's reason (never dismissed for good)
  if (!isOwner || (dismissed && !rejected) || (query.data?.status !== "missing" && !rejected)) return null;
  return (
    <div className="px-4 sm:px-8 pt-4 sm:pt-6">
      <div
        role="region"
        aria-label={t("cnic.banner.aria")}
        data-testid="cnic-banner"
        className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-owner-warn-soft-border bg-owner-warn-soft px-4 py-3"
      >
        <p className="flex-1 basis-60 text-[13.5px] font-semibold text-owner-warn-dark">
          <span aria-hidden="true">! </span>
          {rejected ? t("cnic.banner.rejected", { reason: query.data?.rejection_reason ?? "" }) : t("cnic.banner.text")}
        </p>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/dashboard/owner/settings#cnic"
            data-testid="cnic-banner-go"
            className="inline-flex min-h-11 items-center whitespace-nowrap rounded-lg bg-owner-accent px-4 text-[13.5px] font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0C1F1D]"
          >
            {t("cnic.banner.go")}
          </Link>
          <button
            type="button"
            data-testid="cnic-banner-dismiss"
            onClick={() => {
              try {
                window.sessionStorage.setItem(DISMISS_KEY, "1");
              } catch {
                // private mode: hide for this page view only
              }
              setDismissed(true);
            }}
            className="inline-flex min-h-11 items-center whitespace-nowrap rounded-lg border border-owner-warn-soft-border px-4 text-[13.5px] font-semibold text-owner-warn-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0C1F1D]"
          >
            {t("cnic.banner.later")}
          </button>
        </div>
      </div>
    </div>
  );
}
