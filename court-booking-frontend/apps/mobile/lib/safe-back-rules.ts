/** Where a player screen's Back chevron goes. A screen opened from a deep link (push notification, shared link, a web
 * reload) or reached through `router.replace` has nothing under it in the stack, and a bare `router.back()` then does
 * nothing ("GO_BACK was not handled"). Pure, so it can be tested without a navigator; `lib/safe-back.ts` applies it. */
export const PLAYER_BOOKINGS_HREF = "/bookings" as const;
export const PLAYER_HOME_HREF = "/" as const;

export type SafeBackFallback = typeof PLAYER_BOOKINGS_HREF | typeof PLAYER_HOME_HREF;

export type SafeBackAction = { kind: "back" } | { kind: "replace"; href: SafeBackFallback };

export function safeBackAction(canGoBack: boolean, fallback: SafeBackFallback): SafeBackAction {
  return canGoBack ? { kind: "back" } : { kind: "replace", href: fallback };
}
