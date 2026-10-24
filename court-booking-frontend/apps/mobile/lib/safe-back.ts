import { router } from "expo-router";

import { PLAYER_BOOKINGS_HREF, safeBackAction, type SafeBackFallback } from "@/lib/safe-back-rules";

/** Back if there is a screen to go back to, otherwise replace with `fallback` (the Bookings tab by default), so Back
 * never silently does nothing after a deep link. */
export function safeBack(fallback: SafeBackFallback = PLAYER_BOOKINGS_HREF): void {
  const action = safeBackAction(router.canGoBack(), fallback);
  if (action.kind === "back") router.back();
  else router.replace(action.href);
}
