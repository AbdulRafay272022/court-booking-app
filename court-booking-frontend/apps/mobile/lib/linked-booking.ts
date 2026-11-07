import { useState } from "react";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** fix/nov-8: owner screens take `booking=<id>&open=1` (from a notification) and open that booking's detail sheet at once. */
export function linkedBookingId(params: { booking?: string; open?: string }): string | null {
  return params.open === "1" && params.booking && UUID_RE.test(params.booking) ? params.booking : null;
}

/** The sheet's booking id, opened by the route params on mount AND when a later notification tap changes them. */
export function useLinkedDetail(params: { booking?: string; open?: string }): [string | null, (id: string | null) => void] {
  const linked = linkedBookingId(params);
  const [id, setId] = useState<string | null>(linked);
  const [seen, setSeen] = useState<string | null>(linked);
  if (linked !== seen) {
    setSeen(linked);
    if (linked) setId(linked);
  }
  return [id, setId];
}
