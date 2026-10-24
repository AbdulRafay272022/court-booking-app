import { Platform } from "react-native";

/**
 * Expo web has no OS font-size setting, so QA previews "large font" with `?fs=1.3` (same switch as the DS dev page
 * /dev/components?fs=1.3). Read once from the URL, kept in sessionStorage so it survives in-app navigation. Development
 * builds on web only: a phone build always returns 1 (the OS font scale already applies there through allowFontScaling).
 */
export function devFontScale(): number {
  if (!__DEV__ || Platform.OS !== "web" || typeof window === "undefined") return 1;
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("fs");
    if (fromUrl) window.sessionStorage.setItem("fl.fs", fromUrl);
    const raw = fromUrl ?? window.sessionStorage.getItem("fl.fs");
    const n = Number(raw);
    return Number.isFinite(n) && n >= 1 && n <= 2 ? n : 1;
  } catch {
    return 1;
  }
}
