import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BackHandler, Pressable, ScrollView, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Svg, { Path } from "react-native-svg";
import { Building2, CalendarX2, ChevronRight, Clock3, Grid2x2, IdCard, Landmark, RotateCcw, Star } from "lucide-react-native";
import { alpha, palette, radius, space } from "@court-booking/ui-tokens";
import { Banner, Button, ErrorState, Pill, Screen, SegmentedToggle, Skeleton, Text, useToast } from "@/components/ui";
import * as Location from "expo-location";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AMENITY_OPTIONS,
  SPORT_OPTIONS,
  SETTINGS_DEFAULTS,
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
  unconfirmedSettingLabel,
  venueMissingLabel,
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
import { IdentityCard, useOwnerIdentity } from "@/components/identity-card";
import { DefaultHint } from "@/components/default-hint";
import { PhotoManager } from "@/components/photo-manager";
import { AmenityPicker, CourtDetailsGrid, CourtIdentityFields } from "@/components/court-identity-fields";
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

/** OSettings hub board: one list, each row opens its own part of the settings (the old Venue / Courts toggle is gone). */
type Section = "details" | "courts" | "blackout" | "timers" | "cancel" | "points" | "bank" | "cnic" | "photos";
const SECTION_TITLE: Record<Section, string> = {
  details: "Venue ki tafseel",
  courts: "Courts aur qeemat",
  blackout: "Band din (blackout)",
  timers: "Timers aur reminders",
  cancel: "Cancel policy",
  points: "Points ki chhoot",
  bank: "Bank details",
  cnic: "Shanakht (CNIC)",
  photos: "Venue photos",
};
const isSection = (v: unknown): v is Section => typeof v === "string" && v in SECTION_TITLE;
const MISSING_SECTION: Record<string, Section> = {
  court: "courts",
  schedule: "courts",
  pricing: "courts",
  bank_details: "bank",
  photo: "photos",
  address: "details",
  location: "details",
  sports: "details",
};
const NEW_COURT_KEY = "__new__";

export default function VenueSettingsScreen() {
  const { activeVenue, isLoading: venuesLoading } = useOwnerVenues();
  const perms = useMyPermissions();
  const toast = useToast();
  notifier.show = toast.show;
  const params = useLocalSearchParams<{ section?: string }>();
  const [section, setSection] = useState<Section | null>(isSection(params.section) ? params.section : null);
  const identity = useOwnerIdentity();
  // Android Back inside a section returns to the hub (the header arrow does the same).
  useEffect(() => {
    if (!section) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setSection(null);
      return true;
    });
    return () => sub.remove();
  }, [section]);
  // Only ACTIVE courts are editable here -- a deactivated ("deleted") court shouldn't be a
  // tab in the settings editor. Its history still lives in the ledger (post-batch #2).
  const courts = (activeVenue?.courts ?? []).filter((c) => c.is_active);
  const [courtId, setCourtId] = useState<string | undefined>(undefined);
  // A "+ Court" tab that has not been saved yet (local only until "Create court").
  const [newCourtOpen, setNewCourtOpen] = useState(false);
  // OSettings board: the court form's "Sab save karein" is a footer pinned under the scroll; the form hands it its save.
  const courtSave = useRef<(() => void) | null>(null);
  const [courtSaving, setCourtSaving] = useState(false);
  const insets = useSafeAreaInsets();
  // If the selected court is no longer in the active list (e.g. just deleted), fall back to the first.
  const activeCourtId = (courtId && courts.some((c) => c.id === courtId) ? courtId : undefined) ?? courts[0]?.id;
  const onNewTab = newCourtOpen && courtId === NEW_COURT_KEY;

  const courtQuery = useQuery({
    queryKey: ["court-settings", activeCourtId],
    queryFn: () => api.courts.get(activeCourtId!),
    enabled: !!activeCourtId && (section === "courts" || section === "blackout"),
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
        <OwnerHeader title={section ? SECTION_TITLE[section] : "Venue settings"} onBack={section ? () => setSection(null) : ownerBack} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: space[4], paddingTop: space[3], paddingBottom: space[8], gap: space[4] }} keyboardShouldPersistTaps="handled">
        {/* Everything under the header scrolls (it used to be fixed and left ~20% of a 360x800 phone to scroll). */}
        {!section && activeVenue ? (
          // OSettings hub board: the venue as a teal card (name, area · photos · status).
          <View testID="settings-hub-card" style={{ backgroundColor: palette.teal, borderRadius: radius.card, padding: space[4], paddingTop: 72, minHeight: 150, justifyContent: "flex-end", gap: 2, overflow: "hidden" }}>
            {/* board: a court drawn in faint white lines behind the venue name */}
            <Svg width="100%" height={150} viewBox="0 0 358 150" preserveAspectRatio="none" fill="none" stroke={alpha.courtLines} strokeOpacity={0.7} strokeWidth={2} style={{ position: "absolute", left: 0, top: 0 }} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no">
              <Path d="M70 130 100 24h158l30 106z" />
              <Path d="M179 24v106" />
            </Svg>
            <Pressable
              onPress={() => setSection("photos")}
              accessibilityRole="button"
              accessibilityLabel="Venue photos"
              style={{ position: "absolute", right: 12, top: 12, minHeight: 44, paddingHorizontal: space[3], borderRadius: 14, backgroundColor: palette.white, justifyContent: "center" }}
            >
              <Text variant="bodyBold">Photos</Text>
            </Pressable>
            <Text variant="title" tone="hero">{activeVenue.name}</Text>
            <Text variant="meta" tone="heroMuted">{`${[activeVenue.area, activeVenue.city].filter(Boolean).join(", ")} · ${activeVenue.photo_urls?.length ?? 0} photos · ${status === "approved" ? "Live ✓" : status === "rejected" ? "Approve nahi" : "Review mein"}`}</Text>
          </View>
        ) : null}
        {/* OSettings board: the list sits right under the venue card; the detail banners follow it. */}
        {!section && activeVenue && perms.settled ? <HubList rows={hubRows(activeVenue, courts.length, identity.data?.status)} onOpen={setSection} /> : null}
        {!section && activeVenue?.missing_for_approval && activeVenue.missing_for_approval.length > 0 ? (
          // audit 2026-10-28 item 9: what the venue needs before the admin can approve it
          <Banner
            tone="danger"
            title={status === "approved" ? "Ye cheezein abhi baqi hain" : "Venue live hone se pehle ye cheezein zaroori hain"}
            body={activeVenue.missing_for_approval.map((m) => `• ${venueMissingLabel(m, "ru")}`).join("\n")}
            testID="venue-missing"
          />
        ) : null}
        {!section && activeVenue?.unconfirmed_settings && activeVenue.unconfirmed_settings.length > 0 ? (
          // audit 2026-10-28 item 15: a live venue is never blocked; saving confirms the hidden defaults
          <Banner
            tone="waiting"
            title="Ye settings abhi default par chal rahi hain. Dekh kar apni value save karein:"
            body={activeVenue.unconfirmed_settings.map((u) => `• ${unconfirmedSettingLabel(u, "ru")}`).join("\n")}
            testID="unconfirmed-settings"
          />
        ) : null}
        {perms.settled && access.note ? (
          <View testID="venue-settings-read-only-note">
            <Banner tone="waiting" body={access.note} />
          </View>
        ) : null}
        {!perms.settled ? (
          // wait for the permissions answer so a staff member never sees an editable form flash
          <Skeleton height={120} r={radius.card} />
        ) : !section ? (
          activeVenue ? null : <Skeleton height={120} r={radius.card} />
        ) : section !== "courts" && section !== "blackout" ? (
          activeVenue ? (
            <>
              {/* Stage 2: the owner's CNIC (owner only; masked). The Overview banner's "CNIC dein" opens this section. */}
              {section === "cnic" ? <IdentityCard /> : null}
              {/* PATCH /venues/{id} is owner-only: staff see these read-only, with no Save. */}
              <ReadOnlyFence readOnly={!access.venue}>
                {section === "details" || section === "bank" ? (
                  <VenueBasicsCard key={`basics-${section}-${activeVenue.id}`} part={section} venue={activeVenue} activeSports={courts.map((c) => c.sport)} />
                ) : null}
                {/* ONE cancellation policy for the whole venue (Section 32 Part 4). */}
                {section === "cancel" ? (
                  <VenueCancellationCard
                    key={activeVenue.id}
                    venueId={activeVenue.id}
                    initialAllowed={activeVenue.cancellation_allowed}
                    initialCutoff={activeVenue.cancellation_cutoff_hours}
                  />
                ) : null}
                {section === "timers" ? (
                  <BookingHorizonCard key={`horizon-${activeVenue.id}`} venueId={activeVenue.id} initialDays={activeVenue.booking_horizon_days} />
                ) : null}
                {section === "points" ? (
                  <PointsDiscountCard
                    key={`points-${activeVenue.id}`}
                    venueId={activeVenue.id}
                    initialEnabled={!!activeVenue.points_discount_enabled}
                    initialAmount={activeVenue.points_discount_pkr ?? 500}
                  />
                ) : null}
              </ReadOnlyFence>
              {/* Stage 2: hold / reminders / auto-cancel, saved per venue (null = default). */}
              {section === "timers" ? <VenueRemindersCard key={`reminders-${activeVenue.id}`} venueId={activeVenue.id} /> : null}
              {section === "photos" ? (
                <VenuePhotosCard
                  key={`photos-${activeVenue.id}`}
                  venueId={activeVenue.id}
                  photoUrls={activeVenue.photo_urls}
                  photoKeys={activeVenue.photo_keys}
                  readOnly={!access.photos}
                />
              ) : null}
            </>
          ) : (
            <Skeleton height={120} r={radius.card} />
          )
        ) : (
          <>
            <CourtTabs
              tabs={[
                ...courts.map((c) => ({ key: c.id, label: courtLabel(c.name, c.sport) })),
                ...(newCourtOpen && section === "courts" ? [{ key: NEW_COURT_KEY, label: "Naya court" }] : []),
              ]}
              selectedKey={onNewTab && section === "courts" ? NEW_COURT_KEY : activeCourtId}
              onSelect={(k) => setCourtId(k)}
              onAdd={
                activeVenue && !newCourtOpen && access.courts && section === "courts"
                  ? () => {
                      setNewCourtOpen(true);
                      setCourtId(NEW_COURT_KEY);
                    }
                  : undefined
              }
            />

            {onNewTab && activeVenue && section === "courts" ? (
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
            ) : section === "blackout" ? (
              <BlackoutsCard key={`blackouts-${activeCourtId}`} courtId={activeCourtId} canEdit={access.courts} />
            ) : (
              <>
                {/* keyed by court so switching court re-seeds the form from that court (no effect needed) */}
                <ReadOnlyFence readOnly={!access.courts}>
                  <CourtSettingsForm
                    key={court.id}
                    saveRef={courtSave}
                    onSavingChange={setCourtSaving}
                    court={court}
                    venueSports={activeVenue?.sports ?? []}
                    canDelete={courts.length > 1 && access.courts}
                    onDeleted={() => setCourtId(undefined)}
                  />
                </ReadOnlyFence>
                <CourtPhotosCard key={`court-photos-${court.id}`} court={court} readOnly={!access.photos} />
              </>
            )}
          </>
        )}
      </ScrollView>
      {section === "courts" && !onNewTab && court && !loading && access.courts ? (
        <View
          testID="court-save-bar"
          style={{
            backgroundColor: palette.white,
            borderTopWidth: 1,
            borderTopColor: palette.line,
            paddingHorizontal: space[4],
            paddingTop: 12,
            paddingBottom: Math.max(insets.bottom, space[4]) + 12,
            marginBottom: -Math.max(insets.bottom, space[4]),
          }}
        >
          <Button label="Sab save karein" block loading={courtSaving} onPress={() => courtSave.current?.()} testID="court-save" />
        </View>
      ) : null}
    </Screen>
  );
}

type HubRow = { key: Section; label: string; sub: string; icon: ReactNode; warn?: boolean; quiet?: boolean };

/** The hub rows with a one-line summary each (OSettings board). "Baqi" marks a row that still blocks or defaults something. */
function hubRows(venue: Venue, courtCount: number, cnicStatus: string | undefined): HubRow[] {
  const missing = new Set((venue.missing_for_approval ?? []).map((m) => MISSING_SECTION[m.code]).filter(Boolean));
  const unconfirmed = venue.unconfirmed_settings ?? [];
  const timersDefault = unconfirmed.some((u) => u.code !== "advance");
  const advanceDefault = unconfirmed.some((u) => u.code === "advance");
  const cnicOpen = cnicStatus === "missing" || cnicStatus === "rejected";
  const teal = palette.tealDeep;
  const ink = palette.night;
  const bank = venue.bank_details;
  const policy = !venue.cancellation_allowed
    ? "Cancel nahi hota"
    : venue.cancellation_cutoff_hours
      ? `${venue.cancellation_cutoff_hours} ghante pehle tak poora refund`
      : "Shuru hone se pehle tak refund";
  return [
    { key: "details", label: SECTION_TITLE.details, sub: "Naam, address, pin, WhatsApp, description", icon: <Building2 size={20} color={teal} />, warn: missing.has("details") },
    { key: "courts", label: SECTION_TITLE.courts, sub: `${courtCount} ${courtCount === 1 ? "court" : "courts"} · ghante · qeemat · advance`, icon: <Grid2x2 size={20} color={teal} />, warn: missing.has("courts") || advanceDefault },
    { key: "blackout", label: SECTION_TITLE.blackout, sub: "Court band karne ke din", icon: <CalendarX2 size={20} color={ink} />, quiet: true },
    { key: "timers", label: SECTION_TITLE.timers, sub: "Hold, reminders, auto-cancel, kitne din aage", icon: <Clock3 size={20} color={teal} />, warn: timersDefault },
    { key: "cancel", label: SECTION_TITLE.cancel, sub: policy, icon: <RotateCcw size={20} color={ink} />, quiet: true },
    { key: "points", label: SECTION_TITLE.points, sub: venue.points_discount_enabled ? `On · PKR ${venue.points_discount_pkr ?? 500}` : "Off", icon: <Star size={20} color={ink} />, quiet: true },
    { key: "bank", label: SECTION_TITLE.bank, sub: bank?.bank ? `${bank.bank} · ****${(bank.account_number ?? "").slice(-4)}` : "Abhi nahi diye", icon: <Landmark size={20} color={ink} />, quiet: true, warn: missing.has("bank") },
    {
      key: "cnic",
      label: SECTION_TITLE.cnic,
      sub: cnicStatus === "verified" ? "Tasdeeq ho gayi" : cnicStatus === "pending" ? "Check ho raha hai" : "Payout ke liye zaroori",
      icon: <IdCard size={20} color={cnicOpen ? palette.waiting : ink} />,
      quiet: !cnicOpen,
      warn: cnicOpen,
    },
  ];
}

function HubList({ rows, onOpen }: { rows: HubRow[]; onOpen: (s: Section) => void }) {
  return (
    <View testID="settings-hub" style={{ backgroundColor: palette.white, borderRadius: radius.card, overflow: "hidden" }}>
      {rows.map((row, i) => (
        <Pressable
          key={row.key}
          testID={`hub-${row.key}`}
          onPress={() => onOpen(row.key)}
          accessibilityRole="button"
          accessibilityLabel={`${row.label}. ${row.sub}${row.warn ? ". Baqi" : ""}`}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space[3],
            paddingVertical: 12,
            paddingHorizontal: 14,
            minHeight: 64,
            borderBottomWidth: i < rows.length - 1 ? 1 : 0,
            borderBottomColor: palette.mist,
          }}
        >
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 13,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: row.key === "cnic" && row.warn ? palette.waitingTint : row.quiet ? palette.mist : palette.tealTint,
            }}
          >
            {row.icon}
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
            <Text variant="bodyStrong">{row.label}</Text>
            <Text variant="caption" tone="muted" numberOfLines={2}>
              {row.sub}
            </Text>
          </View>
          {row.warn ? <Pill size="sm" tone="waiting" label="Baqi" /> : null}
          <ChevronRight size={16} color={palette.muted} />
        </Pressable>
      ))}
    </View>
  );
}

function VenueBasicsCard({ venue, activeSports, part }: { venue: Venue; activeSports: string[]; part: "details" | "bank" }) {
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
      setMessage({ ok: true, text: "Save ho gaya." });
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
        setMessage({ ok: false, text: "Location ki ijazat nahi mili. Pin hilane ke liye phone ki settings mein ijazat dein." });
        return;
      }
      const pos = await Location.getCurrentPositionAsync({});
      await api.venues.update(venue.id, { latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      setMessage({ ok: true, text: `Pin yahan lag gaya: ${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}.` });
    } catch (e) {
      setMessage({ ok: false, text: friendlyErrorMessage(e) });
    } finally {
      setLocating(false);
    }
  }

  return (
    <SectionCard>
      {part === "details" ? (
        <>
      <SectionLabel>Venue ki tafseel</SectionLabel>
      <TextField label="Venue ka naam" value={name} onChangeText={setName} />
      <TextField label="Tafseel" value={description} onChangeText={setDescription} placeholder="Do teen lines jo players dekhenge" multiline style={{ height: 96, paddingTop: 12, textAlignVertical: "top" }} />
      <TextField label="Address" value={address} onChangeText={setAddress} />
      <TextField label="Ilaqa" value={area} onChangeText={setArea} placeholder="DHA Phase 6" />
      <TextField label="Bookings ke liye WhatsApp" value={whatsapp} onChangeText={setWhatsapp} placeholder="+923001234567" keyboardType="phone-pad" mono />

      <View className="gap-2">
        <FieldLabel>Is venue par kaun se sports</FieldLabel>
        <View className="flex-row flex-wrap gap-2">
          {SPORT_OPTIONS.map((sp) => (
            <Chip key={sp} label={sp} selected={!!findSport(sports, sp)} onPress={() => toggleSport(sp)} />
          ))}
        </View>
        {blockedSport ? (
          <Text variant="meta" weight="bold" tone="danger">
            Aap ka ek {blockedSport} court abhi bhi hai. Ye sport hatane se pehle Courts mein us court ko badlein ya delete karein.
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
          <SecondaryButton label={locating ? "Location dhoond rahe hain..." : "Pin meri abhi ki location par lagayein"} onPress={updatePin} />
        </View>
      )}

        </>
      ) : (
        <>
      <SectionLabel>Bank details (players ye pay screen par dekhte hain)</SectionLabel>
      <TextField label="Bank ka naam" value={bankName} onChangeText={setBankName} placeholder="Meezan Bank" error={bankName ? bErrors.bank : null} />
      <TextField label="Account ka naam" value={accountTitle} onChangeText={setAccountTitle} placeholder="Padel Republic" error={accountTitle ? bErrors.title : null} />
      <TextField label="Account number" value={accountNumber} onChangeText={setAccountNumber} placeholder="03445551234 ya 12345678901234" keyboardType="number-pad" mono error={accountNumber ? bErrors.num : null} />
      {/* Bank changes are the highest-risk edit on this screen. Inline nudge, no re-verification
          wall -- see the web mirror for the trade-off note. */}
      {readOnly ? null : (
        <Text variant="meta" tone="waiting">
          Players ka paisa isi account mein jata hai. Dhyan se badlein.
        </Text>
      )}
        </>
      )}
      {message ? (
        <Text accessibilityRole="alert" variant="bodyBold" tone={message.ok ? "info" : "danger"}>
          {message.text}
        </Text>
      ) : null}
      <PrimaryButton label={part === "bank" ? "Bank details save karein" : "Venue details save karein"} onPress={save} disabled={!canSave || saving} loading={saving} />
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
      notify("Save ho gaya", "Cancel policy har court par lag gayi.", "success");
    } catch (e) {
      notify("Save nahi hua", friendlyErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View className="gap-3">
      <CancellationPolicyFields allowed={allowed} cutoffHours={cutoff} onAllowedChange={setAllowed} onCutoffChange={setCutoff} />
      <PrimaryButton label="Cancel policy save karein" onPress={save} loading={saving} />
    </View>
  );
}

/** audit 2026-10-28 Phase 3 item 3: the owner-funded points discount (500 points -> this many rupees off one booking). */
function PointsDiscountCard({ venueId, initialEnabled, initialAmount }: { venueId: string; initialEnabled: boolean; initialAmount: number }) {
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [amount, setAmount] = useState(String(initialAmount));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const n = Number(amount);
  const problem = enabled && (!amount.trim() || !Number.isInteger(n) || n < 1 || n > 100000) ? "1 se 100,000 ke beech raqam likhein." : null;

  async function save() {
    if (problem) return;
    setSaving(true);
    setMessage(null);
    try {
      await api.venues.update(venueId, { points_discount_enabled: enabled, ...(amount.trim() ? { points_discount_pkr: n } : {}) });
      await queryClient.invalidateQueries({ queryKey: ["owner-venues"] });
      setMessage({ ok: true, text: "Save ho gaya." });
    } catch (e) {
      setMessage({ ok: false, text: friendlyErrorMessage(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard>
      <SectionLabel>Points ki chhoot</SectionLabel>
      <Text variant="meta" tone="muted">
        Player 500 points de kar aap ke venue par itni chhoot le sakta hai. Ye chhoot aap dete hain.
      </Text>
      <SegmentedToggle
        options={[
          { value: "off", label: "Band" },
          { value: "on", label: "Chalu" },
        ]}
        value={enabled ? "on" : "off"}
        onChange={(v) => {
          setMessage(null);
          setEnabled(v === "on");
        }}
        accessibilityLabel="Points ki chhoot"
        testID="points-discount-toggle"
      />
      {enabled ? (
        <TextField
          label="Chhoot ki raqam (PKR)"
          value={amount}
          onChangeText={(v) => {
            setMessage(null);
            setAmount(v.replace(/\D/g, ""));
          }}
          keyboardType="number-pad"
          mono
          error={problem}
          testID="points-discount-amount"
        />
      ) : null}
      {message ? (
        <Text accessibilityRole="alert" variant="bodyBold" tone={message.ok ? "info" : "danger"}>
          {message.text}
        </Text>
      ) : null}
      <PrimaryButton label="Points ki chhoot save karein" onPress={save} disabled={!!problem || saving} loading={saving} />
    </SectionCard>
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
      setMessage({ ok: true, text: "Save ho gaya." });
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
      <PrimaryButton label="Booking ke din save karein" onPress={save} disabled={!!problem || saving} loading={saving} />
    </SectionCard>
  );
}

/** Slot length, hours and prices for ONE court. Seeded once from the court it is mounted for (the parent keys it by
 * court id), so it holds its own edits and never needs an effect to copy server data into state. */
function CourtSettingsForm({
  court,
  venueSports,
  canDelete,
  onDeleted,
  saveRef,
  onSavingChange,
}: {
  court: Court;
  venueSports: string[];
  canDelete: boolean;
  onDeleted: () => void;
  /** The pinned "Sab save karein" footer calls this form's save. */
  saveRef: { current: (() => void) | null };
  onSavingChange: (saving: boolean) => void;
}) {
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
      title: `"${court.name}" delete karein?`,
      message: "Is par nayi bookings band ho jayengi aur ye player app se hat jayega. Purani bookings aur payments aap ke hisaab mein rahengi.",
      confirmLabel: "Delete karein",
      destructive: true,
      onConfirm: async () => {
        setDeleting(true);
        try {
          await api.courts.deactivate(court.id);
          await queryClient.invalidateQueries({ queryKey: ["owner-venues"] });
          onDeleted();
        } catch (e) {
          notify("Delete nahi hua", friendlyErrorMessage(e));
          setDeleting(false);
        }
      },
    });
  }
  const advanceProblem = advanceDraftProblem(advance);

  async function save() {
    if (!identity.name.trim()) {
      notify("Court ka naam likhein", "Court ko ek naam dein.");
      return;
    }
    if (problem) {
      notify("Court check karein", problem);
      return;
    }
    if (advanceProblem) {
      notify("Advance ka rule check karein", advanceProblem);
      return;
    }
    setSaving(true);
    onSavingChange(true);
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
      notify("Save nahi hua", friendlyErrorMessage(e));
    } finally {
      setSaving(false);
      onSavingChange(false);
    }
  }
  saveRef.current = save;

  return (
    <>
      <CourtDetailsGrid
        name={identity.name}
        sport={identity.sport}
        isIndoor={identity.isIndoor}
        slotMinutes={setup.slotMinutes}
        sports={venueSports}
        onChange={(patch) => setIdentity((cur) => ({ ...cur, ...patch }))}
        onSlotChange={(m) => setSetup((cur) => ({ ...cur, slotMinutes: m }))}
        footer={
          <>
            <DefaultHint
              settingKey="court_slot_minutes"
              value={setup.slotMinutes}
              onReset={() => setSetup((cur) => ({ ...cur, slotMinutes: SETTINGS_DEFAULTS.court_slot_minutes.value as number }))}
              testID="default-slot-minutes"
            />
            {setup.slotMinutes !== court.slot_minutes ? (
              <Text variant="caption" tone="muted">
                Slot badalne par pehle se bani bookings apne waqt par rehti hain; qeemat ek kam se kam booking ki hai.
              </Text>
            ) : null}
          </>
        }
      />
      <CourtSetupFields value={setup} onChange={(patch) => setSetup((s) => ({ ...s, ...patch }))} slotChangeNote layout="board" />
      <AdvanceSettings
        value={advance}
        onChange={(patch) => setAdvance((cur) => ({ ...cur, ...patch }))}
        price={advancePriceFromSetup(setup)}
        explain={explain}
        defaultPercentage={basePercentage}
        layout="board"
      />
      {canDelete ? (
        <Pressable
          onPress={confirmDelete}
          disabled={deleting || saving}
          className="min-h-11 items-center justify-center"
          style={{ opacity: deleting || saving ? 0.5 : 1 }}
        >
          <Text variant="bodyBold" tone="danger">
            {deleting ? "Delete ho raha hai…" : "Ye court delete karein"}
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
      notify("Court ka naam likhein", "Court ko ek naam dein.");
      return;
    }
    if (problem) {
      notify("Court check karein", problem);
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
      notify("Court nahi bana", friendlyErrorMessage(e));
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
      <PrimaryButton label="Court banayein" onPress={create} disabled={!valid} loading={saving} />
      <SecondaryButton label="Rehne dein" onPress={onDiscard} />
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
      title={`${courtLabel(court.name, court.sport)} ki photos`}
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
      notify("Tareekh baqi hai", "Band din ki shuru aur khatam hone ki tareekh aur waqt chunein.");
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
      notify("Band din add nahi hua", friendlyErrorMessage(e));
    } finally {
      setAdding(false);
    }
  }

  return (
    <SectionCard>
      <SectionLabel>Band din</SectionLabel>
      {(blackoutsQuery.data ?? []).length === 0 ? (
        <Text variant="meta" tone="muted">Abhi koi band din nahi.</Text>
      ) : (
        (blackoutsQuery.data ?? []).map((b) => (
          <View key={b.id} style={{ backgroundColor: palette.ground, borderRadius: radius.md, padding: space[3], gap: 2 }}>
            <Text variant="bodyBold">{b.title ?? "Band"}</Text>
            <Text variant="caption" tone="muted">
              {formatWhen(b.starts_at, new Date(), "ru")} se {formatWhen(b.ends_at, new Date(), "ru")}
            </Text>
          </View>
        ))
      )}
      {/* adding a blackout needs edit_court_settings (POST /courts/{id}/blackouts); others only see the list */}
      {canEdit ? (
        <>
          <View style={{ height: 1, backgroundColor: palette.divider }} />
          <FieldLabel>Naya band din</FieldLabel>
          <TextField label="Wajah (optional)" value={title} onChangeText={setTitle} placeholder="Maintenance" />
          <DayPicker label="Kis din se" value={startDate} onChange={setStartDate} />
          <TimeField12 label="Kis waqt se" value={startTime} onChange={setStartTime} />
          <DayPicker label="Kis din tak" value={endDate} onChange={setEndDate} />
          <TimeField12 label="Kis waqt tak" value={endTime} onChange={setEndTime} />
          <PrimaryButton label="Band din add karein" onPress={add} loading={adding} />
        </>
      ) : null}
    </SectionCard>
  );
}
