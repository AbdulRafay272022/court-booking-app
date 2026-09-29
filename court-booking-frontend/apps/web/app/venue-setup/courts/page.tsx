"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { isStaleVenueDraftError } from "@court-booking/api-client";
import { buildPricingRules, buildSchedules, courtSetupProblem, defaultCourtSetup } from "@court-booking/types";
import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useVenueSetupStore, type CourtDraft } from "@/lib/venue-setup-store";
import { PrimaryButton, SecondaryButton, SectionLabel, Stepper } from "@/components/setup/ui";
import { CourtSetupFields } from "@/components/setup/court-setup-fields";
import { CourtBasicsFields } from "@/components/setup/court-basics-fields";
import { CourtTabs } from "@/components/setup/court-tabs";

/** Has the owner filled anything into this court beyond what a fresh tab starts with? Decides whether deleting its tab
 * asks for confirmation. A fresh tab is "Court N", the default sport, and the default hours and prices. */
function courtHasData(court: CourtDraft, index: number): boolean {
  if (court.name.trim() !== `Court ${index + 1}`) return true;
  const { name: _n, sport: _s, isIndoor, ...setup } = court;
  void _n; void _s;
  if (isIndoor) return true;
  return JSON.stringify(stripIds(setup)) !== JSON.stringify(stripIds(defaultCourtSetup()));
}

// pricing rules carry a random id per creation; compare everything else
function stripIds(setup: object): unknown {
  return JSON.parse(JSON.stringify(setup, (k, v) => (k === "id" ? undefined : v)));
}

export default function VenueCourtsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const store = useVenueSetupStore();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Section 31 Part 2: the saved draft pointed at a venue/court that no longer exists (or isn't
  // ours). Shown as a recovery panel with a next step, not as a bare error.
  const [staleDraft, setStaleDraft] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const active = Math.min(activeTab, store.courts.length - 1);

  // The venue's sports (step 1) are what a court can be; an old draft's court may name a sport the venue no longer
  // lists, so snap it to the venue's first sport once, on arrival.
  useEffect(() => {
    const { sports, courts } = useVenueSetupStore.getState();
    if (sports.length === 0) return;
    const fixed = courts.map((c) => (sports.some((s) => s.toLowerCase() === c.sport.toLowerCase()) ? c : { ...c, sport: sports[0] }));
    if (fixed.some((c, i) => c !== courts[i])) useVenueSetupStore.getState().setField("courts", fixed);
  }, []);

  // Each court is valid on its own: a name, usable hours (closing at/before opening, e.g. 06:00 -> 02:00, used to reach the
  // API, 500, and surface as "Can't reach the server"), and a price.
  const courtProblems = store.courts.map((c) => (c.name.trim() ? courtSetupProblem(c) : "Give this court a name."));
  const isValid = store.courts.length > 0 && courtProblems.every((p) => p === null);

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    setStaleDraft(false);
    // Ids read from the saved draft (as opposed to created during this run) are the only ones
    // whose failure can mean "stale draft" -- see isStaleVenueDraftError.
    const draftHadVenue = !!store.createdVenueId;
    const draftCourtIds = { ...store.createdCourtIds };
    try {
      // Same idempotency pattern as mobile: remember the venue once POST /venues succeeds, so a
      // retry after a later step fails doesn't create a duplicate venue.
      let venueId = store.createdVenueId;
      if (!venueId) {
        const { venue } = await api.venues.create({
          name: store.name,
          address: store.address,
          city: store.city,
          area: store.area || undefined,
          latitude: store.latitude!,
          longitude: store.longitude!,
          whatsapp: store.whatsapp || undefined,
          sports: store.sports,
          amenities: store.amenities ?? [],
          // one cancellation policy for the whole venue (Section 32 Part 4)
          cancellation_allowed: store.cancellationAllowed,
          cancellation_cutoff_hours:
            store.cancellationAllowed && store.cancellationCutoffHours.trim() ? Number(store.cancellationCutoffHours) : null,
          bank_details:
            store.bankName && store.accountTitle && store.accountNumber
              ? { bank: store.bankName, account_title: store.accountTitle, account_number: store.accountNumber }
              : undefined,
        });
        venueId = venue.id;
        store.setField("createdVenueId", venueId);
      }

      // A tab the owner deleted after its court was already created: deactivate that court so it doesn't linger.
      for (const orphanId of [...(store.orphanCourtIds ?? [])]) {
        try {
          await api.courts.deactivate(orphanId);
        } catch (e) {
          if (!isStaleVenueDraftError(e)) throw e; // already gone is fine
        }
        store.setField("orphanCourtIds", useVenueSetupStore.getState().orphanCourtIds.filter((id) => id !== orphanId));
      }

      // Resumable: courtId is reused from a prior attempt when we have one (POST /courts
      // always inserts, so re-running it for an already-created court would duplicate the
      // row) -- setSchedule/setPricing are safe to re-run unconditionally either way (the
      // backend replaces, not appends), so a retry that's already fully done just redoes
      // those two harmlessly and reaches the end.
      for (let i = 0; i < store.courts.length; i++) {
        const court = store.courts[i];
        let courtId = store.createdCourtIds[i];
        if (!courtId) {
          const { court: created } = await api.courts.create(venueId, {
            name: court.name,
            sport: court.sport,
            slot_minutes: court.slotMinutes,
            is_indoor: !!court.isIndoor,
          });
          courtId = created.id;
          store.setCreatedCourtId(i, courtId);
        } else {
          // created by an earlier attempt: bring it up to date with whatever the owner has edited since
          await api.courts.update(courtId, { name: court.name, sport: court.sport, slot_minutes: court.slotMinutes, is_indoor: !!court.isIndoor });
        }
        // each court gets ITS OWN hours and prices
        await api.courts.setSchedule(courtId, buildSchedules(court));
        await api.courts.setPricing(courtId, buildPricingRules(court));
      }

      store.reset();
      await queryClient.invalidateQueries({ queryKey: ["owner-venues"] });
      router.replace(`/venue-setup/status?venueId=${venueId}`);
    } catch (e) {
      if (isStaleVenueDraftError(e) && (draftHadVenue || Object.keys(draftCourtIds).length > 0)) {
        // Clear the stale ids right away so a reload can't loop back into the same failure.
        store.setField("createdVenueId", null);
        store.setField("createdCourtIds", {});
        store.setField("orphanCourtIds", []);
        setStaleDraft(true);
      } else {
        setError(friendlyErrorMessage(e));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Stepper current={2} />
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[26px] font-bold tracking-tight">Your courts and prices</h1>
        <p className="text-owner-ink-muted text-[15px]">Each court has its own slot length, opening hours and prices. We build its schedule from them.</p>
      </div>

      <SectionLabel>Courts</SectionLabel>
      <CourtTabs
        count={store.courts.length}
        active={active}
        onSelect={setActiveTab}
        onAdd={() => {
          store.addCourt();
          setActiveTab(store.courts.length); // the new tab is appended, so it sits at the old length
        }}
        canDelete={store.courts.length > 1}
        onDelete={() => {
          const court = store.courts[active];
          if (courtHasData(court, active) && !window.confirm(`Delete "${court.name}"? Everything you entered for it will be lost.`)) return;
          store.removeCourt(active);
          setActiveTab(Math.max(0, active - 1));
        }}
      />

      {store.courts.map((court, index) =>
        index === active ? (
          <div key={index} className="flex flex-col gap-4" data-testid={`court-${index + 1}`}>
            <CourtBasicsFields
              name={court.name}
              sport={court.sport}
              isIndoor={!!court.isIndoor}
              sportOptions={store.sports}
              onChange={(patch) => store.updateCourt(index, patch)}
              note={index > 0 ? "This court started as a copy of the one before it. Change anything below that is different for this court." : undefined}
            />
            <CourtSetupFields value={court} onChange={(patch) => store.updateCourt(index, patch)} />
          </div>
        ) : null,
      )}

      {courtProblems.some((p) => p !== null) ? (
        <p className="text-[12.5px] font-medium text-owner-warn" data-testid="court-problems">
          {courtProblems.map((p, i) => (p ? `Court ${i + 1}: ${p}` : null)).filter(Boolean).join(" · ")}
        </p>
      ) : null}

      {staleDraft ? (
        <div role="alert" className="rounded-[10px] bg-owner-danger-soft border border-owner-danger-soft-border px-4 py-3 flex flex-col gap-3">
          <p className="text-owner-danger text-[13.5px] font-semibold">
            Your previous session for this venue has expired. Let&apos;s start fresh.
          </p>
          <button
            type="button"
            onClick={() => {
              store.reset();
              setStaleDraft(false);
              router.replace("/venue-setup/register");
            }}
            className="self-start min-h-10 px-4 rounded-lg bg-owner-accent text-white text-[13.5px] font-semibold"
          >
            Start fresh
          </button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-[10px] bg-owner-danger-soft border border-owner-danger-soft-border text-owner-danger text-[13.5px] font-semibold px-4 py-3">
          Couldn&apos;t send for review: {error}
        </p>
      ) : null}

      <p className="text-[13px] font-medium text-owner-ink-faint">We&apos;ll review it and come back to you within a day.</p>
      <div className="flex gap-3">
        <SecondaryButton label="Back" onClick={() => router.back()} />
        <PrimaryButton label="Send for review" ready={isValid} busy={submitting} onClick={handleSubmit} />
      </div>
    </>
  );
}
