"use client";

import { QRCodeSVG } from "qrcode.react";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { useT } from "@/components/i18n/lang-provider";

/** Section 32 Part 9. Encodes the venue's own `checkin_qr_token` -- a player scans it with their
 * own phone camera and the app calls POST /bookings/{id}/checkin/self. Print-friendly: the header,
 * nav and instructions hide under @media print, leaving just the venue name and the code. */
export default function OwnerCheckinQrPage() {
  const t = useT();
  const { activeVenue, isLoading } = useOwnerVenues();
  const token = activeVenue?.checkin_qr_token;

  return (
    <div className="p-8 flex flex-col items-center gap-6 max-w-xl mx-auto">
      <div className="w-full flex items-center justify-between print:hidden">
        <h1 className="text-2xl font-bold">{t("odash.checkin.qr.pageTitle")}</h1>
        <button
          onClick={() => window.print()}
          disabled={!token}
          className="px-4 py-2.5 rounded-lg border border-owner-border font-semibold text-sm disabled:opacity-50"
        >
          {t("odash.checkin.qr.print")}
        </button>
      </div>

      {isLoading ? null : !token ? (
        <p className="text-owner-ink-faint">{t("odash.checkin.qr.choose")}</p>
      ) : (
        <div className="flex flex-col items-center gap-6 py-6">
          <div className="p-6 bg-white rounded-2xl border border-owner-border">
            <QRCodeSVG value={token} size={260} />
          </div>
          <div className="text-center gap-1.5 flex flex-col">
            <p className="font-bold text-[19px]">{activeVenue?.name}</p>
            <p className="text-owner-ink-faint text-[13px] max-w-sm print:hidden">
              {t("odash.checkin.qr.help")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
