"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  buildPricingRules,
  buildSchedules,
  courtSetupFromCourt,
  courtSetupProblem,
  defaultCourtSetup,
  pktInstant,
  type Court,
  type CourtSetup,
  type Venue,
} from "@court-booking/types";
import { api } from "@/lib/api";
import { ErrorState } from "@/components/error-state";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { formatWhen } from "@/lib/format";
import { Field, FieldLabel, PrimaryButton, SectionCard, SectionLabel } from "@/components/setup/ui";
import { DayPicker, TimeField12 } from "@/components/setup/time-fields";
import { CourtSetupFields } from "@/components/setup/court-setup-fields";
import { CancellationPolicyFields } from "@/components/setup/cancellation-policy-fields";
import { AdvanceRuleFields } from "@/components/setup/advance-rule-fields";
import { PhotoManager } from "@/components/setup/photo-manager";

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

export default function VenueSettingsPage() {
  const { activeVenue, isLoading: venuesLoading } = useOwnerVenues();
  const queryClient = useQueryClient();
  // Only ACTIVE courts are editable here -- a deactivated ("deleted") court shouldn't be a
  // tab in the settings editor. Its history still lives in the ledger (post-batch #2).
  const courts = (activeVenue?.courts ?? []).filter((c) => c.is_active);
  const [courtId, setCourtId] = useState<string | undefined>(undefined);
  // If the selected court is no longer in the active list (e.g. just deleted), fall back to the first.
  const activeCourtId = (courtId && courts.some((c) => c.id === courtId) ? courtId : undefined) ?? courts[0]?.id;

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
    <div className="p-8 max-w-3xl flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Venue settings</h1>

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
        <SectionCard>
          <SectionLabel>Venue photos</SectionLabel>
          <PhotoManager
            label="Venue photos"
            photoUrls={activeVenue.photo_urls}
            photoKeys={activeVenue.photo_keys}
            max={MAX_VENUE_PHOTOS}
            onUpload={async (blob) => {
              await api.venues.uploadPhoto(activeVenue.id, blob);
              await queryClient.invalidateQueries({ queryKey: ["owner-venues"] });
            }}
            onReorder={async (keys) => {
              await api.venues.reorderPhotos(activeVenue.id, keys);
              await queryClient.invalidateQueries({ queryKey: ["owner-venues"] });
            }}
          />
        </SectionCard>
      ) : null}

      {courts.length > 1 ? (
        <div className="flex flex-col gap-2">
          <FieldLabel>Each court has its own slot length, opening hours and prices. Pick a court to edit:</FieldLabel>
          <div className="flex flex-wrap gap-2">
            {courts.map((c) => (
              <button
                key={c.id}
                onClick={() => setCourtId(c.id)}
                className="px-3.5 py-2 rounded-lg text-[13px] font-semibold"
                style={{ background: activeCourtId === c.id ? "#0E6274" : "#F4F6F7", color: activeCourtId === c.id ? "#fff" : "#5B7079" }}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {loading ? (
        <p className="text-owner-ink-faint">Loading…</p>
      ) : courtQuery.isError ? (
        <ErrorState message={friendlyErrorMessage(courtQuery.error)} onRetry={() => courtQuery.refetch()} tone="owner" />
      ) : !activeCourtId || !court ? (
        <p className="text-owner-ink-faint">No courts yet — add your first court below.</p>
      ) : (
        <>
          {/* keyed by court so switching court re-seeds the form from that court (no effect needed) */}
          <CourtSettingsForm key={court.id} court={court} canDelete={courts.length > 1} onDeleted={() => setCourtId(undefined)} />
          <SectionCard key={`photos-${court.id}`}>
            <SectionLabel>{court.name} photos</SectionLabel>
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
          <BlackoutsCard key={`blackouts-${activeCourtId}`} courtId={activeCourtId} />
        </>
      )}

      {activeVenue ? <AddCourtCard venue={activeVenue} onAdded={(id) => setCourtId(id)} /> : null}
    </div>
  );
}

/** Add a new court to this venue -- reuses the venue-setup wizard's court fields, and the same
 * create -> setSchedule -> setPricing sequence. Sport is chosen from the venue's existing sports
 * (a select, so casing always matches -- see post-batch #3). */
function AddCourtCard({ venue, onAdded }: { venue: Venue; onAdded: (courtId: string) => void }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [sport, setSport] = useState(venue.sports[0] ?? "");
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
      const { court } = await api.courts.create(venue.id, { name: name.trim(), sport, slot_minutes: setup.slotMinutes });
      await api.courts.setSchedule(court.id, buildSchedules(setup));
      await api.courts.setPricing(court.id, buildPricingRules(setup));
      await queryClient.invalidateQueries({ queryKey: ["owner-venues"] });
      setName("");
      setSetup(defaultCourtSetup());
      setOpen(false);
      onAdded(court.id);
    } catch (e) {
      setMessage({ kind: "error", text: friendlyErrorMessage(e) });
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="self-start px-4 py-2.5 rounded-lg bg-owner-accent text-white font-semibold text-sm"
      >
        + Add court
      </button>
    );
  }

  return (
    <SectionCard>
      <SectionLabel>Add a court</SectionLabel>
      <Field label="Court name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Court 2" />
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Sport</FieldLabel>
        <select
          value={sport}
          onChange={(e) => setSport(e.target.value)}
          className="h-11 px-3 rounded-lg border border-owner-border bg-white text-[14px] outline-none focus:border-owner-accent"
        >
          {venue.sports.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
      <CourtSetupFields value={setup} onChange={(patch) => setSetup((s) => ({ ...s, ...patch }))} />
      <SaveMessage message={message} />
      <div className="flex gap-2">
        <button
          disabled={!valid || saving}
          onClick={create}
          className="px-4 py-2.5 rounded-lg font-semibold text-sm text-white"
          style={{ background: valid ? "#0E6274" : "#C6D2D7" }}
        >
          {saving ? "Adding…" : "Add court"}
        </button>
        <button onClick={() => setOpen(false)} className="px-4 py-2.5 rounded-lg font-semibold text-sm border border-owner-border">
          Cancel
        </button>
      </div>
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

/** Slot length, hours and prices for ONE court. Seeded once from the court it is mounted for (the parent keys it by
 * court id), so it holds its own edits and never needs an effect to copy server data into state. */
function CourtSettingsForm({ court, canDelete, onDeleted }: { court: Court; canDelete: boolean; onDeleted: () => void }) {
  const queryClient = useQueryClient();
  const [setup, setSetup] = useState<CourtSetup>(() => courtSetupFromCourt(court));
  const [advanceType, setAdvanceType] = useState<"" | "fixed" | "percent">(court.advance_type ?? "");
  const [advanceValue, setAdvanceValue] = useState(court.advance_value != null ? String(court.advance_value) : "");
  const [advanceMinimum, setAdvanceMinimum] = useState(court.advance_minimum != null ? String(court.advance_minimum) : "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  async function remove() {
    // Soft-delete: the backend deactivates the court (is_active=false). Existing bookings and
    // their payments are untouched and stay in the ledger (post-batch #2) -- say so in the confirm.
    if (!window.confirm(
      `Delete "${court.name}"? It will stop taking new bookings and disappear from the player app. ` +
      `Its past bookings and payments stay in your ledger.`,
    )) return;
    setDeleting(true);
    setMessage(null);
    try {
      await api.courts.deactivate(court.id);
      await queryClient.invalidateQueries({ queryKey: ["owner-venues"] });
      onDeleted();
    } catch (e) {
      setMessage({ kind: "error", text: friendlyErrorMessage(e) });
      setDeleting(false);
    }
  }
  const problem = courtSetupProblem(setup);
  const advanceProblem =
    advanceType !== "" && !advanceValue.trim() ? "Enter an advance amount or percentage, or switch back to Default." : null;

  async function save() {
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
      if (setup.slotMinutes !== court.slot_minutes) await api.courts.update(court.id, { slot_minutes: setup.slotMinutes });
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
      setMessage({ kind: "ok", text: `${court.name}: slot length, hours, prices and advance rule updated.` });
    } catch (e) {
      setMessage({ kind: "error", text: friendlyErrorMessage(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <h2 className="text-lg font-bold -mb-2">{court.name}</h2>
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
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <PrimaryButton label="Save changes" onClick={save} busy={saving} />
        {canDelete ? (
          <button
            onClick={remove}
            disabled={deleting || saving}
            className="text-[13px] font-semibold text-owner-danger disabled:opacity-50"
          >
            {deleting ? "Deleting…" : "Delete this court"}
          </button>
        ) : null}
      </div>
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
