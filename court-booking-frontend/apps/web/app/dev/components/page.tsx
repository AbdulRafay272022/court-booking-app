import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Gallery } from "./gallery";

export const metadata: Metadata = { title: "Floodlight components (dev)", robots: { index: false, follow: false } };

/** DEV ONLY: every Floodlight web component in every state, both roles. 404 in production builds. */
export default function DevComponentsPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Gallery />;
}
