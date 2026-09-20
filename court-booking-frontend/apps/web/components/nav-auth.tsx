"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/auth-store";
import { homeForRole } from "@/lib/use-auth-helpers";
import { Logo } from "@/components/auth/logo";

/** The right-hand side of every public page's header. Reflects the REAL session: signed-out
 * visitors see Log in / Sign up; signed-in users see who they are, a way to their own space,
 * and Log out (previously the header always said "Sign in", and players had no logout at all
 * outside the owner/admin dashboards). Renders nothing until the session has been read, so a
 * signed-in user never sees a flash of "Log in". */
export function NavAuth() {
  const router = useRouter();
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);

  if (status === "hydrating") return <span className="w-40 h-10" aria-hidden="true" />;

  if (status !== "signedIn" || !user) {
    return (
      <div className="flex items-center gap-4">
        <Link href="/login" className="text-[14.5px] font-semibold text-player-ink-muted">
          Log in
        </Link>
        <Link href="/signup" className="px-5 py-2.5 rounded-xl bg-player-ink text-white text-[14.5px] font-bold">
          Sign up
        </Link>
      </div>
    );
  }

  const firstName = user.name?.split(" ")[0] ?? null;
  return (
    <div className="flex items-center gap-3 sm:gap-4">
      <Link
        href={user.role === "player" ? "/bookings" : homeForRole(user.role)}
        className="text-[14.5px] font-semibold text-player-ink-muted"
      >
        {user.role === "player" ? "My bookings" : "Dashboard"}
      </Link>
      <Link href="/account" className="text-[14px] font-bold text-player-ink" title="Your account" aria-label="Your account">
        {firstName ?? user.phone}
      </Link>
      <button
        onClick={() => {
          // Best effort server-side revoke; the local sign-out happens regardless.
          void import("@/lib/api").then(({ api }) => api.auth.logout().catch(() => undefined)).finally(() => {
            useAuthStore.getState().signOut();
            router.push("/");
          });
        }}
        className="px-4 py-2 rounded-xl border border-player-border text-[14px] font-semibold text-player-ink"
      >
        Log out
      </button>
    </div>
  );
}

/** A slim header for the public pages that don't have their own (search, venue, bookings). */
export function SiteHeader() {
  return (
    <header className="flex items-center gap-6 px-6 md:px-14 py-4 bg-player-surface border-b border-player-border-light">
      <Link href="/" aria-label="Maidan home">
        <Logo size={38} />
      </Link>
      <nav className="hidden md:flex gap-6 flex-1 text-[14.5px] font-semibold text-player-ink-muted">
        <Link href="/search">Find a court</Link>
        <Link href="/signup?role=owner">For venues</Link>
      </nav>
      <div className="flex-1 md:flex-none" />
      <NavAuth />
    </header>
  );
}
