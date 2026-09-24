import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  buildPricingRules,
  buildSchedules,
  courtSetupFromCourt,
  courtSetupProblem,
  pktInstant,
  type Court,
  type CourtSetup,
} from "@court-booking/types";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { formatWhen } from "@/lib/format";
import { ChevronLeftIcon } from "@/components/icons";
import { ErrorState } from "@/components/error-state";
import { DayPicker, TimeField12 } from "@/components/time-fields";
import { CancellationPolicyFields, CourtSetupFields } from "@/components/court-setup-fields";
import { PhotoManager } from "@/components/photo-manager";
import { FieldLabel, PrimaryButton, SectionCard, SectionLabel, TextField } from "./venue-setup/_components";
import { Tab } from "./_dashboard-components";

export default function VenueSettingsScreen() {
  const { activeVenue, isLoading: venuesLoading } = useOwnerVenues();
  const courts = activeVenue?.courts ?? [];
  const [courtId, setCourtId] = useState<string | undefined>(undefined);
  const activeCourtId = courtId ?? courts[0]?.id;

  const courtQuery = useQuery({
    queryKey: ["court-settings", activeCourtId],
    queryFn: () => api.courts.get(activeCourtId!),
    enabled: !!activeCourtId,
  });
  // The app's query client keeps the PREVIOUS query's data while a new one loads (placeholderData), so right after
  // switching court `courtQuery.data` is still the OLD court. A form seeded from it would hold the wrong court's hours
  // and prices, and saving would overwrite this court with them. Only treat the data as ready once it is this court's.
  const court = courtQuery.data && courtQuery.data.id === activeCourtId ? (courtQuery.data as Court) : undefined;
  const loading = venuesLoading || courtQuery.isLoading || (!!activeCourtId && !court && !courtQuery.isError);

  return (
    <SafeAreaView className="flex-1 bg-owner-bg" edges={["top", "bottom"]}>
      <View className="px-4.5 py-5 bg-owner-surface border-b border-owner-border flex-row items-center gap-3">
        <Pressable onPress={() => router.back()} className="w-11 h-11 rounded-[10px] bg-owner-bg items-center justify-center">
          <ChevronLeftIcon />
        </Pressable>
        <Text className="font-plex-bold text-owner-ink text-[16.5px] -tracking-[0.2px] flex-1">Venue settings</Text>
      </View>

      {courts.length > 1 ? (
        <View className="px-4.5 py-3 bg-owner-surface border-b border-owner-border flex-row gap-1.5">
          {courts.map((c) => (
            <Tab key={c.id} label={c.name} selected={activeCourtId === c.id} onPress={() => setCourtId(c.id)} />
          ))}
        </View>
      ) : null}

      <ScrollView className="flex-1" contentContainerClassName="px-4.5 pt-4 pb-8 gap-4">
        {/* ONE cancellation policy for the whole venue (Section 32 Part 4), so it sits above the per-court settings. */}
        {activeVenue ? (
          <VenueCancellationCard
            key={activeVenue.id}
            venueId={activeVenue.id}
            initialAllowed={activeVenue.cancellation_allowed}
            initialCutoff={activeVenue.cancellation_cutoff_hours}
          />
        ) : null}

        {activeVenue ? (
          <VenuePhotosCard
            key={`photos-${activeVenue.id}`}
            venueId={activeVenue.id}
            photoUrls={activeVenue.photo_urls}
            photoKeys={activeVenue.photo_keys}
          />
        ) : null}

        {loading ? (
          <View className="py-10 items-center justify-center">
            <ActivityIndicator color="#0E6274" />
          </View>
        ) : courtQuery.isError ? (
          <ErrorState message={friendlyErrorMessage(courtQuery.error)} onRetry={() => courtQuery.refetch()} tone="owner" />
        ) : !activeCourtId || !court ? (
          <Text className="font-plex-medium text-owner-ink-faint text-center py-10">No courts yet — add one from venue setup first.</Text>
        ) : (
          <>
            {/* keyed by court so switching court re-seeds the form from that court (no effect needed) */}
            <CourtSettingsForm key={court.id} court={court} />
            <CourtPhotosCard key={`court-photos-${court.id}`} court={court} />
            <BlackoutsCard key={`blackouts-${activeCourtId}`} courtId={activeCourtId} />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function VenueCancellationCard({ venueId, initialAllowed, initialCutoff }: { venueId: string; initialAllowed: boolean; initialCutoff: number | null }) {
  const queryClient = useQueryClient();
  const [allowed, setAllowed] = useState(initialAllowed);
  const [cutoff, setCutoff] = useState(initialCutoff != null ? String(initialCutoff) : "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await api.venues.update(venueId, {
        cancellation_allowed: allowed,
        cancellation_cutoff_hours: allowed && cutoff.trim() ? Number(cutoff) : null,
      });
      // players see this policy before they pay, and the owner lists read it too
      await queryClient.invalidateQueries({ queryKey: ["owner-venues"] });
      Alert.alert("Saved", "Cancellation policy updated for every court.");
    } catch (e) {
      Alert.alert("Couldn't save", friendlyErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View className="gap-3">
      <CancellationPolicyFields allowed={allowed} cutoffHours={cutoff} onAllowedChange={setAllowed} onCutoffChange={setCutoff} />
      <PrimaryButton label="Save cancellation policy" onPress={save} loading={saving} />
    </View>
  );
}

/** Slot length, hours and prices for ONE court. Seeded once from the court it is mounted for (the parent keys it by
 * court id), so it holds its own edits and never needs an effect to copy server data into state. */
function CourtSettingsForm({ court }: { court: Court }) {
  const queryClient = useQueryClient();
  const [setup, setSetup] = useState<CourtSetup>(() => courtSetupFromCourt(court));
  const [saving, setSaving] = useState(false);
  const problem = courtSetupProblem(setup);

  async function save() {
    if (problem) {
      Alert.alert("Check this court", problem);
      return;
    }
    setSaving(true);
    try {
      if (setup.slotMinutes !== court.slot_minutes) await api.courts.update(court.id, { slot_minutes: setup.slotMinutes });
      await api.courts.setSchedule(court.id, buildSchedules(setup));
      await api.courts.setPricing(court.id, buildPricingRules(setup));
      await queryClient.invalidateQueries({ queryKey: ["court-settings", court.id] });
      await queryClient.invalidateQueries({ queryKey: ["court", court.id] });
      await queryClient.invalidateQueries({ queryKey: ["owner-venues"] });
      Alert.alert("Saved", `${court.name}: slot length, hours and prices updated.`);
    } catch (e) {
      Alert.alert("Couldn't save", friendlyErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Text className="font-plex-bold text-owner-ink text-[17px]">{court.name}</Text>
      <CourtSetupFields value={setup} onChange={(patch) => setSetup((s) => ({ ...s, ...patch }))} slotChangeNote />
      <PrimaryButton label="Save changes" onPress={save} loading={saving} />
    </>
  );
}

function VenuePhotosCard({ venueId, photoUrls, photoKeys }: { venueId: string; photoUrls: string[]; photoKeys: string[] }) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["owner-venues"] });
  return (
    <PhotoManager
      title="Venue photos"
      photoUrls={photoUrls}
      photoKeys={photoKeys}
      max={8}
      onUpload={async (uri) => {
        await api.venues.uploadPhoto(venueId, uri);
        await refresh();
      }}
      onReorder={async (keys) => {
        await api.venues.reorderPhotos(venueId, keys);
        await refresh();
      }}
    />
  );
}

function CourtPhotosCard({ court }: { court: Court }) {
  const queryClient = useQueryClient();
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["court-settings", court.id] });
    await queryClient.invalidateQueries({ queryKey: ["owner-venues"] });
  };
  return (
    <PhotoManager
      title={`${court.name} photos`}
      photoUrls={court.photo_urls}
      photoKeys={court.photo_keys}
      max={5}
      onUpload={async (uri) => {
        await api.courts.uploadPhoto(court.id, uri);
        await refresh();
      }}
      onReorder={async (keys) => {
        await api.courts.reorderPhotos(court.id, keys);
        await refresh();
      }}
    />
  );
}

function BlackoutsCard({ courtId }: { courtId: string }) {
  const queryClient = useQueryClient();
  const blackoutsQuery = useQuery({
    queryKey: ["court-blackouts", courtId],
    queryFn: () => api.courts.listBlackouts(courtId),
  });
  const [title, setTitle] = useState("");
  // A date (Pakistan calendar) plus a 12-hour time for each end; sent as real instants via pktInstant().
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("06:00");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("23:00");
  const [adding, setAdding] = useState(false);

  async function add() {
    if (!startDate || !endDate) {
      Alert.alert("Missing dates", "Pick a start and end date/time for the blackout.");
      return;
    }
    setAdding(true);
    try {
      await api.courts.addBlackout(courtId, {
        title: title || undefined,
        starts_at: pktInstant(startDate, startTime).toISOString(),
        ends_at: pktInstant(endDate, endTime).toISOString(),
      });
      setTitle("");
      setStartDate("");
      setEndDate("");
      await queryClient.invalidateQueries({ queryKey: ["court-blackouts", courtId] });
    } catch (e) {
      Alert.alert("Couldn't add blackout", friendlyErrorMessage(e));
    } finally {
      setAdding(false);
    }
  }

  return (
    <SectionCard>
      <SectionLabel>Blackout dates</SectionLabel>
      {(blackoutsQuery.data ?? []).length === 0 ? (
        <Text className="font-plex-medium text-owner-ink-faint text-[13px]">No blackout dates yet.</Text>
      ) : (
        (blackoutsQuery.data ?? []).map((b) => (
          <View key={b.id} className="border border-owner-border rounded-[10px] p-3">
            <Text className="font-plex-semibold text-owner-ink text-sm">{b.title ?? "Blocked"}</Text>
            <Text className="font-mono-medium text-owner-ink-faint text-xs mt-0.5">
              {formatWhen(b.starts_at)} to {formatWhen(b.ends_at)}
            </Text>
          </View>
        ))
      )}
      <View className="h-px bg-owner-border-light" />
      <FieldLabel>Add a blackout</FieldLabel>
      <TextField label="Title (optional)" value={title} onChangeText={setTitle} placeholder="Maintenance" />
      <DayPicker label="Starts on" value={startDate} onChange={setStartDate} />
      <TimeField12 label="Starts at" value={startTime} onChange={setStartTime} />
      <DayPicker label="Ends on" value={endDate} onChange={setEndDate} />
      <TimeField12 label="Ends at" value={endTime} onChange={setEndTime} />
      <PrimaryButton label="Add blackout" onPress={add} loading={adding} />
    </SectionCard>
  );
}
