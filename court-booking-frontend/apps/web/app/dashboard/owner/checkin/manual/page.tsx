"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";

/** Section 32 Part 9: the web equivalent of the mobile app's camera scan -- no live scanning on
 * web (a laptop at a front desk isn't the realistic device for that; see the hub page), just the
 * same POST /bookings/{id}/checkin Today's own Check-in button already calls. */
export default function OwnerCheckinManualPage() {
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
      setResult(`${booking.player_name ?? "Player"} is checked in.`);
      setCode("");
    } catch (e) {
      setError(friendlyErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-8 flex flex-col gap-4 max-w-md">
      <h1 className="text-2xl font-bold">Check in with a code</h1>
      <p className="text-owner-ink-faint text-[13px]">Enter the booking code the player shows you.</p>

      <input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="Booking code"
        className="border border-owner-border rounded-lg px-4 py-3 font-mono text-sm"
        onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
      />

      {error ? <p className="text-[13px] font-semibold" style={{ color: "#8C3823" }}>{error}</p> : null}
      {result ? <p className="text-[13px] font-semibold" style={{ color: "#1F7A52" }}>{result}</p> : null}

      <button
        onClick={handleSubmit}
        disabled={!code.trim() || submitting}
        className="px-4 py-3 rounded-lg bg-owner-accent text-white font-semibold text-sm disabled:opacity-50"
      >
        {submitting ? "Checking in…" : "Check in"}
      </button>
    </div>
  );
}
