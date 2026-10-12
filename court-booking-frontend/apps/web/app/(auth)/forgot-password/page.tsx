import { Suspense } from "react";
import type { Metadata } from "next";
import { getT } from "@/lib/i18n-server";
import { KheloPage } from "@/components/site/page-shell";
import { ForgotForm } from "@/components/auth-v2/forgot-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("auth.meta.forgot.title"), description: t("auth.meta.forgot.description") };
}

export default function ForgotPasswordPage() {
  return (
    <KheloPage app>
      <Suspense>
        <ForgotForm />
      </Suspense>
    </KheloPage>
  );
}
