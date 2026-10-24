import { View } from "react-native";
import { Armchair, Check, Coffee, Droplet, Lightbulb, Moon, Shirt, SquareParking, Toilet, Volleyball, Warehouse, Wifi } from "lucide-react-native";
import { amenityItems, palette, radius, space, type AmenityIcon } from "@court-booking/ui-tokens";
import type { IconComponent } from "./IconButton";
import { Sheet } from "./Sheet";
import { Text } from "./Text";
import { useCopy, useLang } from "./theme";

/** Amenity icon id (ui-tokens rules/amenities.ts) -> lucide icon. Unknown keys use Check. */
export const AMENITY_ICONS: Record<AmenityIcon, IconComponent> = {
  parking: SquareParking,
  washroom: Toilet,
  changing: Shirt,
  floodlight: Lightbulb,
  water: Droplet,
  cafe: Coffee,
  indoor: Warehouse,
  seating: Armchair,
  wifi: Wifi,
  equipment: Volleyball,
  prayer: Moon,
  check: Check,
};

export interface AmenitiesSheetProps {
  open: boolean;
  onClose: () => void;
  venueName: string;
  /** venue.amenities as returned by the API (owner order). */
  amenities: readonly string[];
  testID?: string;
}

/** VenueCard board frame B: "Amenities" sheet, "<Venue> · N cheezein", 2-column icon grid, owner-entered note. */
export function AmenitiesSheet({ open, onClose, venueName, amenities, testID }: AmenitiesSheetProps) {
  const lang = useLang();
  const copy = useCopy();
  const items = amenityItems(amenities, lang);
  return (
    <Sheet open={open} onClose={onClose} title="Amenities" subtitle={copy(`${venueName} · ${items.length} cheezein`, `${venueName} · ${items.length} items`)} testID={testID ?? "amenities-sheet"}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", marginHorizontal: -5 }} accessibilityRole="list">
        {items.map((a) => {
          const Icon = AMENITY_ICONS[a.icon];
          return (
            <View key={a.key} style={{ width: "50%", padding: 5 }}>
              <View style={{ minHeight: 56, borderRadius: radius.input, backgroundColor: palette.ground, paddingVertical: 10, paddingHorizontal: space[3], flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ width: 36, height: 36, borderRadius: radius.sm, backgroundColor: palette.tealTint, alignItems: "center", justifyContent: "center" }}>
                  <Icon size={18} color={palette.tealDeep} strokeWidth={2.2} />
                </View>
                <Text variant="bodyBold" weight="bold" style={{ flex: 1 }}>
                  {a.label}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
      <Text variant="caption" tone="muted">
        {copy('Ye list venue owner ne khud dali hai. Galat ho to "Masla batayein".', 'The venue owner entered this list. If it is wrong, use "Report a problem".')}
      </Text>
    </Sheet>
  );
}
