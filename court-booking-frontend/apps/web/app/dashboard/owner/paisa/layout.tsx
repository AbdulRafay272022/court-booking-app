import type { Metadata } from "next";

export const metadata: Metadata = { title: "Paisa" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
