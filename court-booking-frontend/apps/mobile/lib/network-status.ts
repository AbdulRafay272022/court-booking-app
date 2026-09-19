import { useEffect, useState } from "react";
import { API_BASE_URL } from "./config";

/** Section 12 offline handling: no NetInfo/expo-network dependency is installed in this
 * project, and adding a native module can't be verified without a real device this
 * session (see the mobile CLAUDE.md's package-install gotchas) -- so this polls the
 * backend's own `/health` instead of relying on device-level connectivity APIs. Same
 * practical effect (a clear "you're offline" state that clears itself on reconnect)
 * with zero new native dependencies. */
export function useNetworkStatus(intervalMs = 8000): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(`${API_BASE_URL}/health`, { signal: controller.signal });
        clearTimeout(timeout);
        if (!cancelled) setOnline(res.ok);
      } catch {
        if (!cancelled) setOnline(false);
      }
    }

    check();
    const id = setInterval(check, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [intervalMs]);

  return online;
}
