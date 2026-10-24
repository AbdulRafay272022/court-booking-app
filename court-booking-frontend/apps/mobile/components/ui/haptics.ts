import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

export type HapticKind = "light" | "medium" | "success" | "warning" | "error" | "selection";

/** Fire-and-forget haptic. No-op on web. Never throws. */
export function haptic(kind: HapticKind = "light"): void {
  if (Platform.OS === "web") return;
  try {
    if (kind === "selection") void Haptics.selectionAsync();
    else if (kind === "success") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    else if (kind === "warning") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    else if (kind === "error") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    else void Haptics.impactAsync(kind === "medium" ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
  } catch {
    // haptics unavailable: ignore
  }
}
