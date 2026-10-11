import { Suspense } from "react";
import type { Metadata } from "next";
import { KheloPage } from "@/components/site/page-shell";
import { LoginForm } from "@/components/auth-v2/login-form";

export const metadata: Metadata = {
  title: "Log in",
  description: "Log in to Khelo with your mobile number and password to book courts or manage your venue.",
};

export default function LoginPage() {
  return (
    <KheloPage app>
      <Suspense>
        <LoginForm />
      </Suspense>
    </KheloPage>
  );
}
