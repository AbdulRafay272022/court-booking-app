const DEVICE_ID_KEY = "maidan.device_id";

function uuidV4(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Stable per-browser id, sent with login/verify like the mobile app's (web previously
 * sent none, so every browser session looked like an unnamed device to the backend). */
export function getOrCreateDeviceId(): string {
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const id = uuidV4();
    window.localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    return uuidV4();
  }
}

export function webDeviceInfo() {
  return { device_id: getOrCreateDeviceId(), device_name: "Web browser", platform: "web" as const };
}
