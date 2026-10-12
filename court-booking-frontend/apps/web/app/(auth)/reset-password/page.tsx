import { Suspense } from "react";
import type { Metadata } from "next";
import { getT } from "@/lib/i18n-server";
import { KheloPage } from "@/components/site/page-shell";
import { ResetForm } from "@/components/auth-v2/reset-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("auth.meta.reset.title"), description: t("auth.meta.reset.description") };
}

export default function ResetPasswordPage() {
  return (
    <KheloPage app>
      <Suspense>
        <ResetForm />
      </Suspense>
    </KheloPage>
  );
}
