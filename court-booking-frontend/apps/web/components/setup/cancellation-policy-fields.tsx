"use client";

import { Chip, Field, FieldLabel, SectionCard, SectionLabel } from "./ui";

/**
 * The venue's ONE cancellation policy (Section 32 Part 4: per venue, not per court). Used by the venue step of the
 * setup wizard and by Venue Settings. Players are shown this before they pay.
 */
export function CancellationPolicyFields({
  allowed,
  cutoffHours,
  onAllowedChange,
  onCutoffChange,
}: {
  allowed: boolean;
  /** Empty string = no cutoff (cancellable any time before the start). */
  cutoffHours: string;
  onAllowedChange: (allowed: boolean) => void;
  onCutoffChange: (hours: string) => void;
}) {
  return (
    <SectionCard>
      <SectionLabel>Cancellations</SectionLabel>
      <div className="flex flex-col gap-2">
        <FieldLabel>Can a player cancel a booking after they&apos;ve already paid? This applies to every court at your venue.</FieldLabel>
        <div className="flex gap-2">
          <Chip label="Allowed" selected={allowed} onClick={() => onAllowedChange(true)} />
          <Chip label="Not allowed" selected={!allowed} onClick={() => onAllowedChange(false)} />
        </div>
      </div>
      {allowed ? (
        <Field
          label="Require cancelling at least this many hours before (optional)"
          value={cutoffHours}
          onChange={(e) => onCutoffChange(e.target.value.replace(/\D/g, ""))}
          inputMode="numeric"
          placeholder="Leave blank for no limit"
          mono
        />
      ) : null}
    </SectionCard>
  );
}
