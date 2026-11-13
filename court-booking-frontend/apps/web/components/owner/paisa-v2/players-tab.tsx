"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@court-booking/api-client";
import { moneyStatusKey, type ExcessChoice, type PaisaPlayer } from "@court-booking/types";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useT } from "@/components/i18n/lang-provider";
import { useFmt } from "@/lib/use-fmt";
import { useAuthStore } from "@/lib/auth-store";
import { useMyPermissions } from "@/lib/use-my-permissions";
import { Sheet } from "@/components/fl";
import { RecordPaymentSheet } from "@/components/owner/record-payment-sheet";
import { parseRupees, pkrText, waLink } from "@/lib/paisa-v2";
import { usePaisaT } from "@/lib/use-paisa-v2";
import { refreshPaisa } from "./booking-sheet";
import { Choice, ErrorText, MoneyLine, PrimaryButton, TextField } from "./ui";

/** Players (contract 5.5 / 6.1): who owes what, all time, open balances first; oldest booking first inside each player. */
export function PlayersTab({ venueId, venueName, onOpenBooking }: { venueId?: string; venueName: string; onOpenBooking: (id: string) => void }) {
  const t = useT();
  const pt = usePaisaT();
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<PaisaPlayer | null>(null);
  useEffect(() => {
    const id = setTimeout(() => setQ(typed.trim()), 350);
    return () => clearTimeout(id);
  }, [typed]);
  const query = useQuery({ queryKey: ["paisa", "players", venueId, q], queryFn: () => api.paisa.players(venueId, q || undefined), enabled: !!venueId, placeholderData: (p) => p });
  const data = query.data;

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="paisa-players">
      {data ? <p className="text-[13.5px] font-semibold text-owner-ink-muted" data-testid="players-points">{pt("paisa.players.points", { awarded: data.points_awarded, used: data.points_used })}</p> : null}
      <input
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        placeholder={pt("paisa.search")}
        aria-label={pt("paisa.search")}
        data-testid="players-search"
        className="h-10 rounded-lg border border-owner-border bg-owner-surface px-3 text-[14px] outline-none focus-visible:ring-2 focus-visible:ring-owner-accent"
      />
      {query.isError ? <ErrorText text={friendlyErrorMessage(query.error, t)} /> : null}
      {query.isLoading ? <p className="py-6 text-center text-owner-ink-faint">{pt("paisa.loading")}</p> : null}
      {data && data.items.length === 0 ? (
        <p className="rounded-xl border border-owner-border bg-owner-surface py-8 text-center text-owner-ink-faint">{pt("paisa.empty.players")}</p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {data?.items.map((p) => (
          <li key={`${p.key.player_id ?? ""}-${p.key.phone ?? ""}-${p.name}`}>
            <button
              type="button"
              onClick={() => setOpen(p)}
              data-testid="player-row"
              className="flex w-full cursor-pointer flex-wrap items-center justify-between gap-3 rounded-xl border border-owner-border bg-owner-surface px-4 py-3 text-left hover:border-owner-accent"
            >
              <span className="flex min-w-0 flex-1 basis-48 flex-col gap-0.5">
                <span className="truncate text-[15px] font-bold text-owner-ink">{p.name}</span>
                {p.phone ? <span className="text-[12.5px] tabular-nums text-owner-ink-muted">{p.phone}</span> : null}
              </span>
              <span className="flex shrink-0 flex-col items-end gap-0.5 tabular-nums">
                {p.due_total ? <span className="text-[15px] font-extrabold text-owner-warn-dark">{pt("paisa.players.total", { amount: pkrText(p.due_total) })}</span> : null}
                {p.credit ? <span className="text-[13px] font-semibold text-owner-success">{pt("paisa.players.credit", { amount: pkrText(p.credit) })}</span> : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {open ? <TakePaymentSheet player={open} venueId={venueId} venueName={venueName} onClose={() => setOpen(null)} onOpenBooking={onOpenBooking} /> : null}
    </div>
  );
}

/** "Raqam lein": oldest due first. Cash spreads over the bookings on the server; a transfer goes with its screenshot on the
 * oldest booking (to Approvals). */
function TakePaymentSheet({ player, venueId, venueName, onClose, onOpenBooking }: { player: PaisaPlayer; venueId?: string; venueName: string; onClose: () => void; onOpenBooking: (id: string) => void }) {
  const t = useT();
  const pt = usePaisaT();
  const fmt = useFmt();
  const qc = useQueryClient();
  const perms = useMyPermissions();
  const isOwner = useAuthStore((s) => s.user?.role) !== "staff";
  const [amount, setAmount] = useState(String(player.due_total));
  const [method, setMethod] = useState<"cash" | "transfer">("cash");
  const [excess, setExcess] = useState<{ amount: number; canCredit: boolean } | null>(null);
  const [choice, setChoice] = useState<ExcessChoice>("refund");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transferOn, setTransferOn] = useState<string | null>(null);
  const typed = parseRupees(amount);
  const oldest = player.open_bookings[0];
  const canRecord = perms.can("record_payments");
  const list = player.open_bookings.map((b) => `${b.short_code} ${pkrText(b.due)}`).join(", ");
  const wa = waLink(player.phone, pt("paisa.players.wa", { name: player.name, venue: venueName, amount: pkrText(player.due_total), list }));

  async function save() {
    if (!Number.isFinite(typed) || typed <= 0 || busy) return;
    if (method === "transfer") {
      if (oldest) setTransferOn(oldest.booking_id);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.paisa.playerPayment({ player_id: player.key.player_id, phone: player.key.phone, amount_pkr: typed, excess_choice: excess ? choice : undefined }, venueId);
      await refreshPaisa(qc);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.code === "EXCESS_CHOICE_REQUIRED") {
        const d = (e.details ?? {}) as { excess_pkr?: number; can_credit?: boolean };
        setExcess({ amount: Number(d.excess_pkr ?? 0), canCredit: d.can_credit === true && isOwner });
      } else setError(friendlyErrorMessage(e, t));
    } finally {
      setBusy(false);
    }
  }

  if (transferOn && oldest) {
    return (
      <RecordPaymentSheet
        bookingId={oldest.booking_id}
        playerLabel={`${player.name} · ${oldest.short_code}`}
        owed={oldest.due}
        isOwner={isOwner}
        onClose={() => setTransferOn(null)}
        onDone={() => {
          void refreshPaisa(qc);
          onClose();
        }}
      />
    );
  }

  return (
    <Sheet open onClose={onClose} title={player.name} subtitle={pt("paisa.players.total", { amount: pkrText(player.due_total) })} data-testid="take-payment-sheet">
      <div className="flex flex-col gap-1 rounded-xl bg-owner-bg p-2">
        <span className="px-2 text-[12px] font-bold text-owner-ink-faint">{pt("paisa.players.oldestFirst")}</span>
        {player.open_bookings.map((b) => (
          <button key={b.booking_id} type="button" onClick={() => onOpenBooking(b.booking_id)} className="w-full cursor-pointer text-left">
            <MoneyLine label={`${b.short_code} · ${fmt.dateRelative(`${b.slot_date}T12:00:00+05:00`)} · ${b.court}`} sub={pt(moneyStatusKey(b.money_status))} value={pkrText(b.due)} />
          </button>
        ))}
      </div>
      {canRecord ? (
        <>
          <TextField label={pt("paisa.rec.amount")} value={amount} onChange={(v) => { setAmount(v); setExcess(null); }} inputMode="numeric" testId="take-amount" />
          <Choice<"cash" | "transfer">
            label={pt("paisa.rec.how")}
            value={method}
            onChange={setMethod}
            options={[
              { value: "cash", label: pt("paisa.rec.cash") },
              { value: "transfer", label: pt("paisa.rec.transfer") },
            ]}
          />
          {excess ? (
            <div className="flex flex-col gap-2 rounded-xl border border-owner-warn-soft-border bg-owner-warn-soft p-3">
              <b className="text-[14px]">{pt("paisa.rec.extra", { amount: excess.amount.toLocaleString("en-US") })}</b>
              <Choice<ExcessChoice>
                value={choice}
                onChange={setChoice}
                options={[
                  { value: "refund", label: pt("paisa.rec.toPlayer") },
                  { value: "credit", label: pt("paisa.rec.toCredit"), disabled: !excess.canCredit },
                ]}
              />
            </div>
          ) : null}
          <ErrorText text={error} />
          <PrimaryButton label={pt("paisa.act.save")} onClick={save} busy={busy} disabled={!Number.isFinite(typed) || typed <= 0} testId="take-save" />
        </>
      ) : null}
      {wa ? (
        <a href={wa} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-owner-border px-4 text-[14px] font-bold text-owner-ink" data-testid="take-whatsapp">
          {pt("paisa.act.whatsapp")}
        </a>
      ) : null}
    </Sheet>
  );
}
