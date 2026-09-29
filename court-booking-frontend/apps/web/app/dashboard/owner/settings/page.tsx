"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  accountNumberError,
  accountTitleError,
  bankNameError,
  buildPricingRules,
  buildSchedules,
  courtSetupFromCourt,
  courtSetupProblem,
  defaultCourtSetup,
  pktInstant,
  SPORT_OPTIONS,
  type Court,
  type CourtSetup,
  type CreateCourtInput,
  type Venue,
} from "@court-booking/types";
import { api } from "@/lib/api";
import { ErrorState } from "@/components/error-state";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { formatWhen } from "@/lib/format";
import { Chip, Field, FieldLabel, PrimaryButton, SectionCard, SectionLabel } from "@/components/setup/ui";
import { DayPicker, TimeField12 } from "@/components/setup/time-fields";
import { CourtSetupFields } from "@/components/setup/court-setup-fields";
import { CancellationPolicyFields } from "@/components/setup/cancellation-policy-fields";
import { AdvanceRuleFields } from "@/components/setup/advance-rule-fields";
import { PhotoManager } from "@/components/setup/photo-manager";
import { CourtTabs } from "@/components/setup/court-tabs";
import { CourtBasicsFields } from "@/components/setup/court-basics-fields";
import { AmenitiesPicker } from "@/components/setup/amenities-picker";
import { CourtLabel, courtLabel } from "@/components/court-label";

const MAX_VENUE_PHOTOS = 8;
const MAX_COURT_PHOTOS = 5;

type Message = { kind: "ok" | "error"; text: string } | null;

function SaveMessage({ message }: { message: Message }) {
  if (!message) return null;
  return (
    <p role="alert" className={`text-[13.5px] font-semibold ${message.kind === "ok" ? "text-owner-accent" : "text-owner-danger"}`}>
      {message.text}
    </p>
  );
}

type SettingsTab = "venue" | "courts";

export default function VenueSettingsPage() {
  const { activeVenue } = useOwnerVenues();
  const [tab, setTab] = useState<SettingsTab>("venue");

  return (
    <div className="p-8 max-w-3xl flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      {/* Venue-level and court-level settings live on separate tabs so it is always clear what an edit applies to. */}
      <div role="tablist" aria-label="Settings sections" className="flex gap-1 border-b border-owner-border">
        {(
          [
            ["venue", "Venue"],
            ["courts", "Courts"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            id={`settings-tab-${key}`}
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`px-5 py-3 text-[14.5px] font-bold -mb-px border-b-2 ${
              tab === key ? "border-owner-accent text-owner-accent" : "border-transparent text-owner-ink-faint"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "venue" ? (
        <div className="flex flex-col gap-6" role="tabpanel" aria-labelledby="settings-tab-venue" data-testid="settings-venue">
          {/* QA signup-venue round item 3: post-approval editing for the fields the wizard's own
              copy already promised are editable -- name, WhatsApp, sports, address, area, location
              pin, bank details, amenities. */}
          {activeVenue ? <VenueBasicsCard key={`basics-${activeVenue.id}`} venue={activeVenue} /> : <p className="text-owner-ink-faint">Loading…</p>}
          {activeVenue ? <VenuePhotosCard venue={activeVenue} /> : null}
          {/* ONE cancellation policy for the whole venue (Section 32 Part 4). */}
          {activeVenue ? (
            <VenueCancellationCard
              key={activeVenue.id}
              venueId={activeVenue.id}
              initialAllowed={activeVenue.cancellation_allowed}
              initialCutoff={activeVenue.cancellation_cutoff_hours}
            />
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-6" role="tabpanel" aria-labelledby="settings-tab-courts" data-testid="settings-courts">
          {activeVenue ? <CourtsSection key={activeVenue.id} venue={activeVenue} /> : <p className="text-owner-ink-faint">Loading…</p>}
        </div>
      )}
    </div>
  );
}

function VenuePhotosCard({ venue }: { venue: Venue }) {
  const queryClient = useQueryClient();
  return (
    <SectionCard>
      <SectionLabel>Venue photos</SectionLabel>
      <PhotoManager
        label="Venue photos"
        photoUrls={venue.photo_urls}
        photoKeys={venue.photo_keys}
        max={MAX_VENUE_PHOTOS}
        onUpload={async (blob) => {
          await api.venues.uploadPhoto(venue.id, blob);
          await queryClient.invalidateQueries({ queryKey: ["owner-venues"] });
        }}
        onReorder={async (keys) => {
          await api.venues.reorderPhotos(venue.id, keys);
          await queryClient.invalidateQueries({ queryKey: ["owner-venues"] });
        }}
      />
    </SectionCard>
  );
}

/** The Courts tab: one tab per court (the shared CourtTabs), a "+ Court" that opens an unsaved new-court tab, and for
 * the selected court everything court-level -- name, sport, indoor, slot length, hours, prices, advance rule, photos,
 * blackouts. */
function CourtsSection({ venue }: { venue: Venue }) {
  const queryClient = useQueryClient();
  // Only ACTIVE courts are editable here -- a deactivated ("deleted") court shouldn't be a
  // tab in the settings editor. Its history still lives in the ledger (post-batch #2).
  const courts = venue.courts.filter((c) => c.is_active);
  const [selected, setSelected] = useState(0);
  const [drafting, setDrafting] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const tabCount = courts.length + (drafting ? 1 : 0);
  const active = Math.min(selected, Math.max(0, tabCount - 1));
  const onDraft = drafting && active === courts.length;
  const activeCourtId = onDraft ? undefined : courts[active]?.id;

  const courtQuery = useQuery({
    queryKey: ["court-settings", activeCourtId],
    queryFn: () => api.courts.get(activeCourtId!),
    enabled: !!activeCourtId,
  });

  // The app's query client keeps the PREVIOUS query's data while a new one loads (placeholderData), so right after
  // switching court `courtQuery.data` is still the OLD court. A form seeded from it would hold the wrong court's hours
  // and prices, and saving would overwrite this court with them. Only treat the data as ready once it is this court's.
  const court = courtQuery.data && courtQuery.data.id === activeCourtId ? (courtQuery.data as Court) : undefined;
  const loading = !!activeCourtId && !court && !courtQuery.isError;

  async function deleteActive() {
    setDeleteError(null);
    if (onDraft) {
      if (draftDirty && !window.confirm("Discard this new court? Everything you entered for it will be lost.")) return;
      setDrafting(false);
      setDraftDirty(false);
      setSelected(Math.max(0, courts.length - 1));
      return;
    }
    const c = courts[active];
    if (!c) return;
    // Soft-delete: the backend deactivates the court (is_active=false). Existing bookings and
    // their payments are untouched and stay in the ledger (post-batch #2) -- say so in the confirm.
    if (!window.confirm(
      `Delete "${courtLabel(c.name, c.sport)}"? It will stop taking new bookings and disappear from the player app. ` +
      `Its past bookings and payments stay in your ledger.`,
    )) return;
    try {
      await api.courts.deactivate(c.id);
      await queryClient.invalidateQueries({ queryKey: ["owner-venues"] });
      setSelected(Math.max(0, active - 1));
    } catch (e) {
      setDeleteError(friendlyErrorMessage(e));
    }
  }

  return (
    <>
      <p className="text-[13.5px] font-medium text-owner-ink-muted">
        Each court has its own name, sport, slot length, opening hours, prices and photos. Pick a court to edit, or add a new one.
      </p>
      <CourtTabs
        count={tabCount}
        active={active}
        onSelect={setSelected}
        onAdd={() => {
          if (!drafting) setDrafting(true);
          setSelected(courts.length); // the new-court tab is always last
        }}
        addDisabled={drafting}
        canDelete={tabCount > 1}
        onDelete={deleteActive}
      />
      {deleteError ? <p role="alert" className="text-[13px] font-semibold text-owner-danger">{deleteError}</p> : null}

      {onDraft ? (
        <NewCourtForm
          key="new-court"
          venue={venue}
          defaultName={`Court ${courts.length + 1}`}
          onDirty={() => setDraftDirty(true)}
          onCreated={() => {
            // The saved court takes the draft tab's slot (the tab index is unchanged), so we land on it.
            setDrafting(false);
            setDraftDirty(false);
          }}
        />
      ) : courts.length === 0 ? (
        <p className="text-owner-ink-faint">No courts yet — use “+ Court” to add your first one.</p>
      ) : loading ? (
        <p className="text-owner-ink-faint">Loading…</p>
      ) : courtQuery.isError ? (
        <ErrorState message={friendlyErrorMessage(courtQuery.error)} onRetry={() => courtQuery.refetch()} tone="owner" />
      ) : court ? (
        <>
          {/* keyed by court so switching court re-seeds the form from that court (no effect needed) */}
          <CourtSettingsForm key={court.id} court={court} venueSports={venue.sports} />
          <SectionCard key={`photos-${court.id}`}>
            <SectionLabel>{courtLabel(court.name, court.sport)} photos</SectionLabel>
            <PhotoManager
              label={`${court.name} photos`}
              photoUrls={court.photo_urls}
              photoKeys={court.photo_keys}
              max={MAX_COURT_PHOTOS}
              onUpload={async (blob) => {
                await api.courts.uploadPhoto(court.id, blob);
                await queryClient.invalidateQueries({ queryKey: ["court-settings", court.id] });
                await queryClient.invalidateQueries({ queryKey: ["owner-venues"] });
              }}
              onReorder={async (keys) => {
                await api.courts.reorderPhotos(court.id, keys);
                await queryClient.invalidateQueries({ queryKey: ["court-settings", court.id] });
                await queryClient.invalidateQueries({ queryKey: ["owner-venues"] });
              }}
            />
          </SectionCard>
          <BlackoutsCard key={`blackouts-${court.id}`} courtId={court.id} />
        </>
      ) : null}
    </>
  );
}

/** The unsaved "new court" tab. Nothing is sent until "Create court"; photos need the court to exist first. */
function NewCourtForm({
  venue,
  defaultName,
  onDirty,
  onCreated,
}: {
  venue: Venue;
  defaultName: string;
  onDirty: () => void;
  onCreated: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(defaultName);
  const [sport, setSport] = useState(venue.sports[0] ?? "Padel");
  const [isIndoor, setIsIndoor] = useState(false);
  const [setup, setSetup] = useState<CourtSetup>(() => defaultCourtSetup());
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const problem = courtSetupProblem(setup);
  const valid = name.trim().length > 0 && sport.trim().length > 0 && !problem;

  async function create() {
    if (!name.trim()) { setMessage({ kind: "error", text: "Give the court a name." }); return; }
    if (problem) { setMessage({ kind: "error", text: problem }); return; }
    setSaving(true);
    setMessage(null);
    try {
      const { court } = await api.courts.create(venue.id, { name: name.trim(), sport, slot_minutes: setup.slotMinutes, is_indoor: isIndoor });
      await api.courts.setSchedule(court.id, buildSchedules(setup));
      await api.courts.setPricing(court.id, buildPricingRules(setup));
      await queryClient.invalidateQueries({ queryKey: ["owner-venues"] });
      onCreated();
    } catch (e) {
      setMessage({ kind: "error", text: friendlyErrorMessage(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4" data-testid="new-court-form">
      <CourtBasicsFields
        name={name}
        sport={sport}
        isIndoor={isIndoor}
        sportOptions={venue.sports}
        note="Save the court first, then add its photos from its tab."
        onChange={(patch) => {
          onDirty();
          if (patch.name !== undefined) setName(patch.name);
          if (patch.sport !== undefined) setSport(patch.sport);
          if (patch.isIndoor !== undefined) setIsIndoor(patch.isIndoor);
        }}
      />
      <CourtSetupFields
        value={setup}
        onChange={(patch) => {
          onDirty();
          setSetup((s) => ({ ...s, ...patch }));
        }}
      />
      <SaveMessage message={message} />
      <PrimaryButton label="Create court" onClick={create} busy={saving} ready={valid} />
    </div>
  );
}

function VenueBasicsCard({ venue }: { venue: Venue }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(venue.name);
  const [description, setDescription] = useState(venue.description ?? "");
  const [address, setAddress] = useState(venue.address);
  const [area, setArea] = useState(venue.area ?? "");
  const [whatsapp, setWhatsapp] = useState(venue.whatsapp ?? "");
  const [sports, setSports] = useState<string[]>(venue.sports);
  const [amenities, setAmenities] = useState<string[]>(venue.amenities ?? []);
  // Latitude/longitude are write-only on the backend read schema (VenueOut), so we can't seed
  // from the current pin; we just let the owner set new coordinates if they want to move it.
  // Empty string in either box = "don't touch the pin on this save".
  const [lat, setLat] = useState<string>("");
  const [lon, setLon] = useState<string>("");
  const [pinning, setPinning] = useState(false);
  const [bankName, setBankName] = useState(venue.bank_details?.bank ?? "");
  const [accountTitle, setAccountTitle] = useState(venue.bank_details?.account_title ?? "");
  const [accountNumber, setAccountNumber] = useState(venue.bank_details?.account_number ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  function updatePin() {
    if (!("geolocation" in navigator)) {
      setMessage({ kind: "error", text: "This browser can't share a location." });
      return;
    }
    setPinning(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(String(pos.coords.latitude));
        setLon(String(pos.coords.longitude));
        setPinning(false);
      },
      () => {
        setPinning(false);
        setMessage({ kind: "error", text: "Couldn't get your location — you can type the coordinates manually below." });
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  // Bank details are optional but must be all-or-nothing valid (matches BankDetailsIn's server-side
  // check; see QA signup-venue round item 5). Blanking all three clears them.
  const bankTouched = !!(bankName || accountTitle || accountNumber);
  const bErrors = bankTouched
    ? { bank: bankNameError(bankName), title: accountTitleError(accountTitle), num: accountNumberError(accountNumber) }
    : { bank: null, title: null, num: null };
  const bankOk = !bankTouched || (!bErrors.bank && !bErrors.title && !bErrors.num);

  const nameOk = name.trim().length > 0;
  const addressOk = address.trim().length > 0;
  const sportsOk = sports.length > 0;
  const canSave = nameOk && addressOk && sportsOk && bankOk;

  function toggleSport(s: string) {
    setSports((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setMessage(null);
    try {
      const latN = lat.trim() ? Number(lat) : NaN;
      const lonN = lon.trim() ? Number(lon) : NaN;
      // Partial<CreateVenueInput> uses `undefined` for optional keys and the backend's
      // VenueUpdateIn treats them the same way (exclude_unset). We deliberately do NOT send
      // an explicit null to CLEAR an optional field here (there is no product need to remove
      // area / description / WhatsApp after approval yet; when the need arises we'll extend
      // the input type to nullable and revisit -- flagged in the round's report).
      const patch: Parameters<typeof api.venues.update>[1] = {
        name: name.trim(),
        description: description.trim() || undefined,
        address: address.trim(),
        area: area.trim() || undefined,
        whatsapp: whatsapp.trim() || undefined,
        sports,
        amenities,
        ...(bankTouched
          ? { bank_details: { bank: bankName, account_title: accountTitle, account_number: accountNumber } }
          : {}),
      };
      if (Number.isFinite(latN) && Number.isFinite(lonN)) {
        patch.latitude = latN;
        patch.longitude = lonN;
      }
      await api.venues.update(venue.id, patch);
      await queryClient.invalidateQueries({ queryKey: ["owner-venues"] });
      setMessage({ kind: "ok", text: "Saved. Players see the new details right away." });
    } catch (e) {
      setMessage({ kind: "error", text: friendlyErrorMessage(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard>
      <SectionLabel>Venue basics</SectionLabel>
      <Field label="Venue name" value={name} onChange={(e) => setName(e.target.value)} />
      <Field label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
      <Field label="Street address" value={address} onChange={(e) => setAddress(e.target.value)} />
      <Field label="Area" value={area} onChange={(e) => setArea(e.target.value)} placeholder="DHA Phase 6" />
      <Field label="WhatsApp number for bookings" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+923001234567" mono />

      <div className="flex flex-col gap-2">
        <FieldLabel>Sports you offer</FieldLabel>
        <div className="flex flex-wrap gap-2">
          {SPORT_OPTIONS.map((s) => (
            <Chip key={s} label={s} selected={sports.includes(s)} onClick={() => toggleSport(s)} />
          ))}
        </div>
      </div>

      <AmenitiesPicker
        value={amenities}
        onToggle={(key) => setAmenities((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))}
      />

      <div className="flex flex-col gap-2">
        <FieldLabel>Location pin (players use this to find the gate)</FieldLabel>
        <button
          type="button"
          onClick={updatePin}
          disabled={pinning}
          className="self-start h-10 px-4 rounded-lg border border-owner-border bg-owner-surface text-[13.5px] font-semibold text-owner-ink-muted disabled:opacity-60"
        >
          {pinning ? "Locating…" : "Update pin from my current location"}
        </button>
        <div className="flex gap-3">
          <Field label="Latitude" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="Leave blank to keep current pin" mono />
          <Field label="Longitude" value={lon} onChange={(e) => setLon(e.target.value)} placeholder="Leave blank to keep current pin" mono />
        </div>
        <p className="text-[12px] text-owner-ink-faint">
          Leave both boxes blank to keep the current pin. Fill both to move it (e.g. after using the button above).
        </p>
      </div>

      <div className="flex flex-col gap-3 pt-2 border-t border-owner-border-light">
        <SectionLabel>Bank details (players see these on the pay screen)</SectionLabel>
        <Field label="Bank name" value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="Meezan Bank" error={bankName ? bErrors.bank : null} />
        <Field label="Account title" value={accountTitle} onChange={(e) => setAccountTitle(e.target.value)} placeholder="Padel Republic" error={accountTitle ? bErrors.title : null} />
        <Field label="Account number" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} placeholder="03445551234 or 12345678901234" mono error={accountNumber ? bErrors.num : null} />
        {/* Bank changes are the highest-risk edit here (money goes where these fields say it goes).
            Show a plain-text nudge so an owner doesn't mistake this for a low-stakes change. This is the
            "extra safeguard" for bank_details per the round's flag-back: an inline warning, not a
            re-verification wall, since the pilot has no email/2FA and the owner is already
            authenticated. If a fuller ceremony is wanted later (admin notice / OTP re-verify), it goes
            here. */}
        <p className="text-[12.5px] font-medium text-owner-warn">
          These fields decide where players send their money. Update carefully.
        </p>
      </div>

      <SaveMessage message={message} />
      <PrimaryButton label="Save venue details" onClick={save} busy={saving} ready={canSave} />
    </SectionCard>
  );
}

function VenueCancellationCard({
  venueId,
  initialAllowed,
  initialCutoff,
}: {
  venueId: string;
  initialAllowed: boolean;
  initialCutoff: number | null;
}) {
  const queryClient = useQueryClient();
  const [allowed, setAllowed] = useState(initialAllowed);
  const [cutoff, setCutoff] = useState(initialCutoff != null ? String(initialCutoff) : "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      await api.venues.update(venueId, {
        cancellation_allowed: allowed,
        cancellation_cutoff_hours: allowed && cutoff.trim() ? Number(cutoff) : null,
      });
      // players see this policy before they pay, and the owner lists read it too
      await queryClient.invalidateQueries({ queryKey: ["owner-venues"] });
      setMessage({ kind: "ok", text: "Cancellation policy updated for every court." });
    } catch (e) {
      setMessage({ kind: "error", text: friendlyErrorMessage(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="venue-cancellation">
      <CancellationPolicyFields allowed={allowed} cutoffHours={cutoff} onAllowedChange={setAllowed} onCutoffChange={setCutoff} />
      <SaveMessage message={message} />
      <PrimaryButton label="Save cancellation policy" onClick={save} busy={saving} />
    </div>
  );
}

/** Everything court-level for ONE court: name, sport, indoor, slot length, hours, prices and the advance rule. Seeded once
 * from the court it is mounted for (the parent keys it by court id), so it holds its own edits and never needs an
 * effect to copy server data into state. Deleting the court is the tab control's job (CourtsSection). */
function CourtSettingsForm({ court, venueSports }: { court: Court; venueSports: string[] }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(court.name);
  const [sport, setSport] = useState(court.sport);
  const [isIndoor, setIsIndoor] = useState(court.is_indoor);
  const [setup, setSetup] = useState<CourtSetup>(() => courtSetupFromCourt(court));
  const [advanceType, setAdvanceType] = useState<"" | "fixed" | "percent">(court.advance_type ?? "");
  const [advanceValue, setAdvanceValue] = useState(court.advance_value != null ? String(court.advance_value) : "");
  const [advanceMinimum, setAdvanceMinimum] = useState(court.advance_minimum != null ? String(court.advance_minimum) : "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  const problem = courtSetupProblem(setup);
  const advanceProblem =
    advanceType !== "" && !advanceValue.trim() ? "Enter an advance amount or percentage, or switch back to Default." : null;

  async function save() {
    if (!name.trim()) {
      setMessage({ kind: "error", text: "Give the court a name." });
      return;
    }
    if (problem) {
      setMessage({ kind: "error", text: problem });
      return;
    }
    if (advanceProblem) {
      setMessage({ kind: "error", text: advanceProblem });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const basics: Partial<CreateCourtInput> = {};
      if (name.trim() !== court.name) basics.name = name.trim();
      if (sport !== court.sport) basics.sport = sport;
      if (isIndoor !== court.is_indoor) basics.is_indoor = isIndoor;
      if (setup.slotMinutes !== court.slot_minutes) basics.slot_minutes = setup.slotMinutes;
      if (Object.keys(basics).length > 0) await api.courts.update(court.id, basics);
      await api.courts.update(court.id, {
        advance_type: advanceType || null,
        advance_value: advanceType ? Number(advanceValue) : null,
        advance_minimum: advanceMinimum.trim() ? Number(advanceMinimum) : null,
      });
      await api.courts.setSchedule(court.id, buildSchedules(setup));
      await api.courts.setPricing(court.id, buildPricingRules(setup));
      await queryClient.invalidateQueries({ queryKey: ["court-settings", court.id] });
      await queryClient.invalidateQueries({ queryKey: ["court", court.id] });
      await queryClient.invalidateQueries({ queryKey: ["owner-venues"] });
      setMessage({ kind: "ok", text: `${courtLabel(name.trim(), sport)}: details, slot length, hours, prices and advance rule updated.` });
    } catch (e) {
      setMessage({ kind: "error", text: friendlyErrorMessage(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <h2 className="text-lg font-bold -mb-2" data-testid="court-heading">
        <CourtLabel name={court.name} sport={court.sport} />
      </h2>
      <CourtBasicsFields
        name={name}
        sport={sport}
        isIndoor={isIndoor}
        sportOptions={venueSports}
        onChange={(patch) => {
          if (patch.name !== undefined) setName(patch.name);
          if (patch.sport !== undefined) setSport(patch.sport);
          if (patch.isIndoor !== undefined) setIsIndoor(patch.isIndoor);
        }}
      />
      <CourtSetupFields value={setup} onChange={(patch) => setSetup((s) => ({ ...s, ...patch }))} slotChangeNote />
      <AdvanceRuleFields
        advanceType={advanceType}
        advanceValue={advanceValue}
        advanceMinimum={advanceMinimum}
        onChange={(patch) => {
          if (patch.advanceType !== undefined) setAdvanceType(patch.advanceType);
          if (patch.advanceValue !== undefined) setAdvanceValue(patch.advanceValue);
          if (patch.advanceMinimum !== undefined) setAdvanceMinimum(patch.advanceMinimum);
        }}
      />
      <SaveMessage message={message} />
      <PrimaryButton label="Save changes" onClick={save} busy={saving} />
    </>
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
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (!startDate || !endDate) {
      setError("Pick a start and end date/time for the blackout.");
      return;
    }
    setAdding(true);
    setError(null);
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
      setError(friendlyErrorMessage(e));
    } finally {
      setAdding(false);
    }
  }

  return (
    <SectionCard>
      <SectionLabel>Blackout dates</SectionLabel>
      {(blackoutsQuery.data ?? []).length === 0 ? (
        <p className="text-owner-ink-faint text-[13px]">No blackout dates yet.</p>
      ) : (
        (blackoutsQuery.data ?? []).map((b) => (
          <div key={b.id} className="border border-owner-border rounded-[10px] p-3">
            <p className="text-sm font-semibold">{b.title ?? "Blocked"}</p>
            <p className="font-mono text-xs text-owner-ink-faint mt-0.5">
              {formatWhen(b.starts_at)} to {formatWhen(b.ends_at)}
            </p>
          </div>
        ))
      )}
      <div className="h-px bg-owner-border-light" />
      <FieldLabel>Add a blackout</FieldLabel>
      <div className="flex flex-wrap gap-3">
        <Field label="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Maintenance" />
        <div className="flex flex-col gap-3 w-full">
          <DayPicker label="Starts on" value={startDate} onChange={setStartDate} />
          <TimeField12 label="Starts at" value={startTime} onChange={setStartTime} />
          <DayPicker label="Ends on" value={endDate} onChange={setEndDate} />
          <TimeField12 label="Ends at" value={endTime} onChange={setEndTime} />
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-[13px] font-semibold text-owner-danger">
          {error}
        </p>
      ) : null}
      <PrimaryButton label="Add blackout" onClick={add} busy={adding} />
    </SectionCard>
  );
}
