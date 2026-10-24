/**
 * Pure lifecycle rules behind the mobile `Sheet` (no React / RN imports, unit-tested in components/sheet-lifecycle.test.ts).
 *
 * @gorhom/bottom-sheet traps this guards against (all found on Expo web):
 * - `dismiss()` on a never-presented BottomSheetModal leaves it DISMISSING and a later `present()` never renders:
 *   only dismiss what was presented.
 * - A Sheet unmounted while open kept its portal on screen for the whole close animation (~1 s): on unmount, dismiss
 *   with a zero-duration animation and do NOT call the (gone) owner's onClose.
 * - `onClose` must be the LATEST prop when the dismissal finishes (the modal keeps the callback from its last render;
 *   the owner may have re-rendered with new state in between): the Sheet calls it through a ref.
 * - Two @gorhom modals open at once: the default "switch" stack behaviour minimised the first one and on Expo web it
 *   never came back (both looked dismissed). The Sheet uses stackBehavior "push" (the first stays as it is underneath).
 */

export type SheetAction = "present" | "dismiss" | "dismissInstant" | "notifyClose" | "none";

export interface SheetLifecycle {
  /** The `open` prop changed (or the sheet mounted with it). */
  setOpen(open: boolean): SheetAction;
  /** The modal reported it is gone (any cause: backdrop, pan down, close button, Android back, our dismiss). */
  dismissed(): SheetAction;
  /** The owning component (re)mounted (React may run mount/unmount/mount in development). */
  mount(): void;
  /** The owning component unmounted. */
  unmount(): SheetAction;
  readonly presented: boolean;
}

export function createSheetLifecycle(): SheetLifecycle {
  let presented = false;
  let unmounted = false;
  return {
    get presented() {
      return presented;
    },
    setOpen(open) {
      if (unmounted) return "none";
      if (open) {
        if (presented) return "none";
        presented = true;
        return "present";
      }
      if (!presented) return "none"; // never dismiss what was not presented
      presented = false;
      return "dismiss";
    },
    dismissed() {
      presented = false;
      // after unmount the owner is gone: never call into it
      return unmounted ? "none" : "notifyClose";
    },
    mount() {
      unmounted = false;
    },
    unmount() {
      if (unmounted) return "none";
      unmounted = true;
      if (!presented) return "none";
      presented = false;
      return "dismissInstant";
    },
  };
}
