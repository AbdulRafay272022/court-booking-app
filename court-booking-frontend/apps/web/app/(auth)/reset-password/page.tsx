import { Suspense } from "react";
import type { Metadata } from "next";
import { KheloPage } from "@/components/site/page-shell";
import { ResetForm } from "@/components/auth-v2/reset-form";

export const metadata: Metadata = {
  title: "Reset password",
  description: "Enter the WhatsApp code and choose a new password for your Khelo account.",
};

export default function ResetPasswordPage() {
  return (
    <KheloPage app>
      <Suspense>
        <ResetForm />
      </Suspense>
    </KheloPage>
  );
}
