import type { Metadata } from "next";
import { getT } from "@/lib/i18n-server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("odash.meta.premium") };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}