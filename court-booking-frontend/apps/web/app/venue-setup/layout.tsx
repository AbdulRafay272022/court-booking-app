"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRequireAuth } from "@/lib/use-require-auth";
import { useAuthStore } from "@/lib/auth-store";
import { Logo } from "@/components/auth/logo";
import { supportWhatsAppUrl } from "@/lib/support";

/** Venue onboarding (owner system: teal / Plex Sans). Web counterpart of the mobile
 * `(owner)/venue-setup` group -- owners can now sign up and register a venue entirely
 * from a laptop. */
export default function VenueSetupLayout({ children }: { children: React.ReactNode }) {
  const { ready } = useRequireAuth(["owner"]);
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  if (!ready) return <div className="min-h-screen bg-owner-bg" />;

  return (
    <div className="min-h-screen bg-owner-bg text-owner-ink font-[family-name:var(--font-plex-x)]">
      <header className="flex items-center justify-between gap-4 px-5 sm:px-8 py-4 bg-owner-surface border-b border-owner-border">
        <Link href="/" aria-label="Maidan home">
          <Logo tone="owner" size={36} />
        </Link>
        <div className="flex items-center gap-3">
          <a
            href={supportWhatsAppUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:inline text-[13px] font-semibold text-owner-ink-muted"
          >
            Need help? WhatsApp us
          </a>
          <span className="hidden sm:inline text-[13px] text-owner-ink-faint">{user?.name ?? "Owner"}</span>
          <button
            onClick={() => {
              void useAuthStore.getState().signOut();
              router.push("/");
            }}
            className="px-3.5 py-2 rounded-lg text-[13px] font-semibold border border-owner-border"
          >
            Log out
          </button>
        </div>
      </header>
      <main className="max-w-2xl mx-auto px-5 sm:px-6 py-8 flex flex-col gap-6">{children}</main>
    </div>
  );
}
