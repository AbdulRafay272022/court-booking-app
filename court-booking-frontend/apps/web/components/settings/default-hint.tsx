"use client";

import type { DefaultState } from "./hint-state";

/**
 * audit 2026-10-28 item 15: there are no "Default: ...", "Abhi default chal raha hai" or "Default par wapas" lines any more.
 * Every setting holds a real value (the wizard and Venue Settings start from the default VALUE, which the owner saves as
 * their own), and an emptied field is shown red and blocks Save / Send for review. The component stays as a no-op so the call
 * sites keep compiling; delete the call sites when they are next touched.
 */
export function DefaultHint(_props: {
  id: string;
  field: string;
  text: string;
  state: DefaultState;
  onReset?: () => void;
  markSame?: boolean;
  note?: string | null;
}) {
  return null;
}
