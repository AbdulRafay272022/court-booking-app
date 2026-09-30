"use client";

import { AMENITY_OPTIONS } from "@court-booking/types";
import { Chip, FieldLabel } from "./ui";

/** Venue-level amenities (floodlights, parking, ...): a multi-select over the shared AMENITY_OPTIONS keys. */
export function AmenitiesPicker({ value, onToggle }: { value: string[]; onToggle: (key: string) => void }) {
  return (
    <div className="flex flex-col gap-2" data-testid="amenities-picker">
      <FieldLabel>Amenities at your venue</FieldLabel>
      <div className="flex flex-wrap gap-2">
        {AMENITY_OPTIONS.map((a) => (
          <Chip key={a.key} label={a.label} selected={value.includes(a.key)} onClick={() => onToggle(a.key)} />
        ))}
      </div>
    </div>
  );
}
