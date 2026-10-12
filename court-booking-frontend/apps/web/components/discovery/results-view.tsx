"use client";

import { useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import type { MapVenue } from "@/lib/map-venues";
import { useT } from "@/components/i18n/lang-provider";

// Leaflet touches `window` and brings its own CSS, so it is only ever fetched when the Map view is opened.
const VenueMap = dynamic(() => import("./venue-map"), {
  ssr: false,
  loading: () => <MapLoading />,
});

function MapLoading() {
  const t = useT();
  return <div className="flex h-[min(70vh,560px)] items-center justify-center rounded-3xl bg-khelo-surface text-khelo-muted-2">{t("search.view.loadingMap")}</div>;
}

type View = "list" | "map";

/**
 * Wraps the result list (rendered by the server page and passed in as `list`). When `pins` is given (the page decided
 * enough venues have coordinates) a List / Map toggle appears; the list is the default and stays the only view otherwise.
 */
export function ResultsView({ list, pins }: { list: ReactNode; pins: MapVenue[] | null }) {
  const t = useT();
  const [view, setView] = useState<View>("list");
  if (!pins) return <>{list}</>;

  const tabs: { id: View; label: string }[] = [
    { id: "list", label: t("search.view.list") },
    { id: "map", label: t("search.view.map") },
  ];
  function onKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const next: View = e.key === "ArrowLeft" || e.key === "Home" ? "list" : "map";
    setView(next);
    document.getElementById(`results-tab-${next}`)?.focus();
  }

  return (
    <div>
      <div role="tablist" aria-label={t("search.view.label")} className="mb-4 inline-flex gap-1 rounded-full border-[1.5px] border-khelo-border bg-khelo-surface p-1" data-testid="view-toggle">
        {tabs.map((tab) => {
          const on = view === tab.id;
          return (
            <button
              key={tab.id}
              id={`results-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={on}
              aria-controls="results-panel"
              tabIndex={on ? 0 : -1}
              onClick={() => setView(tab.id)}
              onKeyDown={onKeyDown}
              className={`khelo-btn min-h-11 min-w-[88px] rounded-full px-5 py-2 text-[14px] font-bold ${on ? "bg-khelo-ink text-white" : "text-khelo-ink"}`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div id="results-panel" role="tabpanel" aria-labelledby={`results-tab-${view}`}>
        {view === "list" ? list : <VenueMap pins={pins} />}
      </div>
    </div>
  );
}
