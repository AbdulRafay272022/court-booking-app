import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { api } from "./api";

const STORAGE_KEY = "maidan.push_token";

/** Must match `ANDROID_CHANNEL_ID` in the backend's app/services/fcm.py and the
 * `defaultChannel` of the expo-notifications plugin in app.json. */
const ANDROID_CHANNEL_ID = "default";

/** The backend calls FCM directly (app/services/fcm.py posts to fcm.googleapis.com),
 * not through Expo's push service -- so this must be the raw native device token
 * (`getDevicePushTokenAsync`), not an Expo push token (`ExponentPushToken[...]`),
 * which only Expo's own relay would understand.
 *
 * Android only, for now: on iOS `getDevicePushTokenAsync` returns an APNs token, which
 * FCM's HTTP API rejects (it needs an FCM registration token, i.e. the Firebase SDK).
 * iOS tokens are registered anyway but the backend will mark them dead on first send. */
export async function registerForPushNotifications(): Promise<void> {
  try {
    if (Platform.OS === "android") {
      // Android 13+ shows no permission prompt until at least one channel exists, and
      // FCM messages name this channel (see backend) -- so create it before asking.
      await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
        name: "Maidan notifications",
        importance: Notifications.AndroidImportance.HIGH,
      });
    }
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
    // Push is best-effort -- the app must keep working without it (permission denied,
    // no Google Play services, web, backend without FCM credentials, ...).
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
