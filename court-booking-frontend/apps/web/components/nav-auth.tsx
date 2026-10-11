"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/auth-store";
import { homeForRole } from "@/lib/use-auth-helpers";

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
    <div className="flex items-center gap-2.5 whitespace-nowrap sm:gap-4">
      <Link
        href={user.role === "player" ? "/bookings" : homeForRole(user.role)}
        className="text-[13.5px] font-semibold text-player-ink-muted sm:text-[14.5px]"
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
        className="px-3 py-2 rounded-xl border border-player-border text-[13.5px] font-semibold text-player-ink sm:px-4 sm:text-[14px]"
      >
        Log out
      </button>
    </div>
  );
}

/** The header for every public page (search, venue, bookings, terms, privacy ...) is the Khelo header. */
export { SiteHeader } from "@/components/site/site-header";
