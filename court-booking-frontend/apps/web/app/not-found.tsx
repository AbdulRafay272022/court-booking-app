import type { Metadata } from "next";
import { KheloPage } from "@/components/site/page-shell";
import { Container } from "@/components/site/primitives";
import { Button } from "@/components/site/button";
import { getT } from "@/lib/i18n-server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("common.notFound.title") };
}

export default async function NotFound() {
  const t = await getT();
  return (
    <KheloPage>
      <Container className="flex flex-col items-start gap-5 py-20">
        <p className="font-khelo-display text-[64px] font-extrabold leading-none tracking-[-2px] text-khelo-orange">404</p>
        <h1 className="font-khelo-display text-[32px] font-extrabold leading-tight tracking-[-1px] md:text-[44px]">
          {t("common.notFound.title")}
        </h1>
        <p className="max-w-[520px] text-[17px] leading-relaxed text-khelo-muted">{t("common.notFound.text")}</p>
        <div className="flex flex-wrap gap-3">
          <Button href="/" variant="primary">
            {t("common.notFound.home")}
          </Button>
          <Button href="/search" variant="outlineDark">
            {t("common.notFound.search")}
          </Button>
        </div>
      </Container>
    </KheloPage>
  );
}
