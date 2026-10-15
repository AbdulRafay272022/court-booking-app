"use client";

import { Suspense, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useVenueSetupStore } from "@/lib/venue-setup-store";
import { supportWhatsAppUrl } from "@/lib/support";
import { useT } from "@/components/i18n/lang-provider";
import { ErrorState } from "@/components/error-state";
import { PrimaryButton, SecondaryButton, Stepper } from "@/components/setup/ui";
import { PhotoManager } from "@/components/setup/photo-manager";

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
  const t = useT();
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
      {t("setup.status.backDash")}
    </Link>
  ) : null;

  // Once approved there's nothing to wait for: on to the dashboard (an effect, not a redirect during render).
  const approved = query.data?.status === "approved";
  useEffect(() => {
    if (approved) router.replace("/dashboard/owner/today");
  }, [approved, router]);

  if (!venueId) return <p className="text-owner-ink-muted">{t("setup.status.noVenue")}</p>;
  if (query.isError) return <ErrorState message={friendlyErrorMessage(query.error, t)} onRetry={() => query.refetch()} tone="owner" />;
  if (!query.data) return <p className="text-owner-ink-faint">{t("setup.status.loading")}</p>;

  const venue = query.data;
  const courtCount = venue.courts?.filter((c) => c.is_active).length ?? 0;

  if (venue.status === "approved") return null;

  if (venue.status === "rejected") {
    return (
      <>
        {backToDashboard}
        <div className="bg-owner-danger-soft border border-owner-danger-soft-border rounded-2xl p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-[18px] font-bold tracking-tight">{venue.name}</h1>
            <span className="px-3 py-1.5 rounded-full bg-owner-surface border border-owner-danger-soft-border text-owner-danger text-xs font-semibold">{t("setup.status.notApproved")}</span>
          </div>
          <p className="text-owner-danger text-sm leading-5 font-medium">
            {venue.rejection_reason ?? t("setup.status.rejectedDefault")}
          </p>
        </div>

        <div className="bg-owner-surface border border-owner-border rounded-2xl p-5 flex flex-col gap-3">
          <p className="font-bold text-[15px]">{t("setup.status.nextTitle")}</p>
          <ul className="text-[13.5px] leading-6 font-medium text-owner-ink-muted list-disc pl-5">
            <li>{t("setup.status.next1")}</li>
            <li>{t("setup.status.next2")}</li>
          </ul>
          <div className="grid sm:grid-cols-2 gap-3 pt-1">
            <a
              href={supportWhatsAppUrl(t("setup.status.waMessage", { name: venue.name }))}
              target="_blank"
              rel="noopener noreferrer"
              className="h-12 w-full rounded-[10px] bg-owner-accent text-white text-[15px] font-bold flex items-center justify-center text-center px-3"
            >
              {t("setup.status.msgSupport")}
            </a>
            <SecondaryButton
              label={t("setup.status.registerNew")}
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
            {changes ? t("setup.status.changesRequested") : t("setup.status.underReview")}
          </span>
        </div>
        <p className="text-owner-ink-muted text-sm leading-5 font-medium">
          {changes
            ? (venue.rejection_reason ?? t("setup.status.changesDefault"))
            : t("setup.status.submitted")}
        </p>
      </div>

      <Timeline
        rows={[
          { state: "done", title: t("setup.status.tl1"), subtitle: t(courtCount === 1 ? "setup.status.tl1subOne" : "setup.status.tl1subMany", { n: courtCount }) },
          changes
            ? { state: "upcoming", title: t("setup.status.tl2changes"), subtitle: t("setup.status.tl2changesSub") }
            : { state: "active", title: t("setup.status.tl2"), subtitle: t("setup.status.tl2sub") },
          { state: "upcoming", title: t("setup.status.tl3"), subtitle: t("setup.status.tl3sub") },
        ]}
      />

      {/* QA signup-venue round item 8: photo upload on the WEB wizard's post-submit page,
          mirroring what mobile's `pending` screen already offers. Same PhotoManager component
          Venue Settings uses (with the same 8-photo cap and same POST /venues/{id}/photos +
          PUT reorder-keys endpoints); using it here means a web owner can add photos in the
          same window before approval that mobile owners can, instead of "photos only appear
          after approval" as the QA report flagged. Persists straight to Venue.photos via the
          existing endpoint -- no wizard-draft state needed since the venue row already
          exists at this point. */}
      <div className="bg-owner-surface border border-owner-border rounded-2xl p-5 flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p className="font-bold text-[15px]">{t("setup.status.photosTitle")}</p>
          <p className="text-[12.5px] leading-[18px] font-medium text-owner-ink-faint">
            {t("setup.status.photosHelp")}
          </p>
        </div>
        <PhotoManager
          label={t("setup.status.venuePhotos")}
          testKey="Venue photos"
          photoUrls={venue.photo_urls}
          photoKeys={venue.photo_keys}
          max={8}
          onUpload={async (blob) => {
            await api.venues.uploadPhoto(venue.id, blob);
            await query.refetch();
          }}
          onReorder={async (keys) => {
            await api.venues.reorderPhotos(venue.id, keys);
            await query.refetch();
          }}
        />
        {venue.courts.filter((c) => c.is_active).map((c) => (
          <div key={c.id} className="pt-3 border-t border-owner-border-light">
            <PhotoManager
              label={t("setup.status.courtPhotos", { name: c.name, sport: c.sport })}
              testKey={`${c.name} · ${c.sport} photos`}
              photoUrls={c.photo_urls}
              photoKeys={c.photo_keys}
              max={5}
              onUpload={async (blob) => {
                await api.courts.uploadPhoto(c.id, blob);
                await query.refetch();
              }}
              onReorder={async (keys) => {
                await api.courts.reorderPhotos(c.id, keys);
                await query.refetch();
              }}
            />
          </div>
        ))}
      </div>

      <p className="text-[13px] font-medium text-owner-ink-faint">
        {t("setup.status.slow")}{" "}
        <a href={supportWhatsAppUrl()} target="_blank" rel="noopener noreferrer" className="font-bold underline">
          {t("setup.status.slowLink")}
        </a>{" "}
        {t("setup.status.slowEnd")}
      </p>
      <PrimaryButton label={t("setup.status.checkAgain")} onClick={() => query.refetch()} />
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
