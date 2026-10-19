/* Khelo service worker (Round 2 Stage 2, docs/web-push-plan.md section 8). Web Push only: no caching, no fetch handler.
 * Served with Cache-Control: no-cache and Service-Worker-Allowed: / (next.config.ts headers()). Plain ES2017, no imports. */

const ICON = "/brand/khelo-icon-192.png";
const BADGE = "/brand/khelo-badge-96.png";
const DEFAULT_URL = "/";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/** Only same-origin paths are opened (the server sends a path such as /dashboard/owner/approvals). */
function safeUrl(raw) {
  try {
    const u = new URL(raw || DEFAULT_URL, self.location.origin);
    return u.origin === self.location.origin ? u.pathname + u.search + u.hash : DEFAULT_URL;
  } catch {
    return DEFAULT_URL;
  }
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Khelo";
  const options = {
    body: data.body || "",
    tag: data.tag || data.event_type || "khelo",
    renotify: !!data.tag,
    icon: ICON,
    badge: BADGE,
    data: { url: safeUrl(data.url), event_type: data.event_type || null },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = safeUrl(event.notification.data && event.notification.data.url);
  const target = new URL(path, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // An open Khelo tab: focus it and move it to the page. Prefer one already on that page.
      const same = list.find((c) => c.url === target);
      const any = same || list.find((c) => new URL(c.url).origin === self.location.origin);
      if (any) {
        await any.focus();
        if (!same && "navigate" in any) {
          try {
            await any.navigate(target);
          } catch {
            // an uncontrolled tab cannot be navigated: open a new one instead
            await self.clients.openWindow(target);
          }
        }
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});

/** The browser rotated the subscription: subscribe again with the same key, then have an open Khelo tab POST it (only the page
 * holds the session token). With no tab open, the page re-sends the current subscription on its next load (refreshPush). */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const old = event.oldSubscription;
      const key = old && old.options ? old.options.applicationServerKey : null;
      let sub = event.newSubscription;
      if (!sub && key) {
        sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      }
      if (!sub) return;
      const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // The API needs the signed-in user's token, which only the page has: ask an open tab to POST the new subscription.
      list.forEach((c) => c.postMessage({ type: "khelo-push-resubscribe", subscription: sub.toJSON(), old: old ? old.endpoint : null }));
    })(),
  );
});
