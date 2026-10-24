import { OfflineBanner as FlOfflineBanner, RoleProvider } from "@/components/ui";
import { useNetworkStatus } from "@/lib/network-status";

/** Section 12: "airplane mode mid-session -> clear 'you're offline' state ... reconnecting
 * resumes normal operation without requiring an app restart." Sits above the routed
 * stacks in the root layout for owner / staff / admin (players get the same Floodlight banner from their own layout).
 * Floodlight look (night bar, amber wifi-off icon, Roman Urdu copy); the owner role keeps any action teal. */
export function OfflineBanner() {
  const online = useNetworkStatus();
  return (
    <RoleProvider role="owner">
      <FlOfflineBanner visible={!online} placement="overlay" testID="offline-banner-root" />
    </RoleProvider>
  );
}
