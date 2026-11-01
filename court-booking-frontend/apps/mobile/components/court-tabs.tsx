import { Pressable, ScrollView, View } from "react-native";
import { palette, radius, size, space } from "@court-booking/ui-tokens";
import { Text, useRoleTheme } from "@/components/ui";

export interface CourtTabItem {
  key: string;
  label: string;
}

/**
 * The horizontally scrollable "Court 1 / Court 2 / ... / + Court" strip shared by the venue-setup wizard and Venue
 * Settings (Courts section), OSettings board style: selected = solid role colour + "✓" pill, "+ Naya court" dashed. It only renders the strip:
 * the caller owns what each tab shows, and decides what "+ Court" and delete do.
 */
export function CourtTabs({
  tabs,
  selectedKey,
  onSelect,
  onAdd,
  addLabel = "+ Naya court",
  addDisabled,
}: {
  tabs: CourtTabItem[];
  selectedKey: string | undefined;
  onSelect: (key: string) => void;
  onAdd?: () => void;
  addLabel?: string;
  addDisabled?: boolean;
}) {
  const t = useRoleTheme();
  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ paddingVertical: space[1], gap: space[2], alignItems: "center" }} keyboardShouldPersistTaps="handled">
        {tabs.map((tab) => {
          const selected = tab.key === selectedKey;
          return (
            <Pressable
              key={tab.key}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={tab.label}
              onPress={() => onSelect(tab.key)}
              style={{
                minHeight: size.tap,
                paddingHorizontal: space[4],
                borderRadius: radius.pill,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: selected ? t.primary.bg : palette.white,
                borderWidth: selected ? 0 : 1.5,
                borderColor: palette.lineStrong,
              }}
            >
              <Text variant="bodyBold" color={selected ? t.primary.fg : palette.night}>
                {`${selected ? "✓ " : ""}${tab.label}`}
              </Text>
            </Pressable>
          );
        })}
        {onAdd ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Naya court add karein"
            disabled={addDisabled}
            onPress={onAdd}
            style={{ minHeight: size.tap, paddingHorizontal: space[4], borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: palette.white, borderWidth: 1.5, borderStyle: "dashed", borderColor: t.primary.bg, opacity: addDisabled ? 0.5 : 1 }}
          >
            <Text variant="bodyBold" tone="link">
              {addLabel}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}
