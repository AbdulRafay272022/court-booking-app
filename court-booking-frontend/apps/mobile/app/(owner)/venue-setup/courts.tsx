import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { isStaleVenueDraftError } from "@court-booking/api-client";
import { buildPricingRules, buildSchedules, courtSetupProblem } from "@court-booking/types";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { isCourtPristine, useVenueSetupStore } from "@/lib/venue-setup-store";
import { confirmAction } from "@/lib/confirm";
import { findSport } from "@/lib/sport";
import { CourtSetupFields } from "@/components/court-setup-fields";
import { CourtIdentityFields } from "@/components/court-identity-fields";
import { CourtTabs } from "@/components/court-tabs";
import { courtLabel } from "@/components/court-label";
import { PrimaryButton, SecondaryButton } from "./_components";

export default function VenueCourtsScreen() {
  const store = useVenueSetupStore();
  const [submitting, setSubmitting] = useState(false);
  // Section 31 Part 2: the saved draft pointed at a venue/court that no longer exists (or isn't
  // ours). Shown as a recovery panel with a next step, not as a bare error alert.
  const [staleDraft, setStaleDraft] = useState(false);
  const [selected, setSelected] = useState(0);
  const tabIndex = Math.min(selected, store.courts.length - 1);

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
    const p = c.name.trim() ? courtSetupProblem(c) : "Give this court a name.";
    return p ? `Court ${i + 1}: ${p}` : null;
  });
  const firstProblem = courtProblems.find((p) => p !== null) ?? null;
  const problemTab = courtProblems.findIndex((p) => p !== null);
  const isValid = store.courts.length > 0 && firstProblem === null;

  async function handleSubmit() {
    if (!isValid) {
      if (problemTab >= 0) setSelected(problemTab);
      Alert.alert("Almost there", firstProblem ?? "Add at least one court and a price for it before sending for review.");
      return;
    }
    setSubmitting(true);
    setStaleDraft(false);
    // Ids read from the saved draft (as opposed to created during this run) are the only ones
    // whose failure can mean "stale draft" -- see isStaleVenueDraftError.
    const draftHadVenue = !!store.createdVenueId;
    const draftCourtIds = { ...store.createdCourtIds };
    try {
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
          });
          courtId = created.id;
          store.setCreatedCourtId(i, courtId);
        } else {
          // Already created by an earlier attempt: bring it up to date with any edits made since (PATCH, never a re-create).
          await api.courts.update(courtId, { name: court.name, sport: court.sport, slot_minutes: court.slotMinutes, is_indoor: court.isIndoor });
        }
        // each court gets ITS OWN hours and prices
        await api.courts.setSchedule(courtId, buildSchedules(court));
        await api.courts.setPricing(courtId, buildPricingRules(court));
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
        Alert.alert("Couldn't send for review", friendlyErrorMessage(e));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-owner-bg" edges={["top", "bottom"]}>
      <ScrollView className="flex-1" contentContainerClassName="px-6 pt-4 pb-8 gap-5">
        <View className="gap-1.5">
          <Text className="font-plex-bold text-owner-ink text-[26px] tracking-tight">
            Your courts and prices
          </Text>
          <Text className="font-plex-medium text-owner-ink-muted text-[15px]">
            Each court has its own slot length, opening hours and prices. We build its schedule from them.
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
            {courtProblems[tabIndex] ? (
              <Text className="font-plex-medium text-owner-warn text-[12.5px]">{courtProblems[tabIndex]}</Text>
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
                <Text className="font-plex-semibold text-owner-danger text-[13.5px]">Delete this court</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {staleDraft ? (
          <View className="rounded-[10px] bg-owner-danger-soft border border-owner-danger-soft-border px-4 py-3 gap-3">
            <Text className="font-plex-semibold text-owner-danger text-[13.5px]">
              Your previous session for this venue has expired. Let's start fresh.
            </Text>
            <Pressable
              onPress={() => {
                store.reset();
                setStaleDraft(false);
                router.replace("/(owner)/venue-setup/register");
              }}
              className="self-start min-h-10 px-4 rounded-lg bg-owner-accent items-center justify-center"
            >
              <Text className="font-plex-semibold text-white text-[13.5px]">Start fresh</Text>
            </Pressable>
          </View>
        ) : null}

        <Text className="font-plex-medium text-owner-ink-faint text-[13px]">
          We'll review it and come back to you within a day.
        </Text>
        <View className="flex-row gap-3">
          <SecondaryButton label="Back" onPress={() => router.back()} />
          <View className="flex-1">
            <PrimaryButton label="Send for review" onPress={handleSubmit} loading={submitting} disabled={!isValid} />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
