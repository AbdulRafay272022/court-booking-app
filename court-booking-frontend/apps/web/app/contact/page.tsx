import type { Metadata } from "next";
import Link from "next/link";
import { KheloPage } from "@/components/site/page-shell";
import { Container, Eyebrow } from "@/components/site/primitives";
import { buttonClasses } from "@/components/site/button";
import { ContactForm } from "@/components/contact/contact-form";
import { COMPANY_NAME, getSiteConfig, mailtoLink, whatsappLink } from "@/lib/site-config";
import { getT } from "@/lib/i18n-server";

// The support contact comes from the running server's environment (see lib/site-config.ts), so render per request.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  const description = t("contact.meta.description", { company: COMPANY_NAME });
  return { title: t("contact.meta.title"), description, openGraph: { title: t("contact.meta.ogTitle"), description, type: "website" } };
}

export default async function ContactPage() {
  const t = await getT();
  const config = getSiteConfig();
  const whatsapp = config.supportWhatsapp;
  const email = config.supportEmail;
  const hours = config.supportHours;
  const hasForm = Boolean(whatsapp || email);
  const waHref = whatsappLink(config);
  const mailHref = mailtoLink(config);

  return (
    <KheloPage>
      {/* HERO */}
      <section className="bg-khelo-ink text-white">
        <Container className="pb-[136px] pt-12 md:pb-40">
          <Eyebrow tone="orange">{t("contact.hero.eyebrow")}</Eyebrow>
          <h1 className="mt-4 max-w-[860px] font-khelo-display text-[40px] font-extrabold leading-none tracking-[-1.4px] md:text-[68px] md:tracking-[-2.2px]">
            {t("contact.hero.title")}
          </h1>
          <p className="mt-6 max-w-[600px] text-[17px] leading-[1.65] text-white/80 md:text-[19px]">
            {t("contact.hero.sub")}
          </p>
        </Container>
      </section>

      {/* FORM + INFO */}
      <Container className="-mt-24 flex flex-wrap items-start gap-6">
        {hasForm ? (
          <ContactForm whatsapp={whatsapp} email={email} />
        ) : (
          <div className="min-w-0 flex-[1_1_480px] rounded-[32px] bg-khelo-surface p-6 shadow-[0_30px_60px_rgba(12,31,29,0.12)] sm:p-10">
            <h2 className="font-khelo-display text-[30px] font-extrabold tracking-[-0.8px]">{t("contact.soon.title")}</h2>
            <p className="mt-3 leading-[1.6] text-khelo-muted">{t("contact.soon.body")}</p>
          </div>
        )}

        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-4">
          {whatsapp && waHref ? (
            <a
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              className="khelo-card block rounded-[28px] bg-khelo-whatsapp p-[30px] text-khelo-ink"
            >
              <div className="text-[22px] font-extrabold">{t("contact.whatsapp.title")}</div>
              <p className="mt-2 leading-[1.55]">{t("contact.whatsapp.body")}</p>
              <div className="mt-4 break-words text-[20px] font-extrabold">{whatsapp}</div>
            </a>
          ) : null}
          {email && mailHref ? (
            <div className="rounded-[28px] bg-khelo-surface p-[30px]">
              <div className="text-[22px] font-extrabold">{t("contact.email.title")}</div>
              <a href={mailHref} className="mt-2 block break-words text-khelo-muted underline decoration-khelo-border underline-offset-4">
                {email}
              </a>
            </div>
          ) : null}
          <div className="rounded-[28px] bg-khelo-surface p-[30px]">
            <div className="text-[22px] font-extrabold">{t("contact.place.title")}</div>
            <p className="mt-2 leading-[1.6] text-khelo-muted">
              {t("contact.place.company", { company: COMPANY_NAME })}
              {hours ? (
                <>
                  <br />
                  {t("contact.place.hours", { hours })}
                </>
              ) : null}
            </p>
          </div>
        </div>
      </Container>

      {/* LEGAL LINKS */}
      <Container className="pb-24 pt-[72px]">
        <div className="flex flex-wrap gap-3.5">
          <Link
            href="/terms"
            className={buttonClasses({ variant: "outlineDark", pill: true, className: "!border-khelo-border bg-khelo-surface px-6 py-3.5" })}
          >
            {t("contact.legal.terms")}
          </Link>
          <Link
            href="/privacy"
            className={buttonClasses({ variant: "outlineDark", pill: true, className: "!border-khelo-border bg-khelo-surface px-6 py-3.5" })}
          >
            {t("contact.legal.privacy")}
          </Link>
        </div>
      </Container>
    </KheloPage>
  );
}
