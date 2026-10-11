import { Suspense } from "react";
import type { Metadata } from "next";
import { KheloPage } from "@/components/site/page-shell";
import { ForgotForm } from "@/components/auth-v2/forgot-form";

export const metadata: Metadata = {
  title: "Forgot password",
  description: "Forgot your Khelo password? Enter your mobile number and we will send a reset code on WhatsApp.",
};

export default function ForgotPasswordPage() {
  return (
    <KheloPage app>
      <Suspense>
        <ForgotForm />
      </Suspense>
    </KheloPage>
  );
}
