"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { selfCheckinWindow } from "@court-booking/types";
import { useRequireAuth } from "@/lib/use-require-auth";
import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useT } from "@/components/i18n/lang-provider";
import { useFmt } from "@/lib/use-fmt";

/** Section 32 Part 9: show this booking's own QR (its plain booking id) for the OWNER to scan, and
 * a manual venue-code field as the web equivalent of "scan the venue's QR" (no camera on web -- see
 * the owner check-in hub for the same scope decision), gated to the same ~15-minute window as
 * mobile via packages/types' selfCheckinWindow. */
function CheckinPageInner({ params }: PageProps<"/booking/[id]/checkin">) {
  const { id } = use(params);
  const t = useT();
  const fmt = useFmt();
  const router = useRouter();
  const queryClient = useQueryClient();
  const bookingQuery = useQuery({ queryKey: ["booking", id], queryFn: () => api.bookings.get(id) });
  const [manualToken, setManualToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const booking = bookingQuery.data;

  if (!booking) {
    return (
      <main className="min-h-screen flex items-center justify-center text-fl-muted2">
        {bookingQuery.isError ? friendlyErrorMessage(bookingQuery.error) : t("play.loading")}
      </main>
    );
  }

  async function submitSelfCheckin() {
    if (!manualToken.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.bookings.checkinSelf(id, manualToken.trim());
      queryClient.invalidateQueries({ queryKey: ["booking", id] });
      queryClient.invalidateQueries({ queryKey: ["bookings-mine"] });
    } catch (e) {
      setError(friendlyErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  }

  if (booking.checked_in_at) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4 px-8 text-center">
        <div className="w-16 h-16 rounded-full flex items-center justify-center text-3xl text-fl-white bg-fl-open">
          ✓
        </div>
        <h1 className="font-extrabold text-lg">{t("play.checkin.checkedIn")}</h1>
        <p className="text-fl-muted2 text-[13.5px]">{fmt.when(booking.checked_in_at)}</p>
        <button onClick={() => router.push("/bookings")} className="min-h-11 px-4 py-2.5 rounded-xl font-semibold text-[13.5px] bg-fl-ground text-fl-night">
          {t("play.checkin.back")}
        </button>
      </main>
    );
  }

  const window = selfCheckinWindow(booking.starts_at);
  // The shared helper's message is English; rebuild it from the same 15-minute window so it follows the language switch.
  const startMs = new Date(booking.starts_at).getTime();
  const windowMessage = window.isOpen
    ? ""
    // eslint-disable-next-line react-hooks/purity -- same "now" the shared selfCheckinWindow helper uses just above
    : Date.now() < startMs
      ? t("play.checkin.opensAt", { time: fmt.time(new Date(startMs - 15 * 60_000)) })
      : t("play.checkin.closedAt", { time: fmt.time(new Date(startMs + 15 * 60_000)) });

  return (
    <main className="max-w-md mx-auto px-6 py-10 flex flex-col gap-8">
      <h1 className="text-2xl font-extrabold tracking-tight">{t("play.checkin.title")}</h1>

      <div className="bg-fl-white border border-fl-line rounded-2xl p-6 flex flex-col items-center gap-4">
        <p className="font-bold text-[15px]">{t("play.checkin.show")}</p>
        <div className="p-4 bg-white rounded-xl border border-fl-line">
          <QRCodeSVG value={booking.id} size={180} />
        </div>
        <p className="text-fl-muted2 text-[12.5px] text-center">
          {t("play.checkin.scanNote", { time: fmt.time(booking.starts_at) })}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <p className="font-bold text-[15px]">{t("play.checkin.orCode")}</p>
        {!window.isOpen ? (
          <div className="rounded-xl p-3.5 bg-fl-ground">
            <p className="text-fl-muted2 text-[13px] text-center">{windowMessage}</p>
          </div>
        ) : null}
        <input
          value={manualToken}
          onChange={(e) => setManualToken(e.target.value)}
          placeholder={t("play.checkin.codePlaceholder")}
          disabled={!window.isOpen}
          className="border border-fl-line rounded-xl px-4 py-3 text-sm tabular-nums disabled:opacity-50"
        />
        {error ? <p className="text-[13px] font-semibold text-fl-danger">{error}</p> : null}
        <button
          onClick={submitSelfCheckin}
          disabled={!window.isOpen || !manualToken.trim() || submitting}
          className="min-h-11 px-4 py-3 rounded-xl font-bold text-fl-night bg-fl-orange text-[14.5px] disabled:opacity-50"
        >
          {submitting ? t("play.checkin.checking") : t("play.checkin.title")}
        </button>
      </div>
    </main>
  );
}

export default function CheckinPage(props: PageProps<"/booking/[id]/checkin">) {
  const { ready } = useRequireAuth();
  if (!ready) return null;
  return <CheckinPageInner {...props} />;
}
