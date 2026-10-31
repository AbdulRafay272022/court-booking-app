"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { StaffActivityView } from "@/components/owner/staff-activity-view";

/** Audit 2026-10-28 item 16: the staff dashboard for any venue (admin; English like the rest of the admin console). */
export default function AdminStaffActivityPage() {
  const venuesQuery = useQuery({ queryKey: ["admin-venues-all"], queryFn: () => api.admin.venues() });
  const [venueId, setVenueId] = useState<string | null>(null);
  const venues = venuesQuery.data ?? [];
  const selected = venueId ?? venues[0]?.id ?? null;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <h1 className="text-2xl font-bold">Staff activity</h1>
      <label className="flex max-w-md flex-col gap-1 text-sm font-semibold">
        Venue
        <select
          value={selected ?? ""}
          onChange={(e) => setVenueId(e.target.value)}
          className="min-h-11 rounded-lg border border-owner-border bg-owner-surface px-3"
          data-testid="admin-staff-venue"
        >
          {venues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name} ({v.status})
            </option>
          ))}
        </select>
      </label>
      {selected ? (
        <StaffActivityView queryKey={["admin-staff-activity", selected]} load={(from, to) => api.admin.staffActivity(selected, from, to)} />
      ) : null}
    </div>
  );
}
