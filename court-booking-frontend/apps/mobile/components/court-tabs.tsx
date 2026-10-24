import { Pressable, ScrollView, View } from "react-native";
import { palette, radius, size, space } from "@court-booking/ui-tokens";
import { Text, useRoleTheme } from "@/components/ui";

export interface CourtTabItem {
  key: string;
  label: string;
}

/**
 * The horizontally scrollable "Court 1 / Court 2 / ... / + Court" strip shared by the venue-setup wizard and Venue
 * Settings (Courts section), OSettings board style: selected = role tint + 2px border + "✓". It only renders the strip:
 * the caller owns what each tab shows, and decides what "+ Court" and delete do.
 */
export function CourtTabs({
  tabs,
  selectedKey,
  onSelect,
  onAdd,
  addLabel = "+ Court",
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
                borderRadius: radius.md,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: selected ? t.selected.bg : palette.white,
                borderWidth: selected ? 2 : 1.5,
                borderColor: selected ? t.selected.border : palette.lineStrong,
              }}
            >
              <Text variant="label" color={selected ? t.selected.fg : palette.night}>
                {`${selected ? "✓ " : ""}${tab.label}`}
              </Text>
            </Pressable>
          );
        })}
        {onAdd ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add a court"
            disabled={addDisabled}
            onPress={onAdd}
            style={{ minHeight: size.tap, paddingHorizontal: space[4], borderRadius: radius.md, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderStyle: "dashed", borderColor: palette.muted2, opacity: addDisabled ? 0.5 : 1 }}
          >
            <Text variant="label" tone="link">
              {addLabel}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}
