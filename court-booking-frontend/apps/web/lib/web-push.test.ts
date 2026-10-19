import assert from "node:assert/strict";
import test from "node:test";
import {
  arrayBufferToBase64Url,
  detectSupport,
  disablePush,
  enablePush,
  isIos,
  pushUiState,
  sameKey,
  shouldShowTabPopup,
  subscriptionBody,
  urlBase64ToUint8Array,
  type PushEnv,
  type SubscriptionBody,
} from "./web-push";

// A real-looking uncompressed P-256 public key (65 bytes, 0x04 prefix), base64url without padding.
const KEY = "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";

test("urlBase64ToUint8Array decodes a VAPID key (65 bytes, 0x04 prefix)", () => {
  const bytes = urlBase64ToUint8Array(KEY);
  assert.equal(bytes.length, 65);
  assert.equal(bytes[0], 4);
});

test("base64url round trip, with and without padding, - and _ characters", () => {
  const raw = new Uint8Array([0xfb, 0xff, 0xbf, 0x00, 0x01, 0xfe]);
  const enc = arrayBufferToBase64Url(raw);
  assert.equal(enc, "-_-_AAH-");
  assert.ok(!enc.includes("=") && !enc.includes("+") && !enc.includes("/"));
  assert.deepEqual([...urlBase64ToUint8Array(enc)], [...raw]);
  assert.deepEqual([...urlBase64ToUint8Array("AQ==")], [1]);
  assert.deepEqual([...urlBase64ToUint8Array("AQ")], [1]);
  assert.equal(arrayBufferToBase64Url(urlBase64ToUint8Array(KEY)), KEY);
  assert.equal(arrayBufferToBase64Url(null), "");
  assert.equal(arrayBufferToBase64Url(raw.buffer), enc);
});

test("urlBase64ToUint8Array rejects standard base64 and junk", () => {
  assert.throws(() => urlBase64ToUint8Array("ab+c"));
  assert.throws(() => urlBase64ToUint8Array("not a key!"));
});

test("sameKey compares the subscription key with the server key", () => {
  const k = urlBase64ToUint8Array(KEY);
  assert.equal(sameKey(k.buffer, KEY), true);
  const other = new Uint8Array(k);
  other[10] ^= 1;
  assert.equal(sameKey(other.buffer, KEY), false);
  assert.equal(sameKey(null, KEY), true);
});

const DESKTOP: PushEnv = {
  hasNotification: true,
  hasServiceWorker: true,
  hasPushManager: true,
  secure: true,
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0",
  maxTouchPoints: 0,
  standalone: false,
};
const IPHONE_SAFARI: PushEnv = {
  hasNotification: false,
  hasServiceWorker: true,
  hasPushManager: false,
  secure: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Version/17.4 Mobile/15E148 Safari/604.1",
  maxTouchPoints: 5,
  standalone: false,
};

test("detectSupport: desktop Chrome, iPhone tab, installed iPhone, iPad as Mac, old browser, http", () => {
  assert.equal(detectSupport(DESKTOP), "supported");
  assert.equal(detectSupport(IPHONE_SAFARI), "ios-install");
  assert.equal(detectSupport({ ...IPHONE_SAFARI, standalone: true, hasNotification: true, hasPushManager: true }), "supported");
  // installed but an old iOS (no PushManager even standalone): nothing to offer
  assert.equal(detectSupport({ ...IPHONE_SAFARI, standalone: true }), "unsupported");
  const ipad = { ...IPHONE_SAFARI, userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/17.4 Safari/605.1.15" };
  assert.equal(isIos(ipad), true);
  assert.equal(detectSupport(ipad), "ios-install");
  assert.equal(isIos({ userAgent: ipad.userAgent, maxTouchPoints: 0 }), false); // a real Mac
  assert.equal(detectSupport({ ...DESKTOP, hasPushManager: false }), "unsupported");
  assert.equal(detectSupport({ ...DESKTOP, secure: false }), "unsupported");
});

test("pushUiState: every state of docs/web-push-plan.md section 8", () => {
  const base = { support: "supported" as const, backendEnabled: true, permission: "default" as const, subscribedHere: false };
  assert.equal(pushUiState({ ...base, backendEnabled: false }), "hidden");
  assert.equal(pushUiState({ ...base, backendEnabled: null }), "hidden");
  assert.equal(pushUiState({ ...base, support: "unsupported" }), "unsupported");
  assert.equal(pushUiState({ ...base, support: "ios-install" }), "ios-install");
  assert.equal(pushUiState({ ...base, permission: "unsupported" }), "unsupported");
  assert.equal(pushUiState(base), "not-asked");
  assert.equal(pushUiState({ ...base, permission: "denied" }), "denied");
  assert.equal(pushUiState({ ...base, permission: "granted" }), "granted-not-subscribed");
  assert.equal(pushUiState({ ...base, permission: "granted", subscribedHere: true }), "subscribed");
  // backend off wins over everything (button hidden)
  assert.equal(pushUiState({ ...base, backendEnabled: false, permission: "granted", subscribedHere: true }), "hidden");
});

test("shouldShowTabPopup: suppressed while a push subscription is active here", () => {
  assert.equal(shouldShowTabPopup(true, "granted", false), true);
  assert.equal(shouldShowTabPopup(true, "granted", true), false);
  assert.equal(shouldShowTabPopup(false, "granted", false), false);
  assert.equal(shouldShowTabPopup(true, "default", false), false);
});

function fakeSub(endpoint: string, json = true): PushSubscription {
  const p = urlBase64ToUint8Array(KEY);
  const a = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  let unsubscribed = false;
  return {
    endpoint,
    options: { applicationServerKey: urlBase64ToUint8Array(KEY).buffer, userVisibleOnly: true },
    toJSON: () => (json ? { endpoint, keys: { p256dh: arrayBufferToBase64Url(p), auth: arrayBufferToBase64Url(a) } } : { endpoint }),
    getKey: (name: string) => (name === "p256dh" ? p.buffer : a.buffer),
    unsubscribe: async () => {
      unsubscribed = true;
      return true;
    },
    get unsubscribed() {
      return unsubscribed;
    },
  } as unknown as PushSubscription;
}

test("subscriptionBody: from toJSON or from getKey, user agent trimmed", () => {
  const b1 = subscriptionBody(fakeSub("https://fcm.googleapis.com/fcm/send/x"), "UA");
  assert.equal(b1.endpoint, "https://fcm.googleapis.com/fcm/send/x");
  assert.equal(b1.keys.p256dh, KEY);
  assert.equal(b1.keys.auth, "AQIDBAUGBwgJCgsMDQ4PEA");
  assert.equal(b1.user_agent, "UA");
  const b2 = subscriptionBody(fakeSub("https://e", false), "x".repeat(600));
  assert.equal(b2.keys.p256dh, KEY);
  assert.equal(b2.user_agent?.length, 500);
  assert.equal(subscriptionBody(fakeSub("https://e")).user_agent, undefined);
});

/** Minimal browser stand-ins for the enable / disable flows. */
function installBrowser(opts: { permission: NotificationPermission; answer?: NotificationPermission; existing?: PushSubscription | null }) {
  const log = { requested: 0, registered: [] as string[], subscribed: 0 };
  let current: PushSubscription | null = opts.existing ?? null;
  let reg: unknown = current ? {} : undefined;
  const pushManager = {
    getSubscription: async () => current,
    subscribe: async () => {
      log.subscribed += 1;
      current = fakeSub("https://fcm.googleapis.com/fcm/send/new");
      return current;
    },
  };
  if (reg) reg = { pushManager };
  const N = {
    permission: opts.permission,
    requestPermission: async () => {
      log.requested += 1;
      N.permission = opts.answer ?? "granted";
      return N.permission;
    },
  };
  const g = globalThis as unknown as Record<string, unknown>;
  g.Notification = N;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      userAgent: "TestUA",
      serviceWorker: {
        getRegistration: async () => reg,
        register: async (url: string) => {
          log.registered.push(url);
          reg = { pushManager };
          return reg;
        },
        ready: Promise.resolve(),
      },
    },
  });
  return { log, sub: () => current };
}

function fakeApi() {
  const calls: { op: string; arg: SubscriptionBody | string }[] = [];
  return {
    calls,
    api: {
      webPushSubscribe: async (s: SubscriptionBody) => void calls.push({ op: "post", arg: s }),
      webPushUnsubscribe: async (e: string) => void calls.push({ op: "delete", arg: e }),
    },
  };
}

test("enablePush: asks once, registers /sw.js, subscribes, POSTs", async () => {
  const b = installBrowser({ permission: "default", answer: "granted" });
  const f = fakeApi();
  const r = await enablePush(f.api, KEY);
  assert.deepEqual(r, { ok: true, endpoint: "https://fcm.googleapis.com/fcm/send/new" });
  assert.equal(b.log.requested, 1);
  assert.deepEqual(b.log.registered, ["/sw.js"]);
  assert.equal(b.log.subscribed, 1);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].op, "post");
  assert.equal((f.calls[0].arg as SubscriptionBody).user_agent, "TestUA");
});

test("enablePush: denied or dismissed never subscribes or POSTs", async () => {
  let b = installBrowser({ permission: "default", answer: "denied" });
  let f = fakeApi();
  assert.deepEqual(await enablePush(f.api, KEY), { ok: false, reason: "denied" });
  assert.equal(b.log.subscribed + f.calls.length, 0);
  b = installBrowser({ permission: "default", answer: "default" });
  f = fakeApi();
  assert.deepEqual(await enablePush(f.api, KEY), { ok: false, reason: "dismissed" });
  assert.equal(b.log.registered.length + f.calls.length, 0);
});

test("enablePush: already granted = no prompt; an existing subscription is reused", async () => {
  const existing = fakeSub("https://fcm.googleapis.com/fcm/send/old");
  const b = installBrowser({ permission: "granted", existing });
  const f = fakeApi();
  const r = await enablePush(f.api, KEY);
  assert.deepEqual(r, { ok: true, endpoint: "https://fcm.googleapis.com/fcm/send/old" });
  assert.equal(b.log.requested, 0);
  assert.equal(b.log.subscribed, 0);
  assert.equal(f.calls.length, 1);
});

test("disablePush: unsubscribes in the browser and DELETEs the endpoint", async () => {
  const existing = fakeSub("https://fcm.googleapis.com/fcm/send/old");
  installBrowser({ permission: "granted", existing });
  const f = fakeApi();
  await disablePush(f.api);
  assert.equal((existing as unknown as { unsubscribed: boolean }).unsubscribed, true);
  assert.deepEqual(f.calls, [{ op: "delete", arg: "https://fcm.googleapis.com/fcm/send/old" }]);
});
