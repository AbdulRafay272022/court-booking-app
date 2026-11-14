"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { PAISA_DEFAULT_PERIOD, pktDateString, tabKey, type PaisaTab } from "@court-booking/types";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useT } from "@/components/i18n/lang-provider";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { useMyPermissions } from "@/lib/use-my-permissions";
import { paisaV2Href, parsePaisaV2 } from "@/lib/paisa-v2";
import { usePaisaT } from "@/lib/use-paisa-v2";
import { BookingsTab, rangeParams, type PaisaRangeState } from "./bookings-tab";
import { LendenTab } from "./lenden-tab";
import { PlayersTab } from "./players-tab";
import { KaamTab } from "./kaam-tab";
import { PaisaBookingSheet } from "./booking-sheet";
import { ErrorText } from "./ui";

/**
 * Ledger v2 "Paisa" (docs/design/LEDGER-V2-CONTRACT.md 6.1), behind the flag ledger_v2. Four tabs in `?tab=`: Bookings (Abhi
 * tak + Statement + every booking), Len-den (day book), Players (who owes), Kaam (money tasks, `&group=`). A booking opens in one
 * sheet from anywhere (`?booking=<id>&open=1` from a notification). Staff see the tabs their permissions open: view_ledger all
 * four, mark_refunds only Kaam (its refund groups).
 */
export function PaisaV2Page() {
  const t = useT();
  const pt = usePaisaT();
  const router = useRouter();
  const params = useSearchParams();
  const perms = useMyPermissions();
  const { activeVenue, activeVenueId } = useOwnerVenues();
  const place = parsePaisaV2(params.get("tab"), params.get("group"));
  const ledger = perms.can("view_ledger");
  const tabs: PaisaTab[] = ledger ? ["bookings", "lenden", "players", "kaam"] : perms.can("mark_refunds") ? ["kaam"] : [];
  const tab: PaisaTab = tabs.includes(place.tab) ? place.tab : (tabs[0] ?? "bookings");
  // a notification (refund -> Kaam > Wapas dena, history -> Bookings) opens its booking in the Paisa sheet (contract 6.1)
  const [sheetId, setSheetId] = useState<string | null>(params.get("open") === "1" ? params.get("booking") : null);
  const [range, setRange] = useState<PaisaRangeState>({ period: PAISA_DEFAULT_PERIOD, from: pktDateString(), to: pktDateString(), courtId: "" });
  const [exporting, setExporting] = useState(false);
  const [csvError, setCsvError] = useState<string | null>(null);
  const tasks = useQuery({ queryKey: ["paisa", "tasks", activeVenueId, null, ""], queryFn: () => api.paisa.tasks(activeVenueId), enabled: !!activeVenueId });
  const courts = (activeVenue?.courts ?? []).map((c) => ({ id: c.id, name: c.name }));
  const staff = params.get("staff") && params.get("act") ? { id: params.get("staff") as string, act: params.get("act") as string, who: params.get("who") ?? "" } : null;
  const keep = { date: params.get("date") ?? undefined, courts: params.get("courts") ?? undefined };

  async function exportCsv() {
    setExporting(true);
    setCsvError(null);
    try {
      const csv = await api.paisa.bookingsCsv(rangeParams(range, activeVenueId));
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `paisa_${range.period}_${pktDateString()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setCsvError(friendlyErrorMessage(e, t));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex min-w-0 max-w-6xl flex-col gap-5 p-4 sm:p-8" data-testid="paisa-v2">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <h1 className="text-2xl font-bold">{pt("paisa.title")}</h1>
          {activeVenue ? <span className="text-[13.5px] text-owner-ink-muted">{activeVenue.name}</span> : null}
        </div>
        {ledger ? (
          <button
            type="button"
            onClick={exportCsv}
            disabled={exporting}
            data-testid="paisa-csv"
            className="min-h-10 cursor-pointer rounded-lg border border-owner-border px-4 text-sm font-semibold disabled:opacity-50"
          >
            {exporting ? pt("paisa.csvWorking") : pt("paisa.csv")}
          </button>
        ) : null}
      </header>
      <ErrorText text={csvError} />

      <nav role="tablist" aria-label={pt("paisa.title")} className="flex gap-1 overflow-x-auto border-b border-owner-border">
        {tabs.map((k) => {
          const active = k === tab;
          const badge = k === "kaam" ? tasks.data?.total ?? 0 : 0;
          return (
            <Link
              key={k}
              role="tab"
              aria-selected={active}
              href={paisaV2Href(k, null, k === "kaam" ? keep : {})}
              replace
              scroll={false}
              data-testid={`paisa-v2-tab-${k}`}
              className={`-mb-px inline-flex min-h-11 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-[14.5px] font-semibold ${active ? "border-owner-accent text-owner-ink" : "border-transparent text-owner-ink-muted hover:text-owner-ink"}`}
            >
              {pt(tabKey(k))}
              {badge > 0 ? <span className="rounded-full bg-owner-danger px-2 py-0.5 text-[11.5px] font-bold text-white">{badge}</span> : null}
            </Link>
          );
        })}
      </nav>

      <div role="tabpanel">
        {tab === "bookings" ? (
          <BookingsTab venueId={activeVenueId} courts={courts} staff={staff} onOpenBooking={setSheetId} onRangeChange={setRange} />
        ) : tab === "lenden" ? (
          <LendenTab venueId={activeVenueId} courts={courts} onOpenBooking={setSheetId} />
        ) : tab === "players" ? (
          <PlayersTab venueId={activeVenueId} venueName={activeVenue?.name ?? ""} onOpenBooking={setSheetId} />
        ) : (
          <KaamTab venueId={activeVenueId} focus={place.group} onOpenBooking={setSheetId} />
        )}
      </div>

      {sheetId && ledger ? (
        <PaisaBookingSheet
          bookingId={sheetId}
          venueId={activeVenueId}
          onClose={() => {
            setSheetId(null);
            if (params.get("open")) router.replace(paisaV2Href(tab, place.group, keep), { scroll: false });
          }}
        />
      ) : null}
    </div>
  );
}
