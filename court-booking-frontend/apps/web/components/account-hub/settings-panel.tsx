"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/auth-store";
import { suppressAuthRedirect } from "@/lib/use-require-auth";
import { useT } from "@/components/i18n/lang-provider";
import { LanguageSwitch } from "@/components/i18n/language-switch";
import { Card } from "./parts";
import type { HelpContacts } from "./account-hub";

const ACTION =
  "khelo-btn inline-flex min-h-11 shrink-0 items-center justify-center rounded-[14px] border-[1.5px] border-khelo-ink px-5 py-2 text-[15px] font-bold text-khelo-ink";
const H2 = "font-khelo-display text-[20px] font-extrabold tracking-tight";

function logout(router: ReturnType<typeof useRouter>) {
  // Best effort server-side revoke; the local sign-out happens regardless.
  void import("@/lib/api").then(({ api }) => api.auth.logout().catch(() => undefined)).finally(() => {
    suppressAuthRedirect(); // deliberate sign-out: land on "/", not on /login?next=
    useAuthStore.getState().signOut();
    router.push("/");
  });
}

/** Account > Settings: language, sign-in details (phone, password), help, legal links and log out.
 * There are no notification preferences: the backend only keeps a read-only log of sent notifications (GET /users/me/notifications), no settings to change. */
export function SettingsPanel({ help }: { help: HelpContacts }) {
  const t = useT();
  const router = useRouter();
  const user = useAuthStore((s) => s.user)!;
  const hasHelp = !!(help.whatsappHref || help.emailHref);

  return (
    <div className="flex flex-col gap-5">
      <Card as="section" aria-labelledby="set-lang-h" className="flex flex-col gap-3">
        <h2 id="set-lang-h" className={H2}>
          {t("account.settings.language")}
        </h2>
        <p className="text-[15px] text-khelo-muted">{t("account.settings.languageHint")}</p>
        <LanguageSwitch tone="light" className="self-start" />
      </Card>

      <Card as="section" aria-labelledby="set-signin-h" className="flex flex-col gap-4">
        <h2 id="set-signin-h" className={H2}>
          {t("account.settings.signIn")}
        </h2>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[14px] font-bold text-khelo-muted-2">{t("account.settings.phone")}</span>
            <span className="font-mono-plex text-[17px] font-semibold" data-testid="account-phone">
              {user.phone}
            </span>
            <span className="max-w-md text-[14px] text-khelo-muted">{t("account.settings.phoneHint")}</span>
          </div>
          <Link href="/account/phone" className={ACTION}>
            {t("account.settings.changePhone")}
          </Link>
        </div>
        <hr className="border-khelo-divider" />
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[14px] font-bold text-khelo-muted-2">{t("account.settings.password")}</span>
            <span className="max-w-md text-[14px] text-khelo-muted">{t("account.settings.passwordHint")}</span>
          </div>
          <Link href={`/forgot-password?phone=${encodeURIComponent(user.phone)}`} className={ACTION}>
            {t("account.settings.changePassword")}
          </Link>
        </div>
      </Card>

      {hasHelp ? (
        <Card as="section" aria-labelledby="set-help-h" className="flex flex-col gap-3" data-testid="account-help">
          <h2 id="set-help-h" className={H2}>
            {t("account.settings.help")}
          </h2>
          <p className="text-[15px] text-khelo-muted">{t("account.settings.helpHint")}</p>
          <ul className="flex flex-col gap-1">
            {help.whatsappHref ? (
              <li>
                <a href={help.whatsappHref} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 text-[16px] font-bold text-khelo-teal hover:underline">
                  {t("account.settings.helpWhatsapp")}
                  {help.whatsappNumber ? <span className="font-mono-plex text-[14px] font-semibold text-khelo-muted">{help.whatsappNumber}</span> : null}
                </a>
              </li>
            ) : null}
            {help.emailHref ? (
              <li>
                <a href={help.emailHref} className="inline-flex min-h-11 items-center gap-2 text-[16px] font-bold text-khelo-teal hover:underline">
                  {t("account.settings.helpEmail")}
                  <span className="text-[14px] font-semibold text-khelo-muted">{help.email}</span>
                </a>
              </li>
            ) : null}
          </ul>
          {help.hours ? <p className="text-[14px] text-khelo-muted-2">{help.hours}</p> : null}
        </Card>
      ) : null}

      <Card as="section" aria-labelledby="set-legal-h" className="flex flex-col gap-1">
        <h2 id="set-legal-h" className={H2}>
          {t("account.settings.legal")}
        </h2>
        <Link href="/terms" className="inline-flex min-h-11 items-center text-[16px] font-bold hover:underline">
          {t("account.settings.terms")}
        </Link>
        <Link href="/privacy" className="inline-flex min-h-11 items-center text-[16px] font-bold hover:underline">
          {t("account.settings.privacy")}
        </Link>
      </Card>

      <button
        type="button"
        onClick={() => logout(router)}
        data-testid="account-logout"
        className="khelo-btn inline-flex min-h-11 cursor-pointer items-center justify-center rounded-[14px] bg-khelo-ink px-6 py-3.5 text-[16px] font-extrabold text-white"
      >
        {t("account.settings.logout")}
      </button>
    </div>
  );
}
