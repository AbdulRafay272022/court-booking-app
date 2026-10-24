import { useEffect, useState } from "react";
import { Banner, Screen, Text, useToast } from "@/components/ui";
import { palette, radius, space } from "@court-booking/ui-tokens";

import { Pressable, View } from "react-native";
import { router } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { isStaleVenueDraftError } from "@court-booking/api-client";
import { buildPricingRules, buildSchedules, courtSetupProblem } from "@court-booking/types";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { isCourtPristine, useVenueSetupStore, type CourtDraft } from "@/lib/venue-setup-store";
import { confirmAction } from "@/lib/confirm";
import { findSport } from "@/lib/sport";
import { CourtSetupFields } from "@/components/court-setup-fields";
import { CourtIdentityFields } from "@/components/court-identity-fields";
import { CourtTabs } from "@/components/court-tabs";
import { courtLabel } from "@/components/court-label";
import {
  ADVANCE_DRAFT_DEFAULTS,
  AdvanceSettings,
  advanceDraftProblem,
  advanceDraftToInput,
  advancePriceFromSetup,
  type AdvanceDraft,
} from "@/components/advance-settings";
import { RemindersCard } from "@/components/reminders-card";
import { CnicFields, submitCnicDraft, useCnicDraft } from "@/components/cnic-form";
import { cnicDraftComplete } from "@/components/cnic-logic";
import { OWNER_IDENTITY_KEY, useOwnerIdentity } from "@/components/identity-card";
import { timerDraftIsEmpty, timerDraftProblems, timerDraftToValues } from "@/lib/settings-defaults";
import { PrimaryButton, SecondaryButton, SectionCard, SectionLabel, WizardSteps } from "./_components";

/** A wizard court plus its A11 advance rule. The persisted draft store (lib/venue-setup-store.ts) spreads whatever fields a
 * court carries, so the advance fields ride along in the saved draft; a court from an older draft simply has none
 * (= the shared defaults, Default from pricing). */
type CourtWithAdvance = CourtDraft & Partial<AdvanceDraft>;
function advanceOf(c: CourtDraft): AdvanceDraft {
  const a = c as CourtWithAdvance;
  return {
    advanceType: a.advanceType ?? ADVANCE_DRAFT_DEFAULTS.advanceType,
    advanceValue: a.advanceValue ?? ADVANCE_DRAFT_DEFAULTS.advanceValue,
    advanceMinimum: a.advanceMinimum ?? ADVANCE_DRAFT_DEFAULTS.advanceMinimum,
  };
}

export default function VenueCourtsScreen() {
  const store = useVenueSetupStore();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const toast = useToast();
  // Section 31 Part 2: the saved draft pointed at a venue/court that no longer exists (or isn't
  // ours). Shown as a recovery panel with a next step, not as a bare error alert.
  const [staleDraft, setStaleDraft] = useState(false);
  const [selected, setSelected] = useState(0);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const tabIndex = Math.min(selected, store.courts.length - 1);
  const queryClient = useQueryClient();
  // Stage 2: the owner's CNIC is required before "Send for review" unless one is already on file (e.g. a second venue).
  // Kept in memory only (useCnicDraft), never in the persisted wizard draft.
  const identityQuery = useOwnerIdentity();
  const cnicOnFile = identityQuery.data?.status === "submitted" || identityQuery.data?.status === "verified";
  const cnic = useCnicDraft();
  const cnicProblemText = cnicOnFile || cnicDraftComplete(cnic) ? null : "CNIC number aur card ki dono taraf ki photo dein.";
  const timersHaveErrors = Object.keys(timerDraftProblems(store.timers).errors).length > 0;

  // A court whose sport isn't one the venue offers (e.g. the default "Padel" on a Futsal-only venue) starts on the venue's
  // first sport instead of an unselected chip row.
  useEffect(() => {
    if (store.sports.length === 0) return;
    store.courts.forEach((c, i) => {
      if (!findSport(store.sports, c.sport)) store.updateCourt(i, { sport: store.sports[0] });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.sports.join("|"), store.courts.length]);

  // Each court is valid on its own: a name, usable hours (closing at/before opening, e.g. 06:00 -> 02:00, used to reach the
  // API, 500, and surface as a "network" error), and a price.
  const courtProblems = store.courts.map((c, i) => {
    const p = c.name.trim() ? (courtSetupProblem(c) ?? advanceDraftProblem(advanceOf(c))) : "Give this court a name.";
    return p ? `Court ${i + 1}: ${p}` : null;
  });
  const firstCourtProblem = courtProblems.find((p) => p !== null) ?? null;
  const firstProblem =
    firstCourtProblem ?? (timersHaveErrors ? "Advanced: reminder settings theek karein." : null) ?? cnicProblemText;
  const problemTab = courtProblems.findIndex((p) => p !== null);
  const isValid = store.courts.length > 0 && firstProblem === null;

  async function handleSubmit() {
    setSubmitError(null);
    if (!isValid) {
      if (problemTab >= 0) setSelected(problemTab);
      setSubmitError(firstProblem ?? "Kam se kam ek court aur us ki qeemat dalein.");
      return;
    }
    setSubmitting(true);
    setStaleDraft(false);
    // Ids read from the saved draft (as opposed to created during this run) are the only ones
    // whose failure can mean "stale draft" -- see isStaleVenueDraftError.
    const draftHadVenue = !!store.createdVenueId;
    const draftCourtIds = { ...store.createdCourtIds };
    try {
      // CNIC first: it belongs to the owner, not the venue, so a wrong number (422 CNIC_INVALID) stops here before
      // anything is created. Once accepted it is on file, so a retry after a later failure skips it.
      if (!cnicOnFile) {
        const identity = await submitCnicDraft(useCnicDraft.getState());
        queryClient.setQueryData(OWNER_IDENTITY_KEY, identity);
      }
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
          amenities: store.amenities,
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

      // Resumable: courtId is reused from a prior attempt when we have one (POST /courts
      // always inserts, so re-running it for an already-created court would duplicate the
      // row) -- setSchedule/setPricing are safe to re-run unconditionally either way (the
      // backend replaces, not appends), so a retry that's already fully done just redoes
      // those two harmlessly and reaches the end.
      // A tab deleted after an earlier partial submit may already exist on the server: deactivate it so it does not linger.
      for (const orphanId of store.removedCreatedCourtIds) {
        try {
          await api.courts.deactivate(orphanId);
        } catch {
          // already gone / not ours -- nothing more to do for a court the owner removed
        }
      }
      store.setField("removedCreatedCourtIds", []);

      // createdCourtIds is index -> server id and is kept in step with tab removal by the store (removeCourt re-keys it),
      // so index i here is always the same court the id was issued for.
      for (let i = 0; i < store.courts.length; i++) {
        const court = store.courts[i];
        let courtId = useVenueSetupStore.getState().createdCourtIds[i];
        if (!courtId) {
          const { court: created } = await api.courts.create(venueId, {
            name: court.name,
            sport: court.sport,
            slot_minutes: court.slotMinutes,
            is_indoor: court.isIndoor,
            ...advanceDraftToInput(advanceOf(court)),
          });
          courtId = created.id;
          store.setCreatedCourtId(i, courtId);
        } else {
          // Already created by an earlier attempt: bring it up to date with any edits made since (PATCH, never a re-create).
          await api.courts.update(courtId, {
            name: court.name,
            sport: court.sport,
            slot_minutes: court.slotMinutes,
            is_indoor: court.isIndoor,
            ...advanceDraftToInput(advanceOf(court)),
          });
        }
        // each court gets ITS OWN hours and prices
        await api.courts.setSchedule(courtId, buildSchedules(court));
        await api.courts.setPricing(courtId, buildPricingRules(court));
      }

      // Stage 2: the "Advanced" timers. Nothing set = nothing to send (a new venue is all-default already). The venue is
      // already created at this point, so a failure here must not block the hand-off: say where to set them again.
      const timers = useVenueSetupStore.getState().timers;
      if (!timerDraftIsEmpty(timers)) {
        try {
          await api.owners.updateVenueTimers(venueId, timerDraftToValues(timers));
        } catch (err) {
          // the venue is created: say it on the pending screen's way out (a toast survives the navigation)
          toast.show({ message: `Reminder settings save nahi huin: venue review ke liye bhej di gayi hai. Hold aur reminders Venue Settings mein dobara set karein. (${friendlyErrorMessage(err)})`, tone: "danger", duration: 8000 });
        }
      }

      const finishedVenueId = venueId;
      store.reset();
      router.replace({ pathname: "/(owner)/venue-setup/pending", params: { venueId: finishedVenueId } });
    } catch (e) {
      if (isStaleVenueDraftError(e) && (draftHadVenue || Object.keys(draftCourtIds).length > 0)) {
        // Clear the stale ids right away so a relaunch can't loop back into the same failure.
        store.setField("createdVenueId", null);
        store.setField("createdCourtIds", {});
        setStaleDraft(true);
      } else {
        setSubmitError(`Review ke liye nahi bheja ja saka: ${friendlyErrorMessage(e)}`);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen keyboard testID="wizard-courts">
      <WizardSteps current={1} />
        <View className="gap-1.5">
          <Text variant="h2">
            Your courts and prices
          </Text>
          <Text variant="body" tone="muted">
            Each court has its own minimum booking time, opening hours and prices. We build its schedule from them.
          </Text>
        </View>

        <CourtTabs
          tabs={store.courts.map((c, i) => ({ key: String(i), label: courtLabel(c.name.trim() || `Court ${i + 1}`, c.sport) }))}
          selectedKey={String(tabIndex)}
          onSelect={(k) => setSelected(Number(k))}
          onAdd={() => {
            const newIndex = store.courts.length; // index the new tab will get
            store.addCourt();
            setSelected(newIndex);
          }}
        />

        {store.courts[tabIndex] ? (
          <View key={tabIndex} className="gap-4">
            <CourtIdentityFields
              name={store.courts[tabIndex].name}
              sport={store.courts[tabIndex].sport}
              isIndoor={store.courts[tabIndex].isIndoor}
              sports={store.sports}
              onChange={(patch) => store.updateCourt(tabIndex, patch)}
            />
            <CourtSetupFields value={store.courts[tabIndex]} onChange={(patch) => store.updateCourt(tabIndex, patch)} />
            {/* A11: the same editor and defaults as Venue Settings; the court does not exist yet, so the default line is
                computed from the price typed above (pricing rules are created with advance_percentage 100). */}
            <AdvanceSettings
              value={advanceOf(store.courts[tabIndex])}
              onChange={(patch) => store.updateCourt(tabIndex, patch as Partial<CourtDraft>)}
              price={advancePriceFromSetup(store.courts[tabIndex])}
            />
            {courtProblems[tabIndex] ? (
              <Text variant="caption" tone="waiting">{courtProblems[tabIndex]}</Text>
            ) : null}
            {store.courts.length > 1 ? (
              <Pressable
                accessibilityLabel="Delete this court"
                onPress={() => {
                  const idx = tabIndex;
                  const court = store.courts[idx];
                  const doRemove = () => {
                    store.removeCourt(idx);
                    setSelected(Math.max(0, Math.min(idx, store.courts.length - 2)));
                  };
                  if (isCourtPristine(court, idx)) doRemove();
                  else
                    confirmAction({
                      title: `Delete "${court.name || `Court ${idx + 1}`}"?`,
                      message: "Its name, hours and prices will be discarded.",
                      confirmLabel: "Delete",
                      destructive: true,
                      onConfirm: doRemove,
                    });
                }}
                className="min-h-11 items-center justify-center"
              >
                <Text variant="meta" tone="danger" weight="bold">Delete this court</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {/* B1 preview under "Advanced" (same card as Venue Settings, pre-filled with today's values, not saved yet). */}
        <View className="gap-3">
          <Pressable
            onPress={() => setAdvancedOpen((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: advancedOpen }}
            accessibilityLabel="Advanced"
            style={{ minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: radius.md, backgroundColor: palette.white, paddingHorizontal: space[4] }}
          >
            <Text variant="body" weight="bold">Advanced</Text>
            <Text variant="meta" tone="link" weight="bold">{advancedOpen ? "Chhupayein" : "Dikhayein"}</Text>
          </Pressable>
          {advancedOpen ? <RemindersCard value={store.timers} onChange={(patch) => store.setField("timers", { ...store.timers, ...patch })} /> : null}
        </View>

        {/* Stage 2: CNIC, required before Send for review (unless already on file). Memory only, never saved in the draft. */}
        {cnicOnFile ? (
          <SectionCard>
            <SectionLabel>Shanakhti card (CNIC)</SectionLabel>
            <Text testID="wizard-cnic-on-file" variant="meta" tone="muted">
              Aap ka CNIC pehle se jama hai ({identityQuery.data?.masked ?? ""}). Badalna ho to Venue Settings mein badlein.
            </Text>
          </SectionCard>
        ) : (
          <SectionCard>
            <SectionLabel>Shanakhti card (CNIC)</SectionLabel>
            <Text variant="caption" tone="subtle">
              Venue review ke liye bhejne se pehle apna CNIC number aur card ki dono taraf ki photo dein.
            </Text>
            <CnicFields />
          </SectionCard>
        )}

        {staleDraft ? (
          <View style={{ borderRadius: radius.md, backgroundColor: palette.dangerTint, paddingHorizontal: space[4], paddingVertical: space[3], gap: space[3] }}>
            <Text variant="meta" tone="danger" weight="bold">
              Your previous session for this venue has expired. Let's start fresh.
            </Text>
            <Pressable
              onPress={() => {
                store.reset();
                setStaleDraft(false);
                router.replace("/(owner)/venue-setup/register");
              }}
              accessibilityRole="button"
              style={{ alignSelf: "flex-start", minHeight: 44, paddingHorizontal: space[4], borderRadius: radius.md, backgroundColor: palette.teal, alignItems: "center", justifyContent: "center" }}
            >
              <Text variant="meta" tone="onDark" weight="bold">Start fresh</Text>
            </Pressable>
          </View>
        ) : null}

        <Text variant="meta" tone="subtle">
          We'll review it and come back to you within a day.
        </Text>
        {!isValid && firstProblem ? <Banner tone="waiting" testID="wizard-submit-reason" body={`Bhejne se pehle: ${firstProblem}`} /> : null}
        {submitError ? <Banner tone="danger" body={submitError} /> : null}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[3] }}>
          <SecondaryButton label="Back" onPress={() => router.back()} />
          <PrimaryButton label="Send for review" onPress={handleSubmit} loading={submitting} disabled={!isValid} />
        </View>
    </Screen>
  );
}
