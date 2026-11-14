/** What the "Update karein" button does: fetch the OTA update and restart, or open the store/APK page. Pure (no RN/Expo
 * imports, so it runs in the node tests). */
export function updateAction(env: { isDev: boolean; updatesEnabled: boolean }): "ota" | "store" {
  return !env.isDev && env.updatesEnabled ? "ota" : "store";
}

/** A usable "latest APK" link: https, and not the eas.json placeholder. */
export function hasUpdateUrl(url: string | null | undefined): boolean {
  const u = (url ?? "").trim();
  return /^https:\/\/\S+$/i.test(u) && !/REPLACE/i.test(u);
}
