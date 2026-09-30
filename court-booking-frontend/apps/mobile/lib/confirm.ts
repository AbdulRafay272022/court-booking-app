import { Alert, Platform } from "react-native";

/** Yes/no confirmation that works on native AND on Expo web (RN-web's Alert.alert is a silent no-op, so a destructive
 * action guarded by Alert alone would never run there). */
export function confirmAction(opts: {
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
}) {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined" && window.confirm(`${opts.title}\n\n${opts.message}`)) opts.onConfirm();
    return;
  }
  Alert.alert(opts.title, opts.message, [
    { text: "Cancel", style: "cancel" },
    { text: opts.confirmLabel, style: opts.destructive ? "destructive" : "default", onPress: opts.onConfirm },
  ]);
}
