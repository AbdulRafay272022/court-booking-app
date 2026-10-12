import { Suspense } from "react";
import type { Metadata } from "next";
import { getT } from "@/lib/i18n-server";
import { KheloPage } from "@/components/site/page-shell";
import { SignupForm } from "@/components/auth-v2/signup-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("auth.meta.signup.title"), description: t("auth.meta.signup.description") };
}

export default function SignupPage() {
  return (
    <KheloPage app>
      <Suspense>
        <SignupForm />
      </Suspense>
    </KheloPage>
  );
}
