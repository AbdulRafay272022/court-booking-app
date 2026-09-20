"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ApiError } from "@court-booking/api-client";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { formatPKR, formatTime, toDateInputValue } from "@/lib/format";
import { useOwnerVenues } from "@/lib/use-owner-venues";

export default function OwnerWalkinPage() {
  const { activeVenue } = useOwnerVenues();
  const queryClient = useQueryClient();
  const courts = (activeVenue?.courts ?? []).filter((c) => c.is_active);

  const [courtId, setCourtId] = useState<string | undefined>(undefined);
  const [startsAt, setStartsAt] = useState<string | undefined>(undefined);
  const [playerName, setPlayerName] = useState("");
  const [playerPhone, setPlayerPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!courtId && courts.length > 0) setCourtId(courts[0].id);
  }, [courts, courtId]);

  // Section 29 Tier 2 Part 3: a walk-in used to always book against today only -- an owner
  // taking a phone booking for tomorrow (a completely normal case) had no way to do it here.
  const next7Days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return d; }),
    [],
  );
  const [dateIdx, setDateIdx] = useState(0);
  const date = toDateInputValue(next7Days[dateIdx]);
  const availabilityQuery = useQuery({
    queryKey: ["court-availability", courtId, date],
    queryFn: () => api.availability.forCourtOnDate(courtId!, date),
    enabled: !!courtId,
  });

  const slots = availabilityQuery.data?.slots ?? [];
  const selectedSlot = slots.find((s) => s.starts_at === startsAt);

  useEffect(() => {
    if (selectedSlot) setAmount((prev) => (prev ? prev : String(Math.round(selectedSlot.price))));
  }, [selectedSlot]);

  const isValid = !!courtId && !!startsAt && playerName.trim().length > 0 && Number(amount) >= 0;

  async function handleSubmit() {
    if (!isValid || !courtId || !startsAt) return;
    setSubmitting(true);
    setMessage(null);
    try {
      await api.bookings.walkin({
        court_id: courtId,
        starts_at: startsAt,
        player_name: playerName.trim(),
        player_phone: playerPhone.trim() || undefined,
        amount_paid: Number(amount),
      });
      await queryClient.invalidateQueries({ queryKey: ["owner-today"] });
      setPlayerName("");
      setPlayerPhone("");
      setAmount("");
      setStartsAt(undefined);
      setMessage("Booking saved.");
    } catch (e) {
      if (e instanceof ApiError && e.code === "SLOT_ALREADY_TAKEN") {
        setMessage("This slot was just booked through the app — pick another.");
        setStartsAt(undefined);
        availabilityQuery.refetch();
      } else {
        setMessage(friendlyErrorMessage(e));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-8 max-w-xl flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Add a booking</h1>

      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-bold tracking-wider text-owner-ink-faint">COURT</span>
        <div className="flex gap-2 flex-wrap">
          {courts.map((c) => (
            <button
              key={c.id}
              onClick={() => { setCourtId(c.id); setStartsAt(undefined); }}
              className="px-4 py-2.5 rounded-lg text-sm font-semibold"
              style={{ background: courtId === c.id ? "#0E6274" : "#FFFFFF", color: courtId === c.id ? "#fff" : "#5B7079", border: courtId === c.id ? "none" : "1px solid #DCE3E6" }}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-bold tracking-wider text-owner-ink-faint">DATE</span>
        <div className="flex gap-2 flex-wrap">
          {next7Days.map((d, i) => (
            <button
              key={i}
              onClick={() => { setDateIdx(i); setStartsAt(undefined); }}
              className="px-3.5 py-2.5 rounded-lg text-[13px] font-semibold"
              style={{ background: dateIdx === i ? "#0E6274" : "#FFFFFF", color: dateIdx === i ? "#fff" : "#101C21", border: dateIdx === i ? "none" : "1px solid #DCE3E6" }}
            >
              {i === 0 ? "Today" : i === 1 ? "Tomorrow" : d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric" })}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-bold tracking-wider text-owner-ink-faint">TIME</span>
        <div className="flex gap-2 flex-wrap">
          {slots.map((slot) => {
            const taken = slot.status !== "available";
            const selected = startsAt === slot.starts_at;
            return (
              <button
                key={slot.starts_at}
                disabled={taken}
                onClick={() => setStartsAt(slot.starts_at)}
                className="px-4 py-2.5 rounded-lg font-mono text-sm font-semibold"
                style={{
                  background: selected ? "#0E6274" : taken ? "#EFF2F3" : "#FFFFFF",
                  color: selected ? "#fff" : taken ? "#A6B6BC" : "#101C21",
                  border: selected ? "none" : "1px solid #DCE3E6",
                  textDecoration: taken ? "line-through" : "none",
                }}
              >
                {formatTime(slot.starts_at)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Player name" value={playerName} onChange={setPlayerName} placeholder="Usman Tariq" />
        <Field label="Player phone (optional)" value={playerPhone} onChange={setPlayerPhone} placeholder="0333 5119042" mono />
      </div>
      <Field label="Amount collected (PKR)" value={amount} onChange={(v) => setAmount(v.replace(/\D/g, ""))} placeholder="4000" mono />
      {selectedSlot ? <p className="text-owner-ink-faint text-[12.5px] -mt-2">Court price for this slot: PKR {formatPKR(selectedSlot.price)}</p> : null}

      {message ? <p className="text-sm font-semibold" style={{ color: message.includes("saved") ? "#1F7A52" : "#8C3823" }}>{message}</p> : null}

      <button
        onClick={handleSubmit}
        disabled={!isValid || submitting}
        className="h-13 rounded-xl bg-owner-accent text-white font-bold disabled:opacity-50"
        style={{ height: 52 }}
      >
        {submitting ? "Saving…" : "Save booking"}
      </button>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, mono }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-owner-ink-muted">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`h-12 px-3.5 rounded-lg border border-owner-border outline-none text-sm ${mono ? "font-mono" : ""}`}
      />
    </div>
  );
}
