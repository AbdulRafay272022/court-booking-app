import { Suspense } from "react";
import { AccountHub, type HelpContacts } from "@/components/account-hub/account-hub";
import { getSiteConfig, mailtoLink, whatsappLink } from "@/lib/site-config";

// Support contacts come from the running container's environment (see lib/site-config.ts), so this page renders per request.
export const dynamic = "force-dynamic";

export default function AccountPage() {
  const config = getSiteConfig();
  const help: HelpContacts = {
    whatsappHref: whatsappLink(config),
    whatsappNumber: config.supportWhatsapp,
    emailHref: mailtoLink(config),
    email: config.supportEmail,
    hours: config.supportHours,
  };
  return (
    <Suspense>
      <AccountHub help={help} />
    </Suspense>
  );
}
