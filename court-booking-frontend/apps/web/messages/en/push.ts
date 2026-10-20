// English copy: same keys as messages/ru/push.ts.
import type { ruPush } from "../ru/push";

export const enPush: Record<keyof typeof ruPush, string> = {
  "push.heading": "Even when Khelo is closed",
  "push.explain.owner": "Get a notification on this device for new payment screenshots and refunds, even when the Khelo tab is closed.",
  "push.explain.player": "Get a notification on this device when a booking is confirmed or cancelled, even when the Khelo tab is closed.",
  "push.enable.owner": "Turn on notifications",
  "push.enable.player": "Turn on notifications",
  "push.on": "On for this device",
  "push.off.owner": "Turn off",
  "push.off.player": "Turn off",
  "push.busy": "One moment...",
  "push.denied.owner": "Your browser is blocking notifications. Allow Notifications from the lock icon next to the address, then turn them on here.",
  "push.denied.player": "Your browser is blocking notifications. Allow Notifications from the lock icon next to the address, then turn them on here.",
  "push.ios.owner": "On iPhone: use the Share button to add Khelo to your Home Screen, open it from there, then turn notifications on here.",
  "push.ios.player": "On iPhone: use the Share button to add Khelo to your Home Screen, open it from there, then turn notifications on here.",
  "push.live.on": "Notifications are on for this device",
  "push.live.off": "Notifications are off for this device",
  "push.live.error.owner": "Notifications could not be turned on. Please try again in a moment.",
  "push.live.error.player": "Notifications could not be turned on. Please try again in a moment.",
};
