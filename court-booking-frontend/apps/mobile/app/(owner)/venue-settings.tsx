import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { palette, radius, space } from "@court-booking/ui-tokens";
import { Banner, ErrorState, Pill, Screen, SegmentedToggle, Skeleton, Text, useToast } from "@/components/ui";
import * as Location from "expo-location";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AMENITY_OPTIONS,
  SPORT_OPTIONS,
  accountNumberError,
  accountTitleError,
  bankNameError,
  buildPricingRules,
  buildSchedules,
  courtSetupFromCourt,
  courtSetupProblem,
  defaultCourtSetup,
  pktInstant,
  DEFAULT_BOOKING_HORIZON_DAYS,
  type Court,
  type CourtSetup,
  type CreateVenueInput,
  type Venue,
} from "@court-booking/types";

import { api } from "@/lib/api";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { formatWhen } from "@/lib/format";
import { NoAccess } from "@/components/no-access";
import { moreItemAllowed, venueSettingsAccess } from "@/lib/owner-access";
import { useMyPermissions } from "@/lib/use-my-permissions";
import { DayPicker, TimeField12 } from "@/components/time-fields";
import { CancellationPolicyFields, CourtSetupFields } from "@/components/court-setup-fields";
import {
  AdvanceSettings,
  advanceDraftFromCourt,
  advanceDraftProblem,
  advanceDraftToInput,
  advancePriceFromSetup,
  type AdvanceDraft,
} from "@/components/advance-settings";
import { VenueRemindersCard } from "@/components/reminders-card";
import { IdentityCard } from "@/components/identity-card";
import { DefaultHint } from "@/components/default-hint";
import { PhotoManager } from "@/components/photo-manager";
import { AmenityPicker, CourtIdentityFields } from "@/components/court-identity-fields";
import { CourtTabs } from "@/components/court-tabs";
import { courtLabel } from "@/components/court-label";
import { confirmAction } from "@/lib/confirm";
import { findSport, sameSport } from "@/lib/sport";
import { Chip, FieldLabel, PrimaryButton, ReadOnlyFence, SecondaryButton, SectionCard, SectionLabel, TextField, useReadOnly } from "./venue-setup/_components";
import { OwnerHeader, ownerBack } from "./_fl";

/** Alert.alert is a silent no-op on Expo web: the cards below report through the screen's Floodlight toast instead. */
const notifier: { show: (o: { message: string; tone?: "neutral" | "success" | "danger" }) => void } = { show: () => undefined };
function notify(title: string, body: string, tone: "success" | "danger" = "danger") {
  notifier.show({ message: `${title}: ${body}`, tone });
}

type Section = "venue" | "courts";
const NEW_COURT_KEY = "__new__";

export default function VenueSettingsScreen() {
  const { activeVenue, isLoading: venuesLoading } = useOwnerVenues();
  const perms = useMyPermissions();
  const toast = useToast();
  notifier.show = toast.show;
  const [section, setSection] = useState<Section>("venue");
  // Only ACTIVE courts are editable here -- a deactivated ("deleted") court shouldn't be a
  // tab in the settings editor. Its history still lives in the ledger (post-batch #2).
  const courts = (activeVenue?.courts ?? []).filter((c) => c.is_active);
  const [courtId, setCourtId] = useState<string | undefined>(undefined);
  // A "+ Court" tab that has not been saved yet (local only until "Create court").
  const [newCourtOpen, setNewCourtOpen] = useState(false);
  // If the selected court is no longer in the active list (e.g. just deleted), fall back to the first.
  const activeCourtId = (courtId && courts.some((c) => c.id === courtId) ? courtId : undefined) ?? courts[0]?.id;
  const onNewTab = newCourtOpen && courtId === NEW_COURT_KEY;

  const courtQuery = useQuery({
    queryKey: ["court-settings", activeCourtId],
    queryFn: () => api.courts.get(activeCourtId!),
    enabled: !!activeCourtId && section === "courts",
  });
  // The app's query client keeps the PREVIOUS query's data while a new one loads (placeholderData), so right after
  // switching court `courtQuery.data` is still the OLD court. A form seeded from it would hold the wrong court's hours
  // and prices, and saving would overwrite this court with them. Only treat the data as ready once it is this court's.
  const court = courtQuery.data && courtQuery.data.id === activeCourtId ? (courtQuery.data as Court) : undefined;
  const loading = venuesLoading || courtQuery.isLoading || (!!activeCourtId && !court && !courtQuery.isError);

  // Staff need court settings or photos access (or view_ledger, which reads the timers as a summary); without any of them
  // the whole screen would only 403.
  if (perms.settled && !moreItemAllowed("venueSettings", perms.can, perms.isStaff)) return <NoAccess what="Venue settings" />;
  // Per section, what this account may change (the backend's own rules); the rest is shown read-only.
  const access = venueSettingsAccess(perms.can, perms.isStaff);

  const status = activeVenue?.status;
  return (
    <Screen scroll={false} gutter={false} keyboard testID="venue-settings">
      <View style={{ paddingHorizontal: space[4], gap: space[3], paddingBottom: space[2] }}>
        <OwnerHeader title="Venue settings" onBack={ownerBack} />
        {activeVenue ? (
          <View testID="settings-hub-card" style={{ flexDirection: "row", alignItems: "center", gap: space[3], backgroundColor: palette.white, borderRadius: radius.tile, padding: space[3] }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="bodyStrong">{activeVenue.name}</Text>
              <Text variant="meta" tone="muted">{`${[activeVenue.area, activeVenue.city].filter(Boolean).join(", ")} · ${activeVenue.photo_urls?.length ?? 0} photos`}</Text>
            </View>
            <Pill size="sm" tone={status === "approved" ? "open" : status === "rejected" ? "danger" : "waiting"} label={status === "approved" ? "Live ✓" : status === "rejected" ? "Approve nahi" : "Review mein"} />
          </View>
        ) : null}
        {perms.settled && access.note ? (
          <View testID="venue-settings-read-only-note">
            <Banner tone="waiting" body={access.note} />
          </View>
        ) : null}
        {/* Venue-level settings and court-level settings are two separate sections, so an owner never edits a court's price
            while looking at the venue's bank details (or the other way round). */}
        <SegmentedToggle
          testID="settings-section"
          accessibilityLabel="Settings ka hissa"
          value={section}
          onChange={setSection}
          options={[
            { value: "venue", label: "Venue" },
            { value: "courts", label: courts.length ? `Courts (${courts.length})` : "Courts" },
          ]}
        />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: space[4], paddingTop: space[3], paddingBottom: space[8], gap: space[4] }} keyboardShouldPersistTaps="handled">
        {!perms.settled ? (
          // wait for the permissions answer so a staff member never sees an editable form flash
          <Skeleton height={120} r={radius.card} />
        ) : section === "venue" ? (
          activeVenue ? (
            <>
              {/* Stage 2: the owner's CNIC (owner only; masked). First, so the Overview banner's "CNIC dein" lands on it. */}
              <IdentityCard />
              {/* QA signup-venue round item 3: post-approval editing for the fields the wizard's own
                  copy already promised are editable (name / WhatsApp / bank details). */}
              {/* PATCH /venues/{id} is owner-only: staff see these three read-only, with no Save. */}
              <ReadOnlyFence readOnly={!access.venue}>
                <VenueBasicsCard key={`basics-${activeVenue.id}`} venue={activeVenue} activeSports={courts.map((c) => c.sport)} />
                {/* ONE cancellation policy for the whole venue (Section 32 Part 4). */}
                <VenueCancellationCard
                  key={activeVenue.id}
                  venueId={activeVenue.id}
                  initialAllowed={activeVenue.cancellation_allowed}
                  initialCutoff={activeVenue.cancellation_cutoff_hours}
                />
                <BookingHorizonCard
                  key={`horizon-${activeVenue.id}`}
                  venueId={activeVenue.id}
                  initialDays={activeVenue.booking_horizon_days}
                />
              </ReadOnlyFence>
              {/* Stage 2: hold / reminders / auto-cancel, saved per venue (null = default). */}
              <VenueRemindersCard key={`reminders-${activeVenue.id}`} venueId={activeVenue.id} />
              <VenuePhotosCard
                key={`photos-${activeVenue.id}`}
                venueId={activeVenue.id}
                photoUrls={activeVenue.photo_urls}
                photoKeys={activeVenue.photo_keys}
                readOnly={!access.photos}
              />
            </>
          ) : (
            <Skeleton height={120} r={radius.card} />
          )
        ) : (
          <>
            <CourtTabs
              tabs={[
                ...courts.map((c) => ({ key: c.id, label: courtLabel(c.name, c.sport) })),
                ...(newCourtOpen ? [{ key: NEW_COURT_KEY, label: "New court" }] : []),
              ]}
              selectedKey={onNewTab ? NEW_COURT_KEY : activeCourtId}
              onSelect={(k) => setCourtId(k)}
              onAdd={
                activeVenue && !newCourtOpen && access.courts
                  ? () => {
                      setNewCourtOpen(true);
                      setCourtId(NEW_COURT_KEY);
                    }
                  : undefined
              }
            />

            {onNewTab && activeVenue ? (
              <NewCourtForm
                key="new-court"
                venue={activeVenue}
                onDiscard={() => {
                  setNewCourtOpen(false);
                  setCourtId(undefined);
                }}
                onAdded={(id) => {
                  setNewCourtOpen(false);
                  setCourtId(id);
                }}
              />
            ) : loading ? (
              <View className="py-10 items-center justify-center">
                <Skeleton height={120} r={radius.card} />
              </View>
            ) : courtQuery.isError ? (
              <ErrorState message={friendlyErrorMessage(courtQuery.error)} onRetry={() => courtQuery.refetch()} />
            ) : !activeCourtId || !court ? (
              <Text variant="body" tone="muted" align="center" style={{ paddingVertical: space[8] }}>{access.courts ? 'Abhi koi court nahi. "+ Court" daba kar pehla court banayein.' : "Abhi koi court nahi."}</Text>
            ) : (
              <>
                {/* keyed by court so switching court re-seeds the form from that court (no effect needed) */}
                <ReadOnlyFence readOnly={!access.courts}>
                  <CourtSettingsForm
                    key={court.id}
                    court={court}
                    venueSports={activeVenue?.sports ?? []}
                    canDelete={courts.length > 1 && access.courts}
                    onDeleted={() => setCourtId(undefined)}
                  />
                </ReadOnlyFence>
                <CourtPhotosCard key={`court-photos-${court.id}`} court={court} readOnly={!access.photos} />
                <BlackoutsCard key={`blackouts-${activeCourtId}`} courtId={activeCourtId} canEdit={access.courts} />
              </>
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function VenueBasicsCard({ venue, activeSports }: { venue: Venue; activeSports: string[] }) {
  const queryClient = useQueryClient();
  const readOnly = useReadOnly();
  const [name, setName] = useState(venue.name);
  const [description, setDescription] = useState(venue.description ?? "");
  const [whatsapp, setWhatsapp] = useState(venue.whatsapp ?? "");
  const [address, setAddress] = useState(venue.address);
  const [area, setArea] = useState(venue.area ?? "");
  const [sports, setSports] = useState<string[]>(venue.sports);
  const [amenities, setAmenities] = useState<string[]>(venue.amenities ?? []);
  const [bankName, setBankName] = useState(venue.bank_details?.bank ?? "");
  const [accountTitle, setAccountTitle] = useState(venue.bank_details?.account_title ?? "");
  const [accountNumber, setAccountNumber] = useState(venue.bank_details?.account_number ?? "");
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const bankTouched = !!(bankName || accountTitle || accountNumber);
  const bErrors = bankTouched
    ? { bank: bankNameError(bankName), title: accountTitleError(accountTitle), num: accountNumberError(accountNumber) }
    : { bank: null, title: null, num: null };
  const bankOk = !bankTouched || (!bErrors.bank && !bErrors.title && !bErrors.num);
  // A sport can't be switched off while one of this venue's live courts still plays it.
  const blockedSport = activeSports.find((cs) => !findSport(sports, cs));
  const canSave = name.trim().length > 0 && address.trim().length > 0 && sports.length > 0 && !blockedSport && bankOk;

  function toggleSport(sport: string) {
    setSports((cur) => {
      if (cur.some((c) => sameSport(c, sport))) return cur.filter((c) => !sameSport(c, sport));
      return [...cur, sport];
    });
  }

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setMessage(null);
    try {
      const patch: Parameters<typeof api.venues.update>[1] = {
        name: name.trim(),
        description: description.trim() || undefined,
        address: address.trim(),
        area: area.trim() || undefined,
        whatsapp: whatsapp.trim() || undefined,
        sports,
        amenities,
      };
      if (bankTouched) patch.bank_details = { bank: bankName, account_title: accountTitle, account_number: accountNumber };
      await api.venues.update(venue.id, patch);
      await queryClient.invalidateQueries({ queryKey: ["owner-venues"] });
      setMessage({ ok: true, text: "Saved." });
    } catch (e) {
      setMessage({ ok: false, text: friendlyErrorMessage(e) });
    } finally {
      setSaving(false);
    }
  }

  async function updatePin() {
    setLocating(true);
    setMessage(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setMessage({ ok: false, text: "Location permission denied. Allow it in your device settings to move the pin." });
        return;
      }
      const pos = await Location.getCurrentPositionAsync({});
      await api.venues.update(venue.id, { latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      setMessage({ ok: true, text: `Pin moved to ${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}.` });
    } catch (e) {
      setMessage({ ok: false, text: friendlyErrorMessage(e) });
    } finally {
      setLocating(false);
    }
  }

  return (
    <SectionCard>
      <SectionLabel>Venue basics</SectionLabel>
      <TextField label="Venue name" value={name} onChangeText={setName} />
      <TextField label="Description" value={description} onChangeText={setDescription} placeholder="A few lines players will see" multiline style={{ height: 96, paddingTop: 12, textAlignVertical: "top" }} />
      <TextField label="Street address" value={address} onChangeText={setAddress} />
      <TextField label="Area" value={area} onChangeText={setArea} placeholder="DHA Phase 6" />
      <TextField label="WhatsApp for bookings" value={whatsapp} onChangeText={setWhatsapp} placeholder="+923001234567" keyboardType="phone-pad" mono />

      <View className="gap-2">
        <FieldLabel>Sports offered at this venue</FieldLabel>
        <View className="flex-row flex-wrap gap-2">
          {SPORT_OPTIONS.map((sp) => (
            <Chip key={sp} label={sp} selected={!!findSport(sports, sp)} onPress={() => toggleSport(sp)} />
          ))}
        </View>
        {blockedSport ? (
          <Text variant="meta" weight="bold" tone="danger">
            You still have a {blockedSport} court. Change or delete it in Courts before removing this sport.
          </Text>
        ) : null}
      </View>

      <AmenityPicker
        value={amenities}
        onToggle={(k) => setAmenities((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]))}
        options={AMENITY_OPTIONS}
      />

      {readOnly ? null : (
        <View className="gap-2">
          <FieldLabel>Location pin</FieldLabel>
          <SecondaryButton label={locating ? "Locating..." : "Move pin to my current location"} onPress={updatePin} />
        </View>
      )}

      <SectionLabel>Bank details (players see these on the pay screen)</SectionLabel>
      <TextField label="Bank name" value={bankName} onChangeText={setBankName} placeholder="Meezan Bank" error={bankName ? bErrors.bank : null} />
      <TextField label="Account title" value={accountTitle} onChangeText={setAccountTitle} placeholder="Padel Republic" error={accountTitle ? bErrors.title : null} />
      <TextField label="Account number" value={accountNumber} onChangeText={setAccountNumber} placeholder="03445551234 or 12345678901234" keyboardType="number-pad" mono error={accountNumber ? bErrors.num : null} />
      {/* Bank changes are the highest-risk edit on this screen. Inline nudge, no re-verification
          wall -- see the web mirror for the trade-off note. */}
      {readOnly ? null : (
        <Text variant="meta" tone="waiting">
          These fields decide where players send their money. Update carefully.
        </Text>
      )}
      {message ? (
        <Text accessibilityRole="alert" variant="bodyBold" tone={message.ok ? "info" : "danger"}>
          {message.text}
        </Text>
      ) : null}
      <PrimaryButton label="Save venue details" onPress={save} disabled={!canSave || saving} loading={saving} />
    </SectionCard>
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
      notify("Save ho gaya", "Cancellation policy har court par lag gayi.", "success");
    } catch (e) {
      notify("Couldn't save", friendlyErrorMessage(e));
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

/** Stage 2: how many days ahead players can book (venue.booking_horizon_days, backend default 90, 1-365). */
function BookingHorizonCard({ venueId, initialDays }: { venueId: string; initialDays: number | undefined }) {
  const queryClient = useQueryClient();
  const [days, setDays] = useState(String(initialDays ?? DEFAULT_BOOKING_HORIZON_DAYS));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const n = Number(days);
  const problem = !days.trim() || !Number.isInteger(n) || n < 1 || n > 365 ? "1 se 365 din ke beech rakhein." : null;

  async function save() {
    if (problem) return;
    setSaving(true);
    setMessage(null);
    try {
      // booking_horizon_days is accepted by PATCH /venues/{id} (VenueUpdateIn) but not in the shared CreateVenueInput type
      const patch = { booking_horizon_days: n } as Partial<CreateVenueInput>;
      await api.venues.update(venueId, patch);
      await queryClient.invalidateQueries({ queryKey: ["owner-venues"] });
      setMessage({ ok: true, text: "Saved." });
    } catch (e) {
      setMessage({ ok: false, text: friendlyErrorMessage(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard>
      <SectionLabel>Kitne din aage tak booking</SectionLabel>
      <View className="gap-1.5">
        <TextField
          label="Players kitne din aage tak book kar sakte hain"
          value={days}
          onChangeText={(v) => {
            setMessage(null);
            setDays(v.replace(/\D/g, ""));
          }}
          keyboardType="number-pad"
          mono
          error={problem}
          testID="horizon-days"
        />
        <DefaultHint
          settingKey="booking_horizon_days"
          value={days.trim() ? n : null}
          onReset={() => setDays(String(DEFAULT_BOOKING_HORIZON_DAYS))}
          testID="default-horizon"
        />
      </View>
      {message ? (
        <Text accessibilityRole="alert" variant="bodyBold" tone={message.ok ? "info" : "danger"}>
          {message.text}
        </Text>
      ) : null}
      <PrimaryButton label="Save booking window" onPress={save} disabled={!!problem || saving} loading={saving} />
    </SectionCard>
  );
}

/** Slot length, hours and prices for ONE court. Seeded once from the court it is mounted for (the parent keys it by
 * court id), so it holds its own edits and never needs an effect to copy server data into state. */
function CourtSettingsForm({ court, venueSports, canDelete, onDeleted }: { court: Court; venueSports: string[]; canDelete: boolean; onDeleted: () => void }) {
  const queryClient = useQueryClient();
  const [identity, setIdentity] = useState({ name: court.name, sport: court.sport, isIndoor: court.is_indoor });
  const [setup, setSetup] = useState<CourtSetup>(() => courtSetupFromCourt(court));
  const [advance, setAdvance] = useState<AdvanceDraft>(() => advanceDraftFromCourt(court));
  // A11: the backend's own answer for "what does Default mean on this court" (the real default + source). A backend
  // without the endpoint (404) just leaves it undefined and the line is computed from the form's price instead.
  const explainQuery = useQuery({
    queryKey: ["advance-explain", court.id],
    queryFn: () => api.owners.advanceExplain(court.id),
    retry: false,
  });
  const explain = explainQuery.data && !explainQuery.isError ? explainQuery.data : null;
  const basePct = court.pricing_rules.find((r) => r.is_active)?.advance_percentage;
  const basePercentage = basePct != null && Number.isFinite(Number(basePct)) ? Number(basePct) : undefined;
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const problem = courtSetupProblem(setup);

  function confirmDelete() {
    // Soft-delete: the backend deactivates the court (is_active=false). Existing bookings and
    // their payments are untouched and stay in the ledger (post-batch #2) -- say so in the confirm.
    confirmAction({
      title: `Delete "${court.name}"?`,
      message: "It will stop taking new bookings and disappear from the player app. Its past bookings and payments stay in your ledger.",
      confirmLabel: "Delete",
      destructive: true,
      onConfirm: async () => {
        setDeleting(true);
        try {
          await api.courts.deactivate(court.id);
          await queryClient.invalidateQueries({ queryKey: ["owner-venues"] });
          onDeleted();
        } catch (e) {
          notify("Couldn't delete", friendlyErrorMessage(e));
          setDeleting(false);
        }
      },
    });
  }
  const advanceProblem = advanceDraftProblem(advance);

  async function save() {
    if (!identity.name.trim()) {
      notify("Name your court", "Give the court a name.");
      return;
    }
    if (problem) {
      notify("Check this court", problem);
      return;
    }
    if (advanceProblem) {
      notify("Check the advance rule", advanceProblem);
      return;
    }
    setSaving(true);
    try {
      await api.courts.update(court.id, {
        name: identity.name.trim(),
        sport: identity.sport,
        is_indoor: identity.isIndoor,
        ...(setup.slotMinutes !== court.slot_minutes ? { slot_minutes: setup.slotMinutes } : {}),
      });
      await api.courts.update(court.id, advanceDraftToInput(advance));
      await api.courts.setSchedule(court.id, buildSchedules(setup));
      await api.courts.setPricing(court.id, buildPricingRules(setup));
      await queryClient.invalidateQueries({ queryKey: ["court-settings", court.id] });
      await queryClient.invalidateQueries({ queryKey: ["court", court.id] });
      await queryClient.invalidateQueries({ queryKey: ["owner-venues"] });
      await queryClient.invalidateQueries({ queryKey: ["advance-explain", court.id] });
      notify("Save ho gaya", `${courtLabel(identity.name.trim(), identity.sport)}: tafseel, ghante, qeemat aur advance update ho gaye.`, "success");
    } catch (e) {
      notify("Couldn't save", friendlyErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Text variant="title">{courtLabel(court.name, court.sport)}</Text>
      <CourtIdentityFields
        name={identity.name}
        sport={identity.sport}
        isIndoor={identity.isIndoor}
        sports={venueSports}
        onChange={(patch) => setIdentity((cur) => ({ ...cur, ...patch }))}
      />
      <CourtSetupFields value={setup} onChange={(patch) => setSetup((s) => ({ ...s, ...patch }))} slotChangeNote />
      <AdvanceSettings
        value={advance}
        onChange={(patch) => setAdvance((cur) => ({ ...cur, ...patch }))}
        price={advancePriceFromSetup(setup)}
        explain={explain}
        defaultPercentage={basePercentage}
      />
      <PrimaryButton label="Save changes" onPress={save} loading={saving} />
      {canDelete ? (
        <Pressable
          onPress={confirmDelete}
          disabled={deleting || saving}
          className="min-h-11 items-center justify-center"
          style={{ opacity: deleting || saving ? 0.5 : 1 }}
        >
          <Text variant="bodyBold" tone="danger">
            {deleting ? "Deleting…" : "Delete this court"}
          </Text>
        </Pressable>
      ) : null}
    </>
  );
}

/** The unsaved "New court" tab: identity + hours + prices, created with the same create -> setSchedule -> setPricing sequence
 * as the wizard. Sport is chosen from the venue's offered sports (chips, so casing always matches -- post-batch #3). */
function NewCourtForm({ venue, onAdded, onDiscard }: { venue: Venue; onAdded: (courtId: string) => void; onDiscard: () => void }) {
  const queryClient = useQueryClient();
  const [identity, setIdentity] = useState({ name: "", sport: venue.sports[0] ?? "", isIndoor: false });
  const [setup, setSetup] = useState<CourtSetup>(() => defaultCourtSetup());
  const [saving, setSaving] = useState(false);
  const problem = courtSetupProblem(setup);
  const valid = identity.name.trim().length > 0 && identity.sport.trim().length > 0 && !problem;

  async function create() {
    if (!identity.name.trim()) {
      notify("Name your court", "Give the court a name.");
      return;
    }
    if (problem) {
      notify("Check this court", problem);
      return;
    }
    setSaving(true);
    try {
      const { court } = await api.courts.create(venue.id, {
        name: identity.name.trim(),
        sport: identity.sport,
        is_indoor: identity.isIndoor,
        slot_minutes: setup.slotMinutes,
      });
      await api.courts.setSchedule(court.id, buildSchedules(setup));
      await api.courts.setPricing(court.id, buildPricingRules(setup));
      await queryClient.invalidateQueries({ queryKey: ["owner-venues"] });
      onAdded(court.id);
    } catch (e) {
      notify("Couldn't add court", friendlyErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View className="gap-4">
      <CourtIdentityFields
        name={identity.name}
        sport={identity.sport}
        isIndoor={identity.isIndoor}
        sports={venue.sports}
        onChange={(patch) => setIdentity((cur) => ({ ...cur, ...patch }))}
      />
      <CourtSetupFields value={setup} onChange={(patch) => setSetup((cur) => ({ ...cur, ...patch }))} />
      <PrimaryButton label="Create court" onPress={create} disabled={!valid} loading={saving} />
      <SecondaryButton label="Discard" onPress={onDiscard} />
    </View>
  );
}

function VenuePhotosCard({ venueId, photoUrls, photoKeys, readOnly }: { venueId: string; photoUrls: string[]; photoKeys: string[]; readOnly: boolean }) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["owner-venues"] });
  return (
    <PhotoManager
      title="Venue photos"
      readOnly={readOnly}
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

function CourtPhotosCard({ court, readOnly }: { court: Court; readOnly: boolean }) {
  const queryClient = useQueryClient();
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["court-settings", court.id] });
    await queryClient.invalidateQueries({ queryKey: ["owner-venues"] });
  };
  return (
    <PhotoManager
      title={`${courtLabel(court.name, court.sport)} photos`}
      readOnly={readOnly}
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

function BlackoutsCard({ courtId, canEdit }: { courtId: string; canEdit: boolean }) {
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
      notify("Missing dates", "Pick a start and end date/time for the blackout.");
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
      notify("Couldn't add blackout", friendlyErrorMessage(e));
    } finally {
      setAdding(false);
    }
  }

  return (
    <SectionCard>
      <SectionLabel>Blackout dates</SectionLabel>
      {(blackoutsQuery.data ?? []).length === 0 ? (
        <Text variant="meta" tone="muted">Abhi koi band din nahi.</Text>
      ) : (
        (blackoutsQuery.data ?? []).map((b) => (
          <View key={b.id} style={{ backgroundColor: palette.ground, borderRadius: radius.md, padding: space[3], gap: 2 }}>
            <Text variant="bodyBold">{b.title ?? "Band"}</Text>
            <Text variant="caption" tone="muted">
              {formatWhen(b.starts_at)} to {formatWhen(b.ends_at)}
            </Text>
          </View>
        ))
      )}
      {/* adding a blackout needs edit_court_settings (POST /courts/{id}/blackouts); others only see the list */}
      {canEdit ? (
        <>
          <View style={{ height: 1, backgroundColor: palette.divider }} />
          <FieldLabel>Add a blackout</FieldLabel>
          <TextField label="Title (optional)" value={title} onChangeText={setTitle} placeholder="Maintenance" />
          <DayPicker label="Starts on" value={startDate} onChange={setStartDate} />
          <TimeField12 label="Starts at" value={startTime} onChange={setStartTime} />
          <DayPicker label="Ends on" value={endDate} onChange={setEndDate} />
          <TimeField12 label="Ends at" value={endTime} onChange={setEndTime} />
          <PrimaryButton label="Add blackout" onPress={add} loading={adding} />
        </>
      ) : null}
    </SectionCard>
  );
}
