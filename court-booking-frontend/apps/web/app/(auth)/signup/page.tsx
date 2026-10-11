import { Suspense } from "react";
import type { Metadata } from "next";
import { KheloPage } from "@/components/site/page-shell";
import { SignupForm } from "@/components/auth-v2/signup-form";

export const metadata: Metadata = {
  title: "Sign up",
  description: "Create your Khelo account to book courts, or sign up as a venue owner to list your courts.",
};

export default function SignupPage() {
  return (
    <KheloPage app>
      <Suspense>
        <SignupForm />
      </Suspense>
    </KheloPage>
  );
}
