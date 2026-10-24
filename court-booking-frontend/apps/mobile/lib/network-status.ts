import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { API_BASE_URL } from "./config";
import { healthPollMs } from "./polling";

/** Section 12 offline handling: no NetInfo/expo-network dependency is installed in this
 * project, and adding a native module can't be verified without a real device this
 * session (see the mobile CLAUDE.md's package-install gotchas) -- so this polls the
 * backend's own `/health` instead of relying on device-level connectivity APIs. Same
 * practical effect (a clear "you're offline" state that clears itself on reconnect)
 * with zero new native dependencies.
 * It used to ask every 8 s forever, in the background too. Now it only runs while the app is in the foreground: once
 * a minute while online, every 8 s while offline (so the banner clears soon after the connection is back), and once
 * right away whenever the app comes back to the foreground (docs/mobile-audit-2026-10.md P0-7 / G3). */
export function useNetworkStatus(): boolean {
  const [online, setOnline] = useState(true);
  const [active, setActive] = useState(AppState.currentState !== "background" && AppState.currentState !== "inactive");

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setActive(s === "active"));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function check() {
      let ok = false;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(`${API_BASE_URL}/health`, { signal: controller.signal });
        clearTimeout(timeout);
        ok = res.ok;
      } catch {
        ok = false;
      }
      if (cancelled) return;
      setOnline(ok);
      timer = setTimeout(check, healthPollMs(ok));
    }

    check();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [active]);

  return online;
}
