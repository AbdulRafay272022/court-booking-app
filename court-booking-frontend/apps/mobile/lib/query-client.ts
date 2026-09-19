import { QueryClient, focusManager } from "@tanstack/react-query";
import { AppState, type AppStateStatus, Platform } from "react-native";

// Without this, `refetchInterval` polling (payment status, availability
// grids, owner approvals) keeps firing on its raw interval even with the
// screen off/app backgrounded, burning battery and mobile data on the
// cheap Android hardware this pilot targets. TanStack Query's React Native
// integration needs this wired explicitly -- it isn't automatic the way it
// is on web (which already gets it for free from the browser's visibility
// API). See AUDIT_FINDINGS.md finding #19.
function onAppStateChange(status: AppStateStatus) {
  if (Platform.OS !== "web") {
    focusManager.setFocused(status === "active");
  }
}

AppState.addEventListener("change", onAppStateChange);

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 15_000,
      // Keep previously-loaded data visible during a background refetch rather than
      // blanking the screen (Section 12: poor-network tolerance).
      placeholderData: (prev: unknown) => prev,
    },
  },
});
