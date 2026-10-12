import type { Metadata } from "next";
import type { ReactNode } from "react";
import { KheloPage } from "@/components/site/page-shell";
import { AccountGate } from "@/components/account-hub/account-gate";
import { getT } from "@/lib/i18n-server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("account.meta.title"),
    description: t("account.meta.description"),
    robots: { index: false, follow: false },
  };
}

/** Account area for BOTH roles (players and owners): the account hub and the phone-number change. The Khelo frame (header, footer)
 * is the same as every other page; `AccountGate` waits for a signed-in user and otherwise sends them to log in. */
export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <KheloPage>
      <AccountGate>{children}</AccountGate>
    </KheloPage>
  );
}
