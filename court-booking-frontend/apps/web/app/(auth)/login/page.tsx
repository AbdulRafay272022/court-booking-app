import { Suspense } from "react";
import type { Metadata } from "next";
import { getT } from "@/lib/i18n-server";
import { KheloPage } from "@/components/site/page-shell";
import { LoginForm } from "@/components/auth-v2/login-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("auth.meta.login.title"), description: t("auth.meta.login.description") };
}

export default function LoginPage() {
  return (
    <KheloPage app>
      <Suspense>
        <LoginForm />
      </Suspense>
    </KheloPage>
  );
}
