import Constants from "expo-constants";
import { create } from "zustand";

/**
 * The app's code level (founder 14 Nov, ledger v2 rollout). Sent on every request as X-App-Level; the backend blocks an
 * OWNER or STAFF app below its MIN_STAFF_APP_LEVEL with 426 UPGRADE_REQUIRED (players and the web never). It is a code
 * constant, NOT the store version: app.json's runtimeVersion follows the app version, so an OTA update can only reach the
 * installed apps while that version stays the same -- the level is what an OTA update raises.
 * Raise it when a release must reach every owner/staff phone before a server switch (then set the server minimum to it).
 * 1 = ledger v2 (Paisa). Every build before this sends no level (= 0).
 */
export const APP_LEVEL = 1;

/** Store / APK page for when the OTA update cannot be applied (dev build, updates off, no update found, error). */
export const UPDATE_URL =
  process.env.EXPO_PUBLIC_UPDATE_URL ??
  (Constants.expoConfig?.extra?.updateUrl as string | undefined) ??
  "https://play.google.com/store/apps/details?id=com.aftrsolutions.khelo";

/** Set by the api client when the server answers 426 UPGRADE_REQUIRED; the root layout then shows "Update karein". */
export const useUpgradeStore = create<{ required: boolean; setRequired: (v: boolean) => void }>((set) => ({
  required: false,
  setRequired: (required) => set({ required }),
}));

export { updateAction } from "./update-action";
