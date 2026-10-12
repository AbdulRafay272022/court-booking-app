import { Suspense } from "react";
import type { Metadata } from "next";
import { getT } from "@/lib/i18n-server";
import { KheloPage } from "@/components/site/page-shell";
import { VerifyForm } from "@/components/auth-v2/verify-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("auth.meta.verify.title"), description: t("auth.meta.verify.description") };
}

export default function VerifyPage() {
  return (
    <KheloPage app>
      <Suspense>
        <VerifyForm />
      </Suspense>
    </KheloPage>
  );
}
