// English copy: same keys as messages/ru/media.ts.
import type { ruMedia } from "../ru/media";

export const enMedia: Record<keyof typeof ruMedia, string> = {
  "media.thumb.caption": "Tap to enlarge",
  "media.thumb.openAria": "{alt}: open large view",
  "media.thumb.loading": "Loading screenshot",
  "media.thumb.none": "No screenshot",
  "media.thumb.error": "Could not load the screenshot.",
  "media.thumb.retry": "Try again",
  "media.lb.title": "Payment screenshot",
  "media.lb.zoomIn": "Zoom in",
  "media.lb.zoomOut": "Zoom out",
  "media.lb.fit": "Fit",
  "media.lb.fitAria": "Fit to screen",
  "media.lb.close": "Close",
  "media.lb.zoom": "Zoom {n}%",
  "media.lb.hint": "Scroll or pinch to zoom, drag to move when zoomed in.",
  "media.lb.loading": "Loading screenshot...",
  "media.lb.error": "Could not load the screenshot. Close it and open it again.",
};
