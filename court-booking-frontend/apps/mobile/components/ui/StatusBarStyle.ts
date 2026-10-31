import { useCallback } from "react";
import { useFocusEffect } from "expo-router";
import { setStatusBarStyle } from "expo-status-bar";

/**
 * Night / teal hero screens want light status-bar icons while focused; every other screen keeps the app default "dark"
 * (set once in app/_layout.tsx). Imperative on purpose: a `<StatusBar style="dark" />` element in the root layout
 * re-applied "dark" on every root re-render and left black icons on the dark heroes (emulator audit 2026-10-31).
 */
export function useLightStatusBar() {
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle("light");
      return () => setStatusBarStyle("dark");
    }, []),
  );
}

/** Element form, for a hero that only renders in one branch (hooks cannot be conditional). */
export function LightStatusBar(): null {
  useLightStatusBar();
  return null;
}
