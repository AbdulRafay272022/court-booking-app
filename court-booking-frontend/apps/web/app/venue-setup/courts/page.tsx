"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { isStaleVenueDraftError } from "@court-booking/api-client";
import { buildPricingRules, buildSchedules, courtSetupProblem, defaultCourtSetup } from "@court-booking/types";
import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useT } from "@/components/i18n/lang-provider";
import { useFmt } from "@/lib/use-fmt";
import { useVenueSetupStore, type CourtDraft } from "@/lib/venue-setup-store";
import { PrimaryButton, SecondaryButton, SectionLabel, Stepper } from "@/components/setup/ui";
import { CourtSetupFields } from "@/components/setup/court-setup-fields";
import { CourtBasicsFields } from "@/components/setup/court-basics-fields";
import { CourtTabs } from "@/components/setup/court-tabs";
import { AdvanceRuleFields } from "@/components/setup/advance-rule-fields";
import { advanceDraftErrors, basePriceFromDrafts } from "@/components/setup/advance-preview";
import { advanceApiFields, useAdvanceDraftStore } from "@/components/setup/advance-draft-store";
import { VenueTimersFields, timerErrorMessage } from "@/components/setup/venue-timers-card";
import { useTimerDraftStore } from "@/components/setup/timer-draft-store";
import { draftHasValues, validateTimers, valuesFromDraft } from "@/components/setup/venue-timers";
import { slotMinutesDefault } from "@/components/settings/hint-state";
import { useLang } from "@/components/i18n/lang-provider";
import { WizardIdentityStep } from "@/components/identity/wizard-identity-step";
import { useOwnerIdentity } from "@/components/identity/identity-card";
import { useIdentityDraftStore } from "@/components/identity/identity-draft-store";
import { identityDraftReady } from "@/components/identity/cnic-fields";
import { identityErrorMessage } from "@/components/identity/identity-errors";

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

/** A failure after the venue exists whose message is already written for the owner (timers / CNIC). */
class WizardStepError extends Error {}

export default function VenueCourtsPage() {
  const router = useRouter();
  const t = useT();
  const fmt = useFmt();
  const queryClient = useQueryClient();
  const store = useVenueSetupStore();
  const advance = useAdvanceDraftStore();
  const lang = useLang();
  const timers = useTimerDraftStore();
  const identityDraft = useIdentityDraftStore();
  const identity = useOwnerIdentity();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);
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
  const courtProblems = store.courts.map((c) => (c.name.trim() ? courtSetupProblem(c) : t("setup.courts.needName")));
  // Round 2 A11: a typed advance must be usable (percentage 0-100, amounts 0 or more) before the courts are sent.
  const advanceOk = store.courts.every((_, i) => {
    const e = advanceDraftErrors(advance.get(i));
    return !e.value && !e.minimum;
  });
  // Stage 2: the venue timers (wizard "Advanced") must be in range before they are sent.
  const timersOk = Object.keys(validateTimers(timers.timers, lang).errors).length === 0;
  // Stage 2: a CNIC is required before "Send for review" unless this owner already submitted one. If the status cannot be
  // read (older backend / network), the step still asks for it and the send fails clearly rather than skipping it.
  const identityOnFile = identity.data ? identity.data.status !== "missing" : false;
  const identityOk = identityOnFile || identityDraftReady(identityDraft);
  const isValid = store.courts.length > 0 && courtProblems.every((p) => p === null) && advanceOk && timersOk && identityOk;

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    setStepError(null);
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
            ...advanceApiFields(advance.get(i)),
          });
          courtId = created.id;
          store.setCreatedCourtId(i, courtId);
        } else {
          // created by an earlier attempt: bring it up to date with whatever the owner has edited since
          await api.courts.update(courtId, {
            name: court.name,
            sport: court.sport,
            slot_minutes: court.slotMinutes,
            is_indoor: !!court.isIndoor,
            ...advanceApiFields(advance.get(i)),
          });
        }
        // each court gets ITS OWN hours and prices
        await api.courts.setSchedule(courtId, buildSchedules(court));
        await api.courts.setPricing(courtId, buildPricingRules(court));
      }

      // Stage 2: the venue timers exist only in the draft until now. PUT is idempotent, so a retry just sends them again.
      if (draftHasValues(useTimerDraftStore.getState().timers)) {
        try {
          await api.owners.updateVenueTimers(venueId, valuesFromDraft(useTimerDraftStore.getState().timers));
        } catch (e) {
          throw new WizardStepError(t("set2.wizard.timersFailed", { error: timerErrorMessage(e, t) }));
        }
      }

      // Stage 2: the CNIC (kept in memory only) goes right after the venue exists, before review. Skipped when already on file.
      const idDraft = useIdentityDraftStore.getState();
      if (!identityOnFile && idDraft.front && idDraft.back) {
        try {
          const res = await api.owners.submitIdentity(idDraft.number, idDraft.front, idDraft.back);
          queryClient.setQueryData(["owner-identity"], res);
        } catch (e) {
          throw new WizardStepError(t("cnic.wizard.failed", { error: identityErrorMessage(e, t) }));
        }
      }

      store.reset();
      advance.reset();
      timers.reset();
      useIdentityDraftStore.getState().clear();
      await queryClient.invalidateQueries({ queryKey: ["owner-venues"] });
      router.replace(`/venue-setup/status?venueId=${venueId}`);
    } catch (e) {
      if (isStaleVenueDraftError(e) && (draftHadVenue || Object.keys(draftCourtIds).length > 0)) {
        // Clear the stale ids right away so a reload can't loop back into the same failure.
        store.setField("createdVenueId", null);
        store.setField("createdCourtIds", {});
        store.setField("orphanCourtIds", []);
        setStaleDraft(true);
      } else if (e instanceof WizardStepError) {
        setStepError(e.message);
      } else {
        setError(friendlyErrorMessage(e, t));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Stepper current={2} />
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[26px] font-bold tracking-tight">{t("setup.courts.title")}</h1>
        <p className="text-owner-ink-muted text-[15px]">{t("setup.courts.subtitle")}</p>
      </div>

      <SectionLabel>{t("setup.tabs.aria")}</SectionLabel>
      <CourtTabs
        count={store.courts.length}
        active={active}
        onSelect={setActiveTab}
        onAdd={() => {
          advance.copyTo(store.courts.length - 1, store.courts.length);
          store.addCourt();
          setActiveTab(store.courts.length); // the new tab is appended, so it sits at the old length
        }}
        canDelete={store.courts.length > 1}
        onDelete={() => {
          const court = store.courts[active];
          if (courtHasData(court, active) && !window.confirm(t("setup.courts.confirmDelete", { name: court.name }))) return;
          store.removeCourt(active);
          advance.remove(active);
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
              note={index > 0 ? t("setup.courts.copyNote") : undefined}
            />
            <CourtSetupFields
              value={court}
              onChange={(patch) => store.updateCourt(index, patch)}
              defaultSlotMinutes={slotMinutesDefault("wizard")}
            />
            <AdvanceRuleFields
              {...advance.get(index)}
              onChange={(patch) => advance.update(index, patch)}
              unitPrice={basePriceFromDrafts(court.pricingRules)}
              unitMinutes={court.slotMinutes}
              defaultPercentage={null}
            />
          </div>
        ) : null,
      )}

      {courtProblems.some((p) => p !== null) ? (
        <p className="text-[12.5px] font-medium text-owner-warn" data-testid="court-problems">
          {courtProblems.map((p, i) => (p ? t("setup.courts.problem", { n: i + 1, problem: fmt.validation(p) }) : null)).filter(Boolean).join(" · ")}
        </p>
      ) : null}

      {staleDraft ? (
        <div role="alert" className="rounded-[10px] bg-owner-danger-soft border border-owner-danger-soft-border px-4 py-3 flex flex-col gap-3">
          <p className="text-owner-danger text-[13.5px] font-semibold">
            {t("setup.courts.stale")}
          </p>
          <button
            type="button"
            onClick={() => {
              store.reset();
              advance.reset();
              timers.reset();
              setStaleDraft(false);
              router.replace("/venue-setup/register");
            }}
            className="self-start min-h-10 px-4 rounded-lg bg-owner-accent text-white text-[13.5px] font-semibold"
          >
            {t("setup.courts.startFresh")}
          </button>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-[10px] bg-owner-danger-soft border border-owner-danger-soft-border text-owner-danger text-[13.5px] font-semibold px-4 py-3">
          {t("setup.courts.sendFailed", { error })}
        </p>
      ) : null}
      {stepError ? (
        <p role="alert" data-testid="wizard-step-error" className="rounded-[10px] bg-owner-danger-soft border border-owner-danger-soft-border text-owner-danger text-[13.5px] font-semibold px-4 py-3">
          {stepError}
        </p>
      ) : null}

      {/* Stage 2: same timers fields as Venue Settings (parity), tucked under "Advanced"; PUT right after the venue is created. */}
      <details className="group rounded-2xl border border-owner-border bg-owner-surface" data-testid="wizard-advanced">
        <summary className="cursor-pointer list-none min-h-11 px-5 py-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fl-night">
          <span className="text-[14.5px] font-bold text-owner-ink">{t("timer.advanced")}</span>
          <span className="text-[12.5px] text-owner-ink-faint">{t("timer.advancedHint")}</span>
        </summary>
        <div className="px-2 pb-2 sm:px-3 sm:pb-3">
          <section className="bg-owner-surface border border-owner-border rounded-2xl p-5 sm:p-6 flex flex-col gap-4">
            <VenueTimersFields draft={timers.timers} onChange={timers.setTimers} />
          </section>
        </div>
      </details>

      <WizardIdentityStep identity={identity.data ?? null} />

      <p className="text-[13px] font-medium text-owner-ink-faint">{t("setup.courts.reviewNote")}</p>
      <div className="flex flex-col-reverse gap-3 sm:flex-row">
        <SecondaryButton label={t("setup.back")} onClick={() => router.back()} />
        <PrimaryButton label={t("setup.courts.send")} ready={isValid} busy={submitting} onClick={handleSubmit} />
      </div>
    </>
  );
}
