import { Text, type TextProps } from "react-native";

/** "Court 1 · Padel" -- the ONE way a court's name is shown next to its sport. Sport is optional because a few API payloads
 * (approvals, refunds, waitlist) only carry the court's name; callers look the sport up where they can. */
export function courtLabel(name: string, sport?: string | null): string {
  return sport ? `${name} · ${sport}` : name;
}

/** Text version. Pass the same className/style you would pass to a plain <Text>. */
export function CourtLabel({ name, sport, ...rest }: { name: string; sport?: string | null } & TextProps) {
  return <Text {...rest}>{courtLabel(name, sport)}</Text>;
}

/** Some payloads (approvals, refunds, ledger) only carry a court's NAME. Find its sport among the venue's courts; when two
 * courts share a name the answer would be a guess, so return undefined instead. */
export function sportForCourtName(courts: { name: string; sport: string }[] | undefined, name: string): string | undefined {
  const matches = (courts ?? []).filter((c) => c.name === name);
  return matches.length === 1 ? matches[0].sport : undefined;
}
