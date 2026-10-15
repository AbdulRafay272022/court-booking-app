"use client";

import { useT } from "@/components/i18n/lang-provider";

/**
 * The tabbed-courts control shared by the venue-setup wizard and Venue settings: one tab per court ("Court 1",
 * "Court 2", ...), a "+ Court" button that adds a new tab (the parent switches to it), and a delete control on the
 * selected tab. It is presentational -- the parent owns the courts, the selection and what "delete" means (the wizard
 * drops a draft, Settings deactivates a saved court), including any confirmation.
 */
export function CourtTabs({
  count,
  active,
  onSelect,
  onAdd,
  onDelete,
  canDelete,
  labelFor,
  addLabel,
  addDisabled = false,
}: {
  count: number;
  active: number;
  onSelect: (index: number) => void;
  onAdd: () => void;
  /** Called for the ACTIVE tab; the parent decides whether to confirm first. */
  onDelete: () => void;
  canDelete: boolean;
  /** Tab text; defaults to "Court N". */
  labelFor?: (index: number) => string;
  addLabel?: string;
  addDisabled?: boolean;
}) {
  const t = useT();
  const tabText = (i: number) => (labelFor ? labelFor(i) : t("setup.tabs.court", { n: i + 1 }));
  return (
    <div className="flex flex-col gap-2" data-testid="court-tabs">
      <div role="tablist" aria-label={t("setup.tabs.aria")} className="flex flex-wrap items-center gap-2">
        {Array.from({ length: count }, (_, i) => {
          const selected = i === active;
          return (
            <button
              key={i}
              role="tab"
              type="button"
              id={`court-tab-${i + 1}`}
              aria-selected={selected}
              onClick={() => onSelect(i)}
              className={`min-h-10 px-4 rounded-lg text-[13.5px] font-semibold border transition-colors ${
                selected ? "bg-owner-accent text-white border-owner-accent" : "bg-owner-surface text-owner-ink-muted border-owner-border"
              }`}
            >
              {tabText(i)}
            </button>
          );
        })}
        <button
          type="button"
          onClick={onAdd}
          disabled={addDisabled}
          className="min-h-10 px-3.5 rounded-lg border border-dashed border-owner-accent text-[13.5px] font-semibold text-owner-accent disabled:opacity-40"
        >
          {addLabel ?? t("setup.tabs.add")}
        </button>
      </div>
      {canDelete ? (
        <button type="button" onClick={onDelete} className="self-start text-[12.5px] font-semibold text-owner-danger">
          {t("setup.tabs.delete", { label: tabText(active) })}
        </button>
      ) : null}
    </div>
  );
}
