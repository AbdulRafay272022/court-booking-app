import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getT } from "@/lib/i18n-server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t("account.phone.meta.title"),
    description: t("account.phone.meta.description"),
    robots: { index: false, follow: false },
  };
}

export default function ChangePhoneLayout({ children }: { children: ReactNode }) {
  return children;
}
