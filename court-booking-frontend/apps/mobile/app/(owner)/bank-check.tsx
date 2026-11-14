import { Redirect } from "expo-router";
import { Screen, Text } from "@/components/ui";

import { useOwnerVenues } from "@/lib/use-owner-venues";
import { useLedgerV2 } from "@/lib/use-ledger-v2";
import { BankCheckBlock } from "@/components/paisa/bank-check-block";
import { OwnerHeader } from "./_fl";

/**
 * audit 2026-10-28 Phase 3 item 2: "Bank se mila lein" on the app. Owner, or staff with view_ledger. With ledger v2 on it lives
 * in Paisa -> Kaam ("Bank se mila lein" group) and this route sends you there.
 */
export default function BankCheckScreen() {
  const { activeVenue } = useOwnerVenues();
  const { v2 } = useLedgerV2();
  if (v2) return <Redirect href={{ pathname: "/(owner)/(tabs)/paisa", params: { view: "kaam", group: "bank_check" } }} />;
  return (
    <Screen testID="bank-check-screen">
      <OwnerHeader title="Bank se mila lein" subtitle={activeVenue?.name} />
      <Text variant="meta" tone="muted">
        Is din transfer se jo paisa darj hua (advance aur baqi). Apni bank statement se ek ek mila lein.
      </Text>
      <BankCheckBlock />
    </Screen>
  );
}
