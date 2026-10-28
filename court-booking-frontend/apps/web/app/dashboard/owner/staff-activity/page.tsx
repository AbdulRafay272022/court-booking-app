"use client";

import { api } from "@/lib/api";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { useT } from "@/components/i18n/lang-provider";
import { StaffActivityView } from "@/components/owner/staff-activity-view";

/** Audit 2026-10-28 item 16: the owner's staff dashboard (owner only; the shell hides it from staff). */
export default function OwnerStaffActivityPage() {
  const t = useT();
  const { activeVenueId } = useOwnerVenues();
  return (
    <div className="flex min-w-0 max-w-6xl flex-col gap-6 p-4 sm:p-8">
      <div>
        <h1 className="text-2xl font-bold">{t("odash.sact.title")}</h1>
        <p className="text-sm text-owner-ink-muted">{t("odash.sact.subtitle")}</p>
      </div>
      {activeVenueId ? (
        <StaffActivityView queryKey={["staff-activity", activeVenueId]} load={(from, to) => api.owners.staffActivity(activeVenueId, from, to)} canDecide />
      ) : null}
    </div>
  );
}
