"use client";

import { useState } from "react";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * fix/nov-8: a notification (bell, web push) opens the exact booking: owner pages take `?booking=<id>&open=1` and open
 * that booking's detail popup at once. Without `open=1` a `booking` param keeps its old meaning (highlight only).
 */
export function linkedBookingId(get: (key: string) => string | null): string | null {
  const id = get("booking");
  return get("open") === "1" && id && UUID_RE.test(id) ? id : null;
}

/** The popup's booking id, opened by the URL's `?booking=&open=1` on load AND when the URL later changes to another
 * linked booking while the page is already open (a second bell click on the same page). */
export function useLinkedDetail(search: { get(key: string): string | null }): [string | null, (id: string | null) => void] {
  const linked = linkedBookingId((k) => search.get(k));
  const [id, setId] = useState<string | null>(linked);
  const [seen, setSeen] = useState<string | null>(linked);
  if (linked !== seen) {
    setSeen(linked);
    if (linked) setId(linked);
  }
  return [id, setId];
}
