import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { api } from "./api";

const STORAGE_KEY = "maidan.push_token";

/** The backend calls FCM directly (app/utils/... posts to fcm.googleapis.com), not
 * through Expo's push service -- so this must be the raw native device token
 * (`getDevicePushTokenAsync`), not an Expo push token (`ExponentPushToken[...]`),
 * which only Expo's own relay would understand. */
export async function registerForPushNotifications(): Promise<void> {
  try {
    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (status !== "granted") {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== "granted") return;

    const { data } = await Notifications.getDevicePushTokenAsync();
    const token = String(data);
    const platform = Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web";
    await api.users.registerFcmToken(token, platform);
    await AsyncStorage.setItem(STORAGE_KEY, token);
  } catch {
    // Push is a best-effort nicety today (no FCM service account configured
    // server-side yet, per FRONTEND_INTEGRATION.md) -- the app must keep working
    // without it, on any platform/permission-denied/unsupported-browser combination.
  }
}

export async function unregisterPushNotifications(): Promise<void> {
  try {
    const token = await AsyncStorage.getItem(STORAGE_KEY);
    if (!token) return;
    await api.users.deleteFcmToken(token);
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // Best-effort -- the session is being torn down regardless.
  }
}
