"use client";

import { useEffect, useState } from "react";

/** Section 12 offline handling: the browser's own online/offline events (airplane mode,
 * wifi drop) are reliable on web, unlike React Native which needs a native module. */
export function useNetworkStatus(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return online;
}
