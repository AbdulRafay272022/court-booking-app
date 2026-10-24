"use client";

import { amenityItems } from "@court-booking/ui-tokens";
import { AMENITY_ICONS, useFlLang } from "@/components/fl";
import { useT } from "@/components/i18n/lang-provider";

/**
 * The venue page's full amenities list (cards show the single "Amenities [n]" chip instead). Same icons and labels as the
 * Floodlight AmenitiesPopover / mobile AmenitiesSheet; an unknown key keeps a check icon and the text as the owner typed it.
 * Teal info style: #0A5F59 text on the #E3F4F1 tint. `max` collapses the rest into "+N".
 */
export function AmenityBadges({ amenities, max, size = "sm" }: { amenities: string[] | null | undefined; max?: number; size?: "sm" | "md" }) {
  const t = useT();
  const lang = useFlLang();
  const list = amenityItems(amenities ?? [], lang);
  if (list.length === 0) return null;
  const shown = max != null ? list.slice(0, max) : list;
  const hidden = list.length - shown.length;
  const chip = size === "md" ? "min-h-9 px-3 text-[13.5px] gap-2 rounded-fl-sm" : "min-h-7 px-2 text-[12px] gap-1.5 rounded-fl-xs";

  return (
    <ul className="flex flex-wrap gap-1.5" aria-label={t("play.amenities")} data-testid="amenity-badges">
      {shown.map((a) => {
        const Icon = AMENITY_ICONS[a.icon];
        return (
          <li key={a.key} className={`inline-flex items-center bg-fl-teal-tint font-bold text-fl-teal-deep ${chip}`}>
            <Icon size={16} strokeWidth={2.2} className="shrink-0" />
            {a.label}
          </li>
        );
      })}
      {hidden > 0 ? (
        <li title={list.slice(shown.length).map((a) => a.label).join(", ")} className={`inline-flex items-center bg-fl-ground font-bold text-fl-muted ${chip}`}>
          +{hidden}
        </li>
      ) : null}
    </ul>
  );
}
