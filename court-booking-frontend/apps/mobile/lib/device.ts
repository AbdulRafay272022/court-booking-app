import * as Device from "expo-device";
import { Platform } from "react-native";
import * as SecureStore from "./secure-storage";

const DEVICE_ID_KEY = "maidan.device_id";

function generateUuidV4(): string {
  // Device-identifier quality only (not security-sensitive) — avoids pulling in expo-crypto.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Persisted once on first launch, reused forever — lets the backend tell "same device, new login" apart from "new device". */
export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await SecureStore.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const id = generateUuidV4();
  await SecureStore.setItem(DEVICE_ID_KEY, id);
  return id;
}

export function getDeviceName(): string {
  return Device.modelName ?? "Unknown device";
}

export function getPlatform(): "android" | "ios" | "web" {
  if (Platform.OS === "android") return "android";
  if (Platform.OS === "ios") return "ios";
  return "web";
}
