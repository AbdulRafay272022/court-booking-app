"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Venue, VenueStatus } from "@court-booking/types";
import { useVenueSetupStore } from "@/lib/venue-setup-store";

export const STATUS_LABEL: Record<VenueStatus, string> = {
  approved: "Live",
  pending: "Under review",
  changes_requested: "Changes requested",
  rejected: "Not approved",
};

const STATUS_STYLE: Record<VenueStatus, { bg: string; fg: string }> = {
  approved: { bg: "var(--color-owner-success-soft)", fg: "var(--color-owner-success-dark)" },
  pending: { bg: "var(--color-owner-warn-soft)", fg: "var(--color-owner-warn)" },
  changes_requested: { bg: "var(--color-owner-warn-soft)", fg: "var(--color-owner-warn)" },
  rejected: { bg: "var(--color-owner-danger-soft)", fg: "var(--color-owner-danger)" },
};

export function StatusBadge({ status }: { status: VenueStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span className="px-2 py-0.5 rounded-full text-[10.5px] font-bold whitespace-nowrap" style={{ background: s.bg, color: s.fg }}>
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Sidebar venue list: every venue with ITS OWN status, click to switch which one the dashboard
 * manages, and "+ Add another venue" (reuses the existing setup wizard, starting from a clean
 * draft). Shown for one venue too -- it's how an owner with a single venue finds "Add another". */
export function VenuePicker({
  venues,
  activeVenueId,
  onSelect,
}: {
  venues: Venue[];
  activeVenueId: string | undefined;
  onSelect: (id: string) => void;
}) {
  const router = useRouter();
  const resetDraft = useVenueSetupStore((s) => s.reset);
  return (
    <div className="px-3 pb-3 flex flex-col gap-1.5" aria-label="Your venues">
      <p className="px-3.5 text-[10.5px] font-bold uppercase tracking-[0.11em] text-owner-ink-faint">
        {venues.length > 1 ? "Your venues" : "Your venue"}
      </p>
      <ul className="flex flex-col gap-1" role="radiogroup" aria-label="Venue">
        {venues.map((v) => {
          const active = v.id === activeVenueId;
          return (
            <li key={v.id}>
              <button
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onSelect(v.id)}
                className="w-full text-left px-3.5 py-2 rounded-lg flex flex-col gap-1 border"
                style={{
                  background: active ? "var(--color-owner-accent-soft)" : "transparent",
                  borderColor: active ? "var(--color-owner-accent-soft-border)" : "transparent",
                }}
              >
                <span className="text-[13.5px] font-semibold leading-tight" style={{ color: active ? "var(--color-owner-accent)" : "var(--color-owner-ink)" }}>
                  {v.name}
                </span>
                <StatusBadge status={v.status} />
              </button>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={() => {
          resetDraft();
          router.push("/venue-setup/register");
        }}
        className="mt-1 px-3.5 py-2 rounded-lg text-[13px] font-semibold text-owner-accent border border-dashed border-owner-accent-soft-border text-left"
      >
        + Add another venue
      </button>
    </div>
  );
}

/** Shown above the dashboard when the venue being managed isn't live: each venue keeps its own
 * status, so this reflects the SELECTED one, with a way to its status page. */
export function VenueStatusBanner({ venue }: { venue: Venue }) {
  if (venue.status === "approved") return null;
  const copy: Record<Exclude<VenueStatus, "approved">, string> = {
    pending: "is under review. Players can't find or book it yet — you can still add walk-in bookings.",
    changes_requested: "needs changes before it can go live.",
    rejected: "wasn't approved, so players can't book it.",
  };
  return (
    <div
      role="status"
      className="mx-8 mt-6 rounded-xl px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px] font-medium border"
      style={{
        background: venue.status === "rejected" ? "var(--color-owner-danger-soft)" : "var(--color-owner-warn-soft)",
        borderColor: venue.status === "rejected" ? "var(--color-owner-danger-soft-border)" : "var(--color-owner-warn-soft-border)",
        color: venue.status === "rejected" ? "var(--color-owner-danger)" : "var(--color-owner-warn-dark)",
      }}
    >
      <span>
        <strong>{venue.name}</strong> {copy[venue.status]}
      </span>
      <Link href={`/venue-setup/status?venueId=${venue.id}`} className="font-bold underline">
        View status
      </Link>
    </div>
  );
}
