/**
 * Glass vs solid decision for floating bars (System board: "Solid fallback on low-end Android and with reduced
 * transparency"). Web always gets solid on mobile Expo-web (no reliable backdrop-filter in RN-web); the Next.js web app
 * uses CSS backdrop-filter with an @supports fallback instead.
 */
export interface GlassInput {
  os: "ios" | "android" | "web" | string;
  reduceTransparency: boolean;
  /** Android API level (Platform.Version). */
  androidApi?: number | null;
  /** Device RAM in bytes (expo-device totalMemory). */
  totalMemory?: number | null;
}

/** Android below 12 (API 31) or under 4 GB RAM counts as low-end: blur is costly and often janky there. */
export const LOW_END_MEMORY = 4 * 1024 * 1024 * 1024;

export function glassMode(i: GlassInput): "blur" | "solid" {
  if (i.reduceTransparency) return "solid";
  if (i.os === "web") return "solid";
  if (i.os === "android") {
    if (i.androidApi != null && i.androidApi < 31) return "solid";
    if (i.totalMemory != null && i.totalMemory < LOW_END_MEMORY) return "solid";
  }
  return "blur";
}
