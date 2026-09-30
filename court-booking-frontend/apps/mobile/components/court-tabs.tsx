import { Pressable, ScrollView, Text, View } from "react-native";

export interface CourtTabItem {
  key: string;
  label: string;
}

/**
 * The horizontally scrollable "Court 1 / Court 2 / ... / + Court" tab strip shared by the venue-setup wizard and Venue
 * Settings (Courts section). It only renders the strip: the caller owns what each tab shows, and decides what
 * "+ Court" and delete do (the wizard edits a local draft, Settings talks to the API).
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
  return (
    <View className="bg-owner-surface border border-owner-border rounded-xl">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator
        contentContainerClassName="px-3 py-3 gap-2 items-center"
        keyboardShouldPersistTaps="handled"
      >
        {tabs.map((t) => {
          const selected = t.key === selectedKey;
          return (
            <Pressable
              key={t.key}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={t.label}
              onPress={() => onSelect(t.key)}
              className="px-4 rounded-lg items-center justify-center"
              style={{ minHeight: 44, backgroundColor: selected ? "#0E6274" : "#F4F6F7" }}
            >
              <Text className="font-plex-semibold text-[13px]" style={{ color: selected ? "#FFFFFF" : "#5B7079" }}>
                {t.label}
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
            className="px-4 rounded-lg items-center justify-center border border-owner-border"
            style={{ minHeight: 44, borderStyle: "dashed", opacity: addDisabled ? 0.5 : 1 }}
          >
            <Text className="font-plex-semibold text-owner-accent text-[13px]">{addLabel}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}
