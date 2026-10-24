import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AccessibilityInfo, Platform, useWindowDimensions } from "react-native";
import * as Device from "expo-device";
import { glassMode, role as roleThemes, type Role, type RoleTheme } from "@court-booking/ui-tokens";

/**
 * Floodlight theme context. The ROLE is chosen by route group, never per screen:
 * app/(player)/_layout.tsx and app/(auth)/_layout.tsx mount <RoleProvider role="player">, app/(owner)/_layout.tsx mounts
 * <RoleProvider role="owner">. Components read it with useRole()/useRoleTheme(); screens never pass colours.
 */
export type Lang = "ru" | "en";

const RoleContext = createContext<Role>("player");
const LangContext = createContext<Lang>("ru");
const FontScaleContext = createContext<number>(1);

export function RoleProvider({ role, children }: { role: Role; children: ReactNode }) {
  return <RoleContext.Provider value={role}>{children}</RoleContext.Provider>;
}

/** Roman Urdu is the default; EN for the language toggle. Only affects copy built into the components. */
export function LangProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

/**
 * Extra text scale on top of the system font scale. Native phones already scale text with the OS setting
 * (allowFontScaling); Expo web has no OS font scale, so the dev component page uses this to preview "large font".
 */
export function FontScaleProvider({ scale, children }: { scale: number; children: ReactNode }) {
  return <FontScaleContext.Provider value={scale}>{children}</FontScaleContext.Provider>;
}

export function useRole(): Role {
  return useContext(RoleContext);
}

export function useRoleTheme(): RoleTheme {
  return roleThemes[useContext(RoleContext)];
}

export function useLang(): Lang {
  return useContext(LangContext);
}

/** Pick a Roman Urdu / English string by the current language. */
export function useCopy(): (ru: string, en: string) => string {
  const lang = useLang();
  return (ru, en) => (lang === "en" ? en : ru);
}

export function useFontScale(): number {
  return useContext(FontScaleContext);
}

/** Scale for text size computations that are NOT plain Text (e.g. a box that must grow with the label). */
export function useEffectiveFontScale(): number {
  const extra = useFontScale();
  const { fontScale } = useWindowDimensions();
  return extra * (Platform.OS === "web" ? 1 : fontScale || 1);
}

/** OS reduce-motion setting (live). Every animation in components/ui checks this. */
export function useReduceMotion(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => alive && setOn(v))
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (v: boolean) => setOn(v));
    return () => {
      alive = false;
      sub?.remove?.();
    };
  }, []);
  return on;
}

/** iOS reduce-transparency setting (false elsewhere). */
export function useReduceTransparency(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    let alive = true;
    AccessibilityInfo.isReduceTransparencyEnabled()
      .then((v) => alive && setOn(v))
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener("reduceTransparencyChanged", (v: boolean) => setOn(v));
    return () => {
      alive = false;
      sub?.remove?.();
    };
  }, []);
  return on;
}

/** "blur" or "solid" for floating glass (rules/platform.ts glassMode). */
export function useGlassMode(): "blur" | "solid" {
  const reduceTransparency = useReduceTransparency();
  return useMemo(
    () =>
      glassMode({
        os: Platform.OS,
        reduceTransparency,
        androidApi: Platform.OS === "android" ? Number(Platform.Version) : null,
        totalMemory: Device.totalMemory ?? null,
      }),
    [reduceTransparency],
  );
}
