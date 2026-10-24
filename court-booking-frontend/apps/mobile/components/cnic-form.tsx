import { Alert, Image, Platform, Pressable, View } from "react-native";
import { Text } from "@/components/ui";
import * as ImagePicker from "expo-image-picker";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { create } from "zustand";
import type { OwnerIdentity } from "@court-booking/types";

import { api } from "@/lib/api";
import { FieldLabel, TextField } from "../app/(owner)/venue-setup/_components";
import { EMPTY_CNIC_DRAFT, cnicProblem, formatCnicInput, type CnicDraft } from "./cnic-logic";

/**
 * The CNIC being typed / picked. MEMORY ONLY on purpose (zustand without persist): the number and the photos are never
 * written to AsyncStorage / localStorage, and they are cleared after a successful submit. Leaving the wizard screen and
 * coming back keeps them for this app session only.
 */
export const useCnicDraft = create<CnicDraft & { set: (patch: Partial<CnicDraft>) => void; clear: () => void }>()((set) => ({
  ...EMPTY_CNIC_DRAFT,
  set: (patch) => set(patch),
  clear: () => set({ ...EMPTY_CNIC_DRAFT }),
}));

// Test hook for the Expo-web e2e only (the image picker cannot be driven headlessly; see CLAUDE.md). Dev builds only.
if (__DEV__ && Platform.OS === "web") (globalThis as unknown as { __cnicDraft?: typeof useCnicDraft }).__cnicDraft = useCnicDraft;

/** POST /owners/identity with the draft. Native sends `{ uri }` parts; RN-web needs real Blobs. Clears the draft on success. */
export async function submitCnicDraft(d: CnicDraft): Promise<OwnerIdentity> {
  const asPart = async (uri: string) => (Platform.OS === "web" ? await (await fetch(uri)).blob() : uri);
  const res = await api.owners.submitIdentity(d.number, await asPart(d.front!), await asPart(d.back!));
  useCnicDraft.getState().clear();
  return res;
}

async function pickPhoto(fromCamera: boolean): Promise<string | null> {
  const perm = fromCamera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    Alert.alert("Ijazat chahiye", "Photo lene ke liye camera / gallery ki ijazat dein.");
    return null;
  }
  const res = fromCamera
    ? await ImagePicker.launchCameraAsync({ quality: 1 })
    : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
  if (res.canceled || !res.assets?.length) return null;
  try {
    const out = await manipulateAsync(res.assets[0].uri, [{ resize: { width: 1600 } }], { compress: 0.8, format: SaveFormat.JPEG });
    return out.uri;
  } catch {
    Alert.alert("Photo nahi parh saki", "Koi aur photo try karein.");
    return null;
  }
}

function PhotoSlot({ label, uri, onPick, testID }: { label: string; uri: string | null; onPick: (uri: string) => void; testID: string }) {
  const pick = async (camera: boolean) => {
    const u = await pickPhoto(camera);
    if (u) onPick(u);
  };
  return (
    <View className="gap-2 flex-1" testID={testID}>
      <FieldLabel>{label}</FieldLabel>
      {uri ? (
        <Image source={{ uri }} style={{ width: "100%", height: 96, borderRadius: 8 }} resizeMode="cover" accessibilityLabel={`${label} photo`} />
      ) : (
        <View className="items-center justify-center rounded-lg border border-dashed border-owner-border" style={{ height: 96 }}>
          <Text variant="caption" tone="subtle">Photo nahi</Text>
        </View>
      )}
      <View className="flex-row gap-2">
        <Pressable
          onPress={() => pick(false)}
          accessibilityRole="button"
          accessibilityLabel={`${label}: gallery`}
          className="flex-1 min-h-11 rounded-lg border border-owner-border items-center justify-center"
        >
          <Text variant="caption" tone="link" weight="bold">{uri ? "Badlein" : "Gallery"}</Text>
        </Pressable>
        {Platform.OS !== "web" ? (
          <Pressable
            onPress={() => pick(true)}
            accessibilityRole="button"
            accessibilityLabel={`${label}: camera`}
            className="flex-1 min-h-11 rounded-lg border border-owner-border items-center justify-center"
          >
            <Text variant="caption" tone="link" weight="bold">Camera</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/** The CNIC number (masked as you type) plus front and back photos, reading/writing the memory-only draft. */
export function CnicFields() {
  const d = useCnicDraft();
  return (
    <View className="gap-4">
      <TextField
        label="CNIC number"
        value={d.number}
        onChangeText={(v) => d.set({ number: formatCnicInput(v) })}
        keyboardType="number-pad"
        placeholder="12345-1234567-1"
        maxLength={15}
        mono
        error={cnicProblem(d.number)}
        testID="cnic-number"
        autoComplete="off"
      />
      <View className="flex-row gap-3">
        <PhotoSlot label="Card ka saamne wala hissa" uri={d.front} onPick={(u) => d.set({ front: u })} testID="cnic-front" />
        <PhotoSlot label="Card ka peeche wala hissa" uri={d.back} onPick={(u) => d.set({ back: u })} testID="cnic-back" />
      </View>
      <Text variant="caption" tone="subtle">
        Aap ka CNIC sirf verification ke liye hai. Ye players ko kabhi nahi dikhta, aur app mein sirf aakhri hindsa dikhaya jata hai.
      </Text>
    </View>
  );
}
