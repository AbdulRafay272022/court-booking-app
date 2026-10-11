import { Suspense } from "react";
import type { Metadata } from "next";
import { KheloPage } from "@/components/site/page-shell";
import { VerifyForm } from "@/components/auth-v2/verify-form";

export const metadata: Metadata = {
  title: "Verify your phone",
  description: "Enter the 6-digit WhatsApp code to verify your mobile number and finish setting up your Khelo account.",
};

export default function VerifyPage() {
  return (
    <KheloPage app>
      <Suspense>
        <VerifyForm />
      </Suspense>
    </KheloPage>
  );
}
