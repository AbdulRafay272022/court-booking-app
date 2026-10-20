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
import { useT } from "@/components/i18n/lang-provider";
import { useFmt } from "@/lib/use-fmt";
import { Chip, Field, FieldLabel, PrimaryButton, SectionCard, SectionLabel } from "@/components/setup/ui";
import { DayPicker, TimeField12 } from "@/components/setup/time-fields";
import { CourtSetupFields } from "@/components/setup/court-setup-fields";
import { CancellationPolicyFields } from "@/components/setup/cancellation-policy-fields";
import { AdvanceRuleFields } from "@/components/setup/advance-rule-fields";
import { advanceDraftErrors, basePriceFromDrafts } from "@/components/setup/advance-preview";
import { VenueTimersCard } from "@/components/setup/venue-timers-card";
import { IdentityCard } from "@/components/identity/identity-card";
import { slotMinutesDefault } from "@/components/settings/hint-state";
import { useAuthStore } from "@/lib/auth-store";
import { PhotoManager } from "@/components/setup/photo-manager";
import { CourtTabs } from "@/components/setup/court-tabs";
import { CourtBasicsFields } from "@/components/setup/court-basics-fields";
import { AmenitiesPicker } from "@/components/setup/amenities-picker";
import { CourtLabel, courtLabel } from "@/components/court-label";

// Sample values shown greyed in empty fields; they are examples, not copy.
const SAMPLE_AREA = "DHA Phase 6"; // i18n-ignore
const SAMPLE_BANK = "Meezan Bank"; // i18n-ignore
const SAMPLE_TITLE = "Padel Republic"; // i18n-ignore

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
  const t = useT();
  const { activeVenue } = useOwnerVenues();
  const isOwner = useAuthStore((s) => s.user?.role) === "owner";
  const [tab, setTab] = useState<SettingsTab>("venue");

  return (
    <div className="p-4 sm:p-8 max-w-3xl flex flex-col gap-6 min-w-0">
      <h1 className="text-2xl font-bold">{t("setup.set.title")}</h1>

      {/* Venue-level and court-level settings live on separate tabs so it is always clear what an edit applies to. */}
      <div role="tablist" aria-label={t("setup.set.sectionsAria")} className="flex gap-1 border-b border-owner-border">
        {(
          [
            ["venue", t("setup.set.tabVenue")],
            ["courts", t("setup.set.tabCourts")],
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
          {activeVenue ? <VenueBasicsCard key={`basics-${activeVenue.id}`} venue={activeVenue} /> : <p className="text-owner-ink-faint">{t("setup.set.loading")}</p>}
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
          {/* Stage 2: hold / reminders / auto-cancel per venue (null = default), saved with PUT .../timers. */}
          {activeVenue ? <VenueTimersCard key={`timers-${activeVenue.id}`} venueId={activeVenue.id} /> : null}
          {/* Stage 2: the owner's own CNIC (account-level, not per venue); staff never see it. */}
          {isOwner ? (
            <div id="cnic" className="scroll-mt-4">
              <IdentityCard />
            </div>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-6" role="tabpanel" aria-labelledby="settings-tab-courts" data-testid="settings-courts">
          {activeVenue ? <CourtsSection key={activeVenue.id} venue={activeVenue} /> : <p className="text-owner-ink-faint">{t("setup.set.loading")}</p>}
        </div>
      )}
    </div>
  );
}

function VenuePhotosCard({ venue }: { venue: Venue }) {
  const t = useT();
  const queryClient = useQueryClient();
  return (
    <SectionCard>
      <SectionLabel>{t("setup.set.venuePhotos")}</SectionLabel>
      <PhotoManager
        label={t("setup.set.venuePhotos")}
        testKey="Venue photos"
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
 * the selected court everything court-level -- name, sport, indoor, minimum booking time, hours, prices, advance rule, photos,
 * blackouts. */
function CourtsSection({ venue }: { venue: Venue }) {
  const t = useT();
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
      if (draftDirty && !window.confirm(t("setup.set.discardConfirm"))) return;
      setDrafting(false);
      setDraftDirty(false);
      setSelected(Math.max(0, courts.length - 1));
      return;
    }
    const c = courts[active];
    if (!c) return;
    // Soft-delete: the backend deactivates the court (is_active=false). Existing bookings and
    // their payments are untouched and stay in the ledger (post-batch #2) -- say so in the confirm.
    if (!window.confirm(t("setup.set.deleteConfirm", { label: courtLabel(c.name, c.sport) }))) return;
    try {
      await api.courts.deactivate(c.id);
      await queryClient.invalidateQueries({ queryKey: ["owner-venues"] });
      setSelected(Math.max(0, active - 1));
    } catch (e) {
      setDeleteError(friendlyErrorMessage(e, t));
    }
  }

  return (
    <>
      <p className="text-[13.5px] font-medium text-owner-ink-muted">
        {t("setup.set.courtsIntro")}
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
        <p className="text-owner-ink-faint">{t("setup.set.noCourts")}</p>
      ) : loading ? (
        <p className="text-owner-ink-faint">{t("setup.set.loading")}</p>
      ) : courtQuery.isError ? (
        <ErrorState message={friendlyErrorMessage(courtQuery.error, t)} onRetry={() => courtQuery.refetch()} tone="owner" />
      ) : court ? (
        <>
          {/* keyed by court so switching court re-seeds the form from that court (no effect needed) */}
          <CourtSettingsForm key={court.id} court={court} venueSports={venue.sports} />
          <SectionCard key={`photos-${court.id}`}>
            <SectionLabel>{t("setup.set.courtPhotosTitle", { label: courtLabel(court.name, court.sport) })}</SectionLabel>
            <PhotoManager
              label={t("setup.set.courtPhotos", { name: court.name })}
              testKey={`${court.name} photos`}
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
  const t = useT();
  const fmt = useFmt();
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
    if (!name.trim()) { setMessage({ kind: "error", text: t("setup.set.needName") }); return; }
    if (problem) { setMessage({ kind: "error", text: fmt.validation(problem) }); return; }
    setSaving(true);
    setMessage(null);
    try {
      const { court } = await api.courts.create(venue.id, { name: name.trim(), sport, slot_minutes: setup.slotMinutes, is_indoor: isIndoor });
      await api.courts.setSchedule(court.id, buildSchedules(setup));
      await api.courts.setPricing(court.id, buildPricingRules(setup));
      await queryClient.invalidateQueries({ queryKey: ["owner-venues"] });
      onCreated();
    } catch (e) {
      setMessage({ kind: "error", text: friendlyErrorMessage(e, t) });
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
        note={t("setup.set.newCourtNote")}
        onChange={(patch) => {
          onDirty();
          if (patch.name !== undefined) setName(patch.name);
          if (patch.sport !== undefined) setSport(patch.sport);
          if (patch.isIndoor !== undefined) setIsIndoor(patch.isIndoor);
        }}
      />
      <CourtSetupFields
        value={setup}
        defaultSlotMinutes={slotMinutesDefault("wizard")}
        onChange={(patch) => {
          onDirty();
          setSetup((s) => ({ ...s, ...patch }));
        }}
      />
      <SaveMessage message={message} />
      <PrimaryButton label={t("setup.set.createCourt")} onClick={create} busy={saving} ready={valid} />
    </div>
  );
}

function VenueBasicsCard({ venue }: { venue: Venue }) {
  const t = useT();
  const fmt = useFmt();
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
      setMessage({ kind: "error", text: t("setup.set.geoUnsupported") });
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
        setMessage({ kind: "error", text: t("setup.set.geoFailed") });
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  // Bank details are optional but must be all-or-nothing valid (matches BankDetailsIn's server-side
  // check; see QA signup-venue round item 5). Blanking all three clears them.
  const bankTouched = !!(bankName || accountTitle || accountNumber);
  const bErrors = bankTouched
    ? {
        bank: bankNameError(bankName) ? fmt.validation(bankNameError(bankName)!) : null,
        title: accountTitleError(accountTitle) ? fmt.validation(accountTitleError(accountTitle)!) : null,
        num: accountNumberError(accountNumber) ? fmt.validation(accountNumberError(accountNumber)!) : null,
      }
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
      setMessage({ kind: "ok", text: t("setup.set.saved") });
    } catch (e) {
      setMessage({ kind: "error", text: friendlyErrorMessage(e, t) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard>
      <SectionLabel>{t("setup.set.basics")}</SectionLabel>
      <Field label={t("setup.reg.venueName")} value={name} onChange={(e) => setName(e.target.value)} />
      <Field label={t("setup.set.description")} value={description} onChange={(e) => setDescription(e.target.value)} />
      <Field label={t("setup.reg.address")} value={address} onChange={(e) => setAddress(e.target.value)} />
      <Field label={t("setup.reg.area")} value={area} onChange={(e) => setArea(e.target.value)} placeholder={SAMPLE_AREA} />
      <Field label={t("setup.set.whatsapp")} value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+923001234567" mono />

      <div className="flex flex-col gap-2">
        <FieldLabel>{t("setup.reg.sports")}</FieldLabel>
        <div className="flex flex-wrap gap-2">
          {SPORT_OPTIONS.map((s) => (
            <Chip key={s} label={fmt.sport(s)} selected={sports.includes(s)} onClick={() => toggleSport(s)} />
          ))}
        </div>
      </div>

      <AmenitiesPicker
        value={amenities}
        onToggle={(key) => setAmenities((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))}
      />

      <div className="flex flex-col gap-2">
        <FieldLabel>{t("setup.set.pin")}</FieldLabel>
        <button
          type="button"
          onClick={updatePin}
          disabled={pinning}
          className="self-start h-10 px-4 rounded-lg border border-owner-border bg-owner-surface text-[13.5px] font-semibold text-owner-ink-muted disabled:opacity-60"
        >
          {pinning ? t("setup.reg.locating") : t("setup.set.updatePin")}
        </button>
        <div className="flex gap-3">
          <Field label={t("setup.set.lat")} value={lat} onChange={(e) => setLat(e.target.value)} placeholder={t("setup.set.pinPlaceholder")} mono />
          <Field label={t("setup.set.lon")} value={lon} onChange={(e) => setLon(e.target.value)} placeholder={t("setup.set.pinPlaceholder")} mono />
        </div>
        <p className="text-[12px] text-owner-ink-faint">
          {t("setup.set.pinHelp")}
        </p>
      </div>

      <div className="flex flex-col gap-3 pt-2 border-t border-owner-border-light">
        <SectionLabel>{t("setup.set.bankTitle")}</SectionLabel>
        <Field label={t("setup.bank.name")} value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder={SAMPLE_BANK} error={bankName ? bErrors.bank : null} />
        <Field label={t("setup.bank.title")} value={accountTitle} onChange={(e) => setAccountTitle(e.target.value)} placeholder={SAMPLE_TITLE} error={accountTitle ? bErrors.title : null} />
        <Field label={t("setup.bank.number")} value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} placeholder={t("setup.bank.numberPlaceholder")} mono error={accountNumber ? bErrors.num : null} />
        {/* Bank changes are the highest-risk edit here (money goes where these fields say it goes).
            Show a plain-text nudge so an owner doesn't mistake this for a low-stakes change. This is the
            "extra safeguard" for bank_details per the round's flag-back: an inline warning, not a
            re-verification wall, since the pilot has no email/2FA and the owner is already
            authenticated. If a fuller ceremony is wanted later (admin notice / OTP re-verify), it goes
            here. */}
        <p className="text-[12.5px] font-medium text-owner-warn">
          {t("setup.set.bankWarn")}
        </p>
      </div>

      <SaveMessage message={message} />
      <PrimaryButton label={t("setup.set.saveVenue")} onClick={save} busy={saving} ready={canSave} />
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
  const t = useT();
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
      setMessage({ kind: "ok", text: t("setup.set.cancelSaved") });
    } catch (e) {
      setMessage({ kind: "error", text: friendlyErrorMessage(e, t) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="venue-cancellation">
      <CancellationPolicyFields allowed={allowed} cutoffHours={cutoff} onAllowedChange={setAllowed} onCutoffChange={setCutoff} />
      <SaveMessage message={message} />
      <PrimaryButton label={t("setup.set.saveCancel")} onClick={save} busy={saving} />
    </div>
  );
}

/** Everything court-level for ONE court: name, sport, indoor, minimum booking time, hours, prices and the advance rule. Seeded once
 * from the court it is mounted for (the parent keys it by court id), so it holds its own edits and never needs an
 * effect to copy server data into state. Deleting the court is the tab control's job (CourtsSection). */
function CourtSettingsForm({ court, venueSports }: { court: Court; venueSports: string[] }) {
  const t = useT();
  const fmt = useFmt();
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
  const advanceErrors = advanceDraftErrors({ advanceType, advanceValue, advanceMinimum });
  const advanceProblem =
    advanceType !== "" && !advanceValue.trim()
      ? t("setup.set.advanceProblem")
      : advanceErrors.value === "percent"
        ? t("adv.err.percent")
        : advanceErrors.value === "amount"
          ? t("adv.err.amount")
          : advanceErrors.minimum
            ? t("adv.err.minimum")
            : null;
  // Round 2 A11: the server's own explanation (default rule, "if you set nothing"); an older backend 404s and the card
  // then computes the same numbers from the typed prices (packages/types advance-example.ts mirrors the backend).
  const explain = useQuery({
    queryKey: ["advance-explain", court.id],
    queryFn: () => api.owners.advanceExplain(court.id),
    retry: false,
    staleTime: 60_000,
  });
  const savedDefaultPct =
    explain.data?.default_rule.percentage ??
    (court.pricing_rules.find((r) => r.is_active)?.advance_percentage ?? null);

  async function save() {
    if (!name.trim()) {
      setMessage({ kind: "error", text: t("setup.set.needName") });
      return;
    }
    if (problem) {
      setMessage({ kind: "error", text: fmt.validation(problem) });
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
      setMessage({ kind: "ok", text: t("setup.set.courtSaved", { label: courtLabel(name.trim(), sport) }) });
    } catch (e) {
      setMessage({ kind: "error", text: friendlyErrorMessage(e, t) });
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
      <CourtSetupFields
        value={setup}
        onChange={(patch) => setSetup((s) => ({ ...s, ...patch }))}
        slotChangeNote
        defaultSlotMinutes={slotMinutesDefault("settings")}
      />
      <AdvanceRuleFields
        advanceType={advanceType}
        advanceValue={advanceValue}
        advanceMinimum={advanceMinimum}
        unitPrice={basePriceFromDrafts(setup.pricingRules)}
        unitMinutes={setup.slotMinutes}
        defaultPercentage={savedDefaultPct}
        nothingSet={
          explain.data
            ? { amount: explain.data.default_rule.value_if_nothing_set, percentage: explain.data.default_rule.percentage }
            : null
        }
        onChange={(patch) => {
          if (patch.advanceType !== undefined) setAdvanceType(patch.advanceType);
          if (patch.advanceValue !== undefined) setAdvanceValue(patch.advanceValue);
          if (patch.advanceMinimum !== undefined) setAdvanceMinimum(patch.advanceMinimum);
        }}
      />
      <SaveMessage message={message} />
      <PrimaryButton label={t("setup.set.saveChanges")} onClick={save} busy={saving} />
    </>
  );
}

function BlackoutsCard({ courtId }: { courtId: string }) {
  const t = useT();
  const fmt = useFmt();
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
      setError(t("setup.set.blackoutPick"));
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
      setError(friendlyErrorMessage(e, t));
    } finally {
      setAdding(false);
    }
  }

  return (
    <SectionCard>
      <SectionLabel>{t("setup.set.blackoutTitle")}</SectionLabel>
      {(blackoutsQuery.data ?? []).length === 0 ? (
        <p className="text-owner-ink-faint text-[13px]">{t("setup.set.blackoutNone")}</p>
      ) : (
        (blackoutsQuery.data ?? []).map((b) => (
          <div key={b.id} className="border border-owner-border rounded-[10px] p-3">
            <p className="text-sm font-semibold">{b.title ?? t("setup.set.blocked")}</p>
            <p className="font-mono text-xs text-owner-ink-faint mt-0.5">
              {t("setup.set.blackoutRange", { start: fmt.when(b.starts_at), end: fmt.when(b.ends_at) })}
            </p>
          </div>
        ))
      )}
      <div className="h-px bg-owner-border-light" />
      <FieldLabel>{t("setup.set.blackoutAdd")}</FieldLabel>
      <div className="flex flex-wrap gap-3">
        <Field label={t("setup.set.blackoutName")} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("setup.set.blackoutPlaceholder")} />
        <div className="flex flex-col gap-3 w-full">
          <DayPicker label={t("setup.set.startsOn")} value={startDate} onChange={setStartDate} />
          <TimeField12 label={t("setup.set.startsAt")} value={startTime} onChange={setStartTime} />
          <DayPicker label={t("setup.set.endsOn")} value={endDate} onChange={setEndDate} />
          <TimeField12 label={t("setup.set.endsAt")} value={endTime} onChange={setEndTime} />
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-[13px] font-semibold text-owner-danger">
          {error}
        </p>
      ) : null}
      <PrimaryButton label={t("setup.set.blackoutButton")} onClick={add} busy={adding} />
    </SectionCard>
  );
}
