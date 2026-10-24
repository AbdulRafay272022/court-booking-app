import { api } from "./api";
import { useAuthStore } from "./auth-store";
import { confirmAction } from "./confirm";
import { unregisterPushNotifications } from "./push-notifications";

/** Logout burns the whole point of the long-lived session, so it must be a deliberate,
 * confirmed action — never a single accidental tap. Uses confirmAction so it also works on Expo web, where Alert.alert
 * is a silent no-op. */
export function confirmLogout() {
  confirmAction({
    title: "Log out?",
    message: "You'll need to verify your phone number again to log back in.",
    confirmLabel: "Log out",
    destructive: true,
    onConfirm: () => void logoutNow(),
  });
}

export async function logoutNow() {
  await unregisterPushNotifications();
  try {
    await api.auth.logout();
  } catch {
    // Best-effort server-side revoke — sign out locally regardless.
  }
  await useAuthStore.getState().signOut();
}
