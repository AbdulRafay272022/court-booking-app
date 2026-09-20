"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRequireAuth } from "@/lib/use-require-auth";
import { useAuthStore } from "@/lib/auth-store";
import { homeForRole } from "@/lib/use-auth-helpers";
import { Logo } from "@/components/auth/logo";
import { TONES } from "@/components/auth/tone";

/** Account area for BOTH roles (players and owners): profile, phone number, password. Uses the
 * owner (teal) system for owners and the player (orange) system for everyone else. */
export default function AccountLayout({ children }: { children: React.ReactNode }) {
  const { ready } = useRequireAuth();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const tone = user?.role === "owner" || user?.role === "admin" ? "owner" : "player";
  const t = TONES[tone];

  if (!ready || !user) return <div className="min-h-screen" style={{ background: t.bg }} />;

  const back = user.role === "player" ? { href: "/", label: "← Back to Maidan" } : { href: homeForRole(user.role), label: "← Back to dashboard" };

  return (
    <div className={`min-h-screen ${t.fontClass}`} style={{ background: t.bg, color: t.ink }}>
      <header className="flex items-center justify-between gap-4 px-5 sm:px-8 py-4" style={{ background: t.surface, borderBottom: `1px solid ${t.border}` }}>
        <Link href="/" aria-label="Maidan home">
          <Logo tone={tone} size={34} />
        </Link>
        <div className="flex items-center gap-3">
          <Link href={back.href} className="text-[13.5px] font-semibold" style={{ color: t.muted }}>
            {back.label}
          </Link>
          <button
            onClick={() => {
              void api_logout().finally(() => {
                useAuthStore.getState().signOut();
                router.push("/");
              });
            }}
            className="px-3.5 py-2 rounded-lg text-[13px] font-semibold"
            style={{ border: `1px solid ${t.border}` }}
          >
            Log out
          </button>
        </div>
      </header>
      <main className="max-w-xl mx-auto px-5 sm:px-6 py-8 flex flex-col gap-6">{children}</main>
    </div>
  );
}

async function api_logout() {
  const { api } = await import("@/lib/api");
  await api.auth.logout().catch(() => undefined);
}
