"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { BookingExtras } from "@court-booking/types";
import { api } from "@/lib/api";
import { formatPKR } from "@/lib/format";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useLang, useT } from "@/components/i18n/lang-provider";

/**
 * audit 2026-10-28 Phase 3 items 3, 4, 6 on the player's booking page (also the receipt): the points rule and discount,
 * the "Total X, diye Y, baqi Z -> Sahi hai / Ghalat hai" question, "Pohanch gaya" (ONE GPS reading) and "Main aaya tha".
 * Everything comes from GET /bookings/{id}/extras and shows nothing while the matching flag is off.
 */
export function BookingExtrasCard({ bookingId }: { bookingId: string }) {
  const t = useT();
  const lang = useLang();
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["booking-extras", bookingId], queryFn: () => api.phase3.extras(bookingId) });
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [reason, setReason] = useState("");
  const [askReason, setAskReason] = useState(false);
  const [note, setNote] = useState("");
  const d = q.data;
  if (!d) return null;
  const showPoints = d.points.state !== "off";
  const short = d.short_payment;
  const arrival = d.arrival;
  if (!showPoints && !short && !arrival.enabled) return null;

  async function run(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    setMessage(null);
    try {
      await fn();
      setMessage({ ok: true, text: ok });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["booking-extras", bookingId] }),
        queryClient.invalidateQueries({ queryKey: ["booking", bookingId] }),
        queryClient.invalidateQueries({ queryKey: ["booking-detail", bookingId] }),
      ]);
    } catch (e) {
      setMessage({ ok: false, text: friendlyErrorMessage(e, t) });
    } finally {
      setBusy(null);
    }
  }

  function arrive() {
    if (!("geolocation" in navigator)) {
      setMessage({ ok: false, text: t("play.p3.noGps") });
      return;
    }
    setBusy("arrive");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        void run("arrive", () => api.phase3.arrived(bookingId, pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy), t("play.p3.arrivedSaved"));
      },
      () => {
        setBusy(null);
        setMessage({ ok: false, text: t("play.p3.gpsDenied") });
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-fl-card bg-fl-white p-5" data-testid="booking-extras">
      {short ? <ShortBlock short={short} /> : null}
      {short?.can_reply ? (
        askReason ? (
          <div className="flex flex-col gap-2">
            <label className="text-[13px] font-bold text-fl-night" htmlFor="short-reason">{t("play.p3.reasonLabel")}</label>
            <textarea id="short-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} className="rounded-xl border border-fl-line p-3 text-[14px]" />
            <div className="flex flex-wrap gap-2">
              <Btn tone="danger" busy={busy === "no"} onClick={() => run("no", () => api.phase3.replyShort(short.id, "no", reason.trim()), t("play.p3.sentToVenue"))}>{t("play.p3.sendNo")}</Btn>
              <Btn tone="soft" onClick={() => setAskReason(false)}>{t("play.p3.back")}</Btn>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2" data-testid="short-reply">
            <Btn busy={busy === "yes"} onClick={() => run("yes", () => api.phase3.replyShort(short.id, "yes"), t("play.p3.thanks5"))}>{t("play.p3.sahiHai")}</Btn>
            <Btn tone="danger" onClick={() => setAskReason(true)}>{t("play.p3.ghalatHai")}</Btn>
          </div>
        )
      ) : null}

      {arrival.enabled && arrival.can_arrive ? (
        <div className="flex flex-col gap-1">
          <Btn busy={busy === "arrive"} onClick={arrive}>{t("play.p3.arrive")}</Btn>
          <p className="text-[12.5px] text-fl-muted">{t("play.p3.arriveHint")}</p>
        </div>
      ) : null}
      {arrival.arrival ? <p className="text-[14px] text-fl-night" data-testid="arrival-verdict">{t(`play.p3.verdict.${arrival.arrival.verdict}`)}</p> : null}
      {arrival.can_reply_noshow ? (
        <div className="flex flex-col gap-2" data-testid="noshow-reply">
          <p className="text-[14px] text-fl-night">{t("play.p3.noshowAsk")}</p>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} placeholder={t("play.p3.noshowNote")} className="rounded-xl border border-fl-line p-3 text-[14px]" />
          <Btn busy={busy === "noshow"} onClick={() => run("noshow", () => api.phase3.noshowReply(bookingId, note.trim()), t("play.p3.toldVenue"))}>{t("play.p3.mainAayaTha")}</Btn>
        </div>
      ) : null}
      {arrival.noshow_reply ? (
        <p className="text-[14px] text-fl-night">
          {arrival.noshow_reply.owner_decision === "reverse" ? t("play.p3.noshowReversed") : arrival.noshow_reply.owner_decision === "keep" ? t("play.p3.noshowKept") : t("play.p3.noshowWaiting")}
        </p>
      ) : null}

      {showPoints ? <PointsBlock points={d.points} busy={busy === "points"} onUse={() => run("points", () => api.phase3.usePoints(bookingId), t("play.p3.pointsUsed", { amount: formatPKR(d.points.discount_pkr) }))} lang={lang} /> : null}
      {message ? <p role="status" className={`text-[13px] ${message.ok ? "text-fl-open" : "text-fl-danger"}`}>{message.text}</p> : null}
    </section>
  );
}

function ShortBlock({ short }: { short: NonNullable<BookingExtras["short_payment"]> }) {
  const t = useT();
  const status = short.resolved_at
    ? short.resolution === "waived" ? t("play.p3.st.waived") : t("play.p3.st.paid")
    : t(`play.p3.st.${short.status}`);
  return (
    <div className="flex flex-col gap-1" data-testid="short-payment">
      <h2 className="font-fl-display text-[17px] font-extrabold text-fl-night">{t("play.p3.shortTitle")}</h2>
      <p className="text-[14.5px] font-bold text-fl-night">{t("play.p3.shortLine", { total: formatPKR(short.total_pkr), paid: formatPKR(short.paid_pkr), due: formatPKR(short.due_pkr) })}</p>
      <p className="text-[13px] text-fl-muted">{status}</p>
    </div>
  );
}

function PointsBlock({ points, busy, onUse, lang }: { points: BookingExtras["points"]; busy: boolean; onUse: () => void; lang: string }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-2 border-t border-fl-line pt-3" data-testid="points-offer">
      {points.state === "available" ? (
        <Btn busy={busy} onClick={onUse}>{t("play.p3.usePoints", { points: String(points.cost_points), amount: formatPKR(points.discount_pkr) })}</Btn>
      ) : points.state === "used" ? (
        <p className="text-[14px] font-bold text-fl-open">{t("play.p3.pointsUsed", { amount: formatPKR(points.discount_pkr) })}</p>
      ) : points.state === "not_enough" ? (
        <p className="text-[13.5px] text-fl-night">{t("play.p3.notEnough", { points: String(points.balance) })}</p>
      ) : null}
      <p className="text-[12.5px] text-fl-muted" data-testid="points-rule">{lang === "en" ? points.rule_text_en : points.rule_text_ru}</p>
    </div>
  );
}

function Btn({ children, onClick, busy, tone = "primary" }: { children: React.ReactNode; onClick: () => void; busy?: boolean; tone?: "primary" | "danger" | "soft" }) {
  const cls =
    tone === "danger" ? "border border-fl-danger text-fl-danger bg-white" : tone === "soft" ? "bg-fl-ground text-fl-night" : "bg-fl-night text-white";
  return (
    <button type="button" disabled={busy} onClick={onClick} className={`cursor-pointer self-start whitespace-nowrap rounded-full px-5 py-2.5 text-[14px] font-bold disabled:cursor-wait disabled:opacity-60 ${cls}`}>
      {busy ? "..." : children}
    </button>
  );
}
