import { useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";

import { friendlyErrorMessage } from "@/lib/error-messages";
import { StarIcon } from "@/components/icons";

/** Pick from gallery/camera and resize to max 1600px wide before upload (Section 32 Part 6). */
async function pickAndResize(fromCamera: boolean): Promise<string | null> {
  const perm = fromCamera
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    Alert.alert("Permission needed", "Allow photo access to add photos.");
    return null;
  }
  const res = fromCamera
    ? await ImagePicker.launchCameraAsync({ quality: 1 })
    : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
  if (res.canceled || !res.assets?.[0]) return null;
  const out = await manipulateAsync(res.assets[0].uri, [{ resize: { width: 1600 } }], {
    compress: 0.8,
    format: SaveFormat.JPEG,
  });
  return out.uri;
}

type Props = {
  title: string;
  photoUrls: string[];
  photoKeys: string[];
  max: number;
  onUpload: (uri: string) => Promise<void>;
  onReorder: (keys: string[]) => Promise<void>;
};

export function PhotoManager({ title, photoUrls, photoKeys, max, onUpload, onReorder }: Props) {
  const [busy, setBusy] = useState(false);
  const atLimit = photoUrls.length >= max;

  async function add(fromCamera: boolean) {
    if (atLimit || busy) return;
    setBusy(true);
    try {
      const uri = await pickAndResize(fromCamera);
      if (uri) await onUpload(uri);
    } catch (e) {
      Alert.alert("Couldn't add photo", friendlyErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function mutate(keys: string[]) {
    setBusy(true);
    try {
      await onReorder(keys);
    } catch (e) {
      Alert.alert("Couldn't update photos", friendlyErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const swap = (i: number, j: number) => {
    const next = [...photoKeys];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  };

  return (
    <View className="bg-owner-surface border border-owner-border rounded-xl p-4 gap-3">
      <View className="flex-row items-center justify-between">
        <Text className="font-plex-bold text-owner-ink text-[14px]">{title}</Text>
        <Text className="font-plex-medium text-owner-ink-faint text-[12px]">
          {photoUrls.length} / {max}
        </Text>
      </View>

      {photoUrls.length === 0 ? (
        <Text className="font-plex-medium text-owner-ink-faint text-[13px]">No photos yet. Add a few so players can see the place.</Text>
      ) : (
        <View className="flex-row flex-wrap gap-2.5">
          {photoUrls.map((url, i) => (
            <View key={photoKeys[i] ?? url} className="w-[104px] gap-1">
              <View>
                <Image source={{ uri: url }} style={{ width: 104, height: 104, borderRadius: 8 }} resizeMode="cover" />
                {i === 0 ? (
                  <View className="absolute top-1 left-1 flex-row items-center gap-1 bg-black/60 rounded px-1.5 py-0.5">
                    <StarIcon size={10} color="#FFFFFF" />
                    <Text className="text-white font-plex-semibold text-[9.5px]">Cover</Text>
                  </View>
                ) : null}
              </View>
              <View className="flex-row items-center justify-between">
                <Pressable
                  accessibilityLabel={`Move photo ${i + 1} left`}
                  disabled={i === 0 || busy}
                  onPress={() => mutate(swap(i, i - 1))}
                  className="px-1.5 py-1 rounded bg-owner-bg"
                  style={{ opacity: i === 0 ? 0.35 : 1 }}
                >
                  <Text className="font-plex-bold text-owner-ink text-[13px]">◀</Text>
                </Pressable>
                {i !== 0 ? (
                  <Pressable
                    accessibilityLabel={`Set photo ${i + 1} as cover`}
                    disabled={busy}
                    onPress={() => mutate([photoKeys[i], ...photoKeys.filter((_, j) => j !== i)])}
                    className="px-1.5 py-1 rounded bg-owner-bg"
                  >
                    <Text className="font-plex-semibold text-owner-accent text-[10.5px]">Cover</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  accessibilityLabel={`Move photo ${i + 1} right`}
                  disabled={i === photoUrls.length - 1 || busy}
                  onPress={() => mutate(swap(i, i + 1))}
                  className="px-1.5 py-1 rounded bg-owner-bg"
                  style={{ opacity: i === photoUrls.length - 1 ? 0.35 : 1 }}
                >
                  <Text className="font-plex-bold text-owner-ink text-[13px]">▶</Text>
                </Pressable>
              </View>
              <Pressable
                accessibilityLabel={`Delete photo ${i + 1}`}
                disabled={busy}
                onPress={() => mutate(photoKeys.filter((_, j) => j !== i))}
                className="items-center py-1 rounded bg-owner-bg"
              >
                <Text className="font-plex-semibold text-[11px]" style={{ color: "#A8432C" }}>Delete</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}

      <View className="flex-row gap-2.5">
        <Pressable
          accessibilityLabel="Add photo from gallery"
          disabled={atLimit || busy}
          onPress={() => add(false)}
          className="flex-1 h-11 rounded-[10px] border border-owner-border items-center justify-center flex-row gap-2"
          style={{ opacity: atLimit || busy ? 0.5 : 1 }}
        >
          {busy ? <ActivityIndicator color="#0E6274" size="small" /> : <Text className="font-plex-semibold text-owner-ink text-[13.5px]">＋ Gallery</Text>}
        </Pressable>
        <Pressable
          accessibilityLabel="Add photo from camera"
          disabled={atLimit || busy}
          onPress={() => add(true)}
          className="flex-1 h-11 rounded-[10px] border border-owner-border items-center justify-center"
          style={{ opacity: atLimit || busy ? 0.5 : 1 }}
        >
          <Text className="font-plex-semibold text-owner-ink text-[13.5px]">＋ Camera</Text>
        </Pressable>
      </View>
      {atLimit ? (
        <Text className="font-plex-medium text-owner-ink-faint text-[12px]">Limit reached ({max}). Delete one to add another.</Text>
      ) : null}
    </View>
  );
}
