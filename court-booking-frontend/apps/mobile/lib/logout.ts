import { Alert } from "react-native";
import { api } from "./api";
import { useAuthStore } from "./auth-store";
import { unregisterPushNotifications } from "./push-notifications";

/** Logout burns the whole point of the long-lived session, so it must be a deliberate,
 * confirmed action — never a single accidental tap. */
export function confirmLogout() {
  Alert.alert("Log out?", "You'll need to verify your phone number again to log back in.", [
    { text: "Cancel", style: "cancel" },
    {
      text: "Log out",
      style: "destructive",
      onPress: async () => {
        await unregisterPushNotifications();
        try {
          await api.auth.logout();
        } catch {
          // Best-effort server-side revoke — sign out locally regardless.
        }
        await useAuthStore.getState().signOut();
      },
    },
  ]);
}
