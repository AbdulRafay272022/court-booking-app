import { useState } from "react";
import { ActivityIndicator, Alert, Image, Platform, Pressable, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";

import { friendlyErrorMessage } from "@/lib/error-messages";
import { StarIcon } from "@/components/icons";

const MAX_BYTES = 5 * 1024 * 1024;
// What the server accepts is jpeg/png/webp; HEIC/HEIF (iPhone) is re-encoded to JPEG by the resize step below.
const ALLOWED_MIME = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"];

export interface PickedPhoto {
  /** Local uri of the resized JPEG, or null when this file was rejected before upload. */
  uri: string | null;
  name: string;
  /** Why the file was rejected (unsupported type / too large), if it was. */
  error?: string;
}

/** The ImagePicker options for the gallery: several photos at once, capped at the free slots so the OS picker itself
 * refuses to hand back more than can be stored. Exported so the configuration can be asserted without a device. */
export function galleryPickerOptions(remainingSlots: number): ImagePicker.ImagePickerOptions {
  return {
    mediaTypes: ["images"],
    quality: 1,
    allowsMultipleSelection: true,
    selectionLimit: Math.max(1, remainingSlots),
    orderedSelection: true,
  };
}

/** Pick from gallery (many) or camera (one) and resize each to max 1600px wide before upload (Section 32 Part 6). */
async function pickAndResize(fromCamera: boolean, remainingSlots: number): Promise<PickedPhoto[] | null> {
  const perm = fromCamera
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    Alert.alert("Permission needed", "Allow photo access to add photos.");
    return null;
  }
  const res = fromCamera
    ? await ImagePicker.launchCameraAsync({ quality: 1 })
    : await ImagePicker.launchImageLibraryAsync(galleryPickerOptions(remainingSlots));
  if (res.canceled || !res.assets?.length) return null;

  const out: PickedPhoto[] = [];
  // Even if a picker ignores selectionLimit (web file input does), never process more than the free slots.
  for (const asset of res.assets.slice(0, Math.max(1, remainingSlots))) {
    const name = asset.fileName ?? "photo";
    const mime = (asset.mimeType ?? "").toLowerCase();
    if (mime && !ALLOWED_MIME.includes(mime)) {
      out.push({ uri: null, name, error: "Only JPEG, PNG or WebP photos are allowed." });
      continue;
    }
    try {
      const resized = await manipulateAsync(asset.uri, [{ resize: { width: 1600 } }], { compress: 0.8, format: SaveFormat.JPEG });
      const size = (await (await fetch(resized.uri)).blob()).size;
      if (size > MAX_BYTES) {
        out.push({ uri: null, name, error: "Larger than 5 MB even after resizing." });
        continue;
      }
      out.push({ uri: resized.uri, name });
    } catch {
      out.push({ uri: null, name, error: "Couldn't read this photo." });
    }
  }
  return out;
}

type Props = {
  title: string;
  photoUrls: string[];
  photoKeys: string[];
  max: number;
  /** A local uri on native; a real Blob on Expo web (RN-web's FormData cannot send a `{ uri }` part, the server saw "[object Object]"). */
  onUpload: (file: string | Blob) => Promise<void>;
  onReorder: (keys: string[]) => Promise<void>;
};

export function PhotoManager({ title, photoUrls, photoKeys, max, onUpload, onReorder }: Props) {
  const [busy, setBusy] = useState(false);
  const atLimit = photoUrls.length >= max;

  async function add(fromCamera: boolean) {
    if (atLimit || busy) return;
    setBusy(true);
    try {
      const remaining = max - photoUrls.length;
      const picked = await pickAndResize(fromCamera, remaining);
      if (!picked) return;
      // One file at a time, each with its own error handling, so one bad photo doesn't lose the rest.
      const failures: string[] = [];
      let added = 0;
      for (const p of picked) {
        if (!p.uri) {
          failures.push(`${p.name}: ${p.error}`);
          continue;
        }
        try {
          await onUpload(Platform.OS === "web" ? await (await fetch(p.uri)).blob() : p.uri);
          added += 1;
        } catch (e) {
          failures.push(`${p.name}: ${friendlyErrorMessage(e)}`);
        }
      }
      if (failures.length > 0) {
        Alert.alert(
          added > 0 ? `${added} added, ${failures.length} failed` : "Couldn't add photo",
          failures.join("\n"),
        );
      }
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
          {busy ? <ActivityIndicator color="#0E6274" size="small" /> : <Text className="font-plex-semibold text-owner-ink text-[13.5px]">＋ Gallery (select several)</Text>}
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
