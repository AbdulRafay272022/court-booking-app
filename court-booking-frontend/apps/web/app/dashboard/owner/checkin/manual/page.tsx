"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useT } from "@/components/i18n/lang-provider";

/** Section 32 Part 9: the web equivalent of the mobile app's camera scan -- no live scanning on
 * web (a laptop at a front desk isn't the realistic device for that; see the hub page), just the
 * same POST /bookings/{id}/checkin Today's own Check-in button already calls. */
export default function OwnerCheckinManualPage() {
  const t = useT();
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!code.trim()) return;
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const { booking } = await api.bookings.checkin(code.trim());
      setResult(t("odash.checkin.code.done", { name: booking.player_name ?? t("odash.today.player") }));
      setCode("");
    } catch (e) {
      setError(friendlyErrorMessage(e, t));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-8 flex flex-col gap-4 max-w-md">
      <h1 className="text-2xl font-bold">{t("odash.checkin.code.title")}</h1>
      <p className="text-owner-ink-faint text-[13px]">{t("odash.checkin.code.intro")}</p>

      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder={t("odash.checkin.code.placeholder")}
        className="border border-owner-border rounded-lg px-4 py-3 tabular-nums text-sm"
        onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
      />

      {error ? <p className="text-[13px] font-semibold" style={{ color: "var(--color-fl-danger)" }}>{error}</p> : null}
      {result ? <p className="text-[13px] font-semibold" style={{ color: "var(--color-fl-open)" }}>{result}</p> : null}

      <button
        onClick={handleSubmit}
        disabled={!code.trim() || submitting}
        className="px-4 py-3 rounded-lg bg-owner-accent text-white font-semibold text-sm disabled:opacity-50"
      >
        {submitting ? t("odash.checkin.code.busy") : t("odash.checkin.code.button")}
      </button>
    </div>
  );
}
