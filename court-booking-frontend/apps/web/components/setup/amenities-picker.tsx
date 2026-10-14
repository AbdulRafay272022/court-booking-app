"use client";

import { AMENITY_OPTIONS } from "@court-booking/types";
import { useFmt } from "@/lib/use-fmt";
import { useT } from "@/components/i18n/lang-provider";
import { Chip, FieldLabel } from "./ui";

/** Venue-level amenities (floodlights, parking, ...): a multi-select over the shared AMENITY_OPTIONS keys. */
export function AmenitiesPicker({ value, onToggle }: { value: string[]; onToggle: (key: string) => void }) {
  const t = useT();
  const fmt = useFmt();
  return (
    <div className="flex flex-col gap-2" data-testid="amenities-picker">
      <FieldLabel>{t("setup.amenities.label")}</FieldLabel>
      <div className="flex flex-wrap gap-2">
        {AMENITY_OPTIONS.map((a) => (
          <Chip key={a.key} label={fmt.amenity(a.key)} selected={value.includes(a.key)} onClick={() => onToggle(a.key)} />
        ))}
      </div>
    </div>
  );
}
