"use client";

import { Suspense, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useVenueSetupStore } from "@/lib/venue-setup-store";
import { supportWhatsAppUrl } from "@/lib/support";
import { ErrorState } from "@/components/error-state";
import { PrimaryButton, SecondaryButton, Stepper } from "@/components/setup/ui";

function Timeline({ rows }: { rows: { state: "done" | "active" | "upcoming"; title: string; subtitle: string }[] }) {
  return (
    <ol className="bg-owner-surface border border-owner-border rounded-2xl p-5 flex flex-col">
      {rows.map((r, i) => (
        <li key={r.title} className="flex gap-3.5">
          <div className="flex flex-col items-center">
            <span
              className={`w-[26px] h-[26px] rounded-full flex items-center justify-center text-[12px] font-bold ${
                r.state === "done"
                  ? "bg-owner-success text-white"
                  : r.state === "active"
                    ? "bg-owner-warn text-white"
                    : "bg-owner-bg border border-owner-border text-owner-ink-faint"
              }`}
            >
              {r.state === "done" ? "✓" : r.state === "active" ? "•" : ""}
            </span>
            {i < rows.length - 1 ? <span className={`w-0.5 flex-1 min-h-[26px] ${r.state === "done" ? "bg-owner-success" : "bg-owner-border"}`} /> : null}
          </div>
          <div className={`flex flex-col gap-0.5 flex-1 ${i < rows.length - 1 ? "pb-5" : ""}`}>
            <p className={`text-[14.5px] font-semibold ${r.state === "upcoming" ? "text-owner-ink-faint" : r.state === "active" ? "text-owner-warn" : "text-owner-ink"}`}>{r.title}</p>
            <p className="text-[12.5px] font-medium leading-[18px] text-owner-ink-faint">{r.subtitle}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** The three post-submission states the mobile app handles (and one it mishandled):
 *  pending -> "we're checking it"; changes_requested -> what to fix; rejected -> the reason
 *  and real next steps (mobile used to drop a rejected owner onto the normal Today screen
 *  with no message at all). */
function StatusView() {
  const router = useRouter();
  const search = useSearchParams();
  const venueId = search.get("venueId") ?? "";
  const resetDraft = useVenueSetupStore((s) => s.reset);
  const query = useQuery({ queryKey: ["venue", venueId], queryFn: () => api.venues.get(venueId), enabled: !!venueId });

  // An owner who already has a LIVE venue and is looking at a second one's status needs a way
  // back to the dashboard (this page is outside it).
  const venuesQuery = useQuery({ queryKey: ["owner-venues"], queryFn: () => api.owners.venues() });
  const hasLiveVenue = (venuesQuery.data ?? []).some((v) => v.status === "approved");
  const backToDashboard = hasLiveVenue ? (
    <Link href="/dashboard/owner/today" className="self-start text-[13.5px] font-bold text-owner-accent underline">
      ← Back to your dashboard
    </Link>
  ) : null;

  // Once approved there's nothing to wait for: on to the dashboard (an effect, not a redirect during render).
  const approved = query.data?.status === "approved";
  useEffect(() => {
    if (approved) router.replace("/dashboard/owner/today");
  }, [approved, router]);

  if (!venueId) return <p className="text-owner-ink-muted">No venue selected.</p>;
  if (query.isError) return <ErrorState message={friendlyErrorMessage(query.error)} onRetry={() => query.refetch()} tone="owner" />;
  if (!query.data) return <p className="text-owner-ink-faint">Loading…</p>;

  const venue = query.data;
  const courtCount = venue.courts?.length ?? 0;

  if (venue.status === "approved") return null;

  if (venue.status === "rejected") {
    return (
      <>
        {backToDashboard}
        <div className="bg-owner-danger-soft border border-owner-danger-soft-border rounded-2xl p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-[18px] font-bold tracking-tight">{venue.name}</h1>
            <span className="px-3 py-1.5 rounded-full bg-owner-surface border border-owner-danger-soft-border text-owner-danger text-xs font-semibold">Not approved</span>
          </div>
          <p className="text-owner-danger text-sm leading-5 font-medium">
            {venue.rejection_reason ?? "We couldn't approve this venue as submitted."}
          </p>
        </div>

        <div className="bg-owner-surface border border-owner-border rounded-2xl p-5 flex flex-col gap-3">
          <p className="font-bold text-[15px]">What you can do next</p>
          <ul className="text-[13.5px] leading-6 font-medium text-owner-ink-muted list-disc pl-5">
            <li>Message us and we&apos;ll tell you exactly what would change the decision.</li>
            <li>Or register the venue again with the details corrected.</li>
          </ul>
          <div className="grid sm:grid-cols-2 gap-3 pt-1">
            <a
              href={supportWhatsAppUrl(`Hi, my venue "${venue.name}" wasn't approved. Can you help?`)}
              target="_blank"
              rel="noopener noreferrer"
              className="h-12 w-full rounded-[10px] bg-owner-accent text-white text-[15px] font-bold flex items-center justify-center text-center px-3"
            >
              Message support on WhatsApp
            </a>
            <SecondaryButton
              label="Register a new venue"
              onClick={() => {
                resetDraft();
                router.push("/venue-setup/register");
              }}
            />
          </div>
        </div>
      </>
    );
  }

  const changes = venue.status === "changes_requested";
  return (
    <>
      {backToDashboard}
      <Stepper current={3} />
      <div className="bg-owner-surface border border-owner-border rounded-2xl p-5 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-[18px] font-bold tracking-tight">{venue.name}</h1>
          <span className="px-3 py-1.5 rounded-full bg-owner-warn-soft border border-owner-warn-soft-border text-owner-warn text-xs font-semibold">
            {changes ? "Changes requested" : "Under review"}
          </span>
        </div>
        <p className="text-owner-ink-muted text-sm leading-5 font-medium">
          {changes
            ? (venue.rejection_reason ?? "We asked for a few changes — message us and we'll go through them with you.")
            : "Submitted just now. We review every venue by hand — usually within a day."}
        </p>
      </div>

      <Timeline
        rows={[
          { state: "done", title: "You sent it in", subtitle: `${courtCount} court${courtCount === 1 ? "" : "s"}, hours and prices received` },
          changes
            ? { state: "upcoming", title: "Waiting on your changes", subtitle: "Message us to sort out what we flagged" }
            : { state: "active", title: "We're checking it now", subtitle: "Confirming your details are complete and accurate" },
          { state: "upcoming", title: "You go live", subtitle: "Players nearby can find and book you" },
        ]}
      />

      <div className="bg-owner-accent-soft border border-owner-accent-soft-border rounded-2xl p-5 flex flex-col gap-3">
        <p className="font-bold text-owner-accent-hover text-[15px]">You don&apos;t have to wait to start</p>
        <p className="text-[13px] leading-5 font-medium text-owner-ink-muted">
          Add today&apos;s phone and walk-in bookings now. When you go live, your calendar is already correct.
        </p>
        <Link href="/dashboard/owner/walkin" className="h-11 rounded-[9px] bg-owner-accent text-white text-sm font-semibold flex items-center justify-center">
          Add a booking
        </Link>
      </div>

      <p className="text-[13px] font-medium text-owner-ink-faint">
        Taking too long?{" "}
        <a href={supportWhatsAppUrl()} target="_blank" rel="noopener noreferrer" className="font-bold underline">
          Message us
        </a>{" "}
        and we&apos;ll look straight away.
      </p>
      <PrimaryButton label="Check again" onClick={() => query.refetch()} />
    </>
  );
}

export default function VenueStatusPage() {
  return (
    <Suspense>
      <StatusView />
    </Suspense>
  );
}
