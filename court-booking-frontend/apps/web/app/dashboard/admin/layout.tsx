"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRequireAuth } from "@/lib/use-require-auth";
import { useAuthStore } from "@/lib/auth-store";
import { Logo } from "@/components/auth/logo";

const NAV = [
  { href: "/dashboard/admin/venues", label: "Venues" },
  { href: "/dashboard/admin/feature-flags", label: "Feature flags" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { ready } = useRequireAuth(["admin"]);
  const router = useRouter();
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);

  if (!ready) return <div className="min-h-screen bg-owner-bg" />;

  return (
    <div className="min-h-screen bg-owner-bg text-owner-ink">
      <header className="flex items-center justify-between px-4 sm:px-8 py-5 bg-owner-surface border-b border-owner-border">
        <div className="flex items-center gap-3">
          <Logo tone="owner" size={34} />
          <div>
            <span className="font-bold text-owner-accent">Admin</span>
            <p className="text-xs text-owner-ink-faint">{user?.name ?? "Admin"}</p>
          </div>
        </div>
        <button
          onClick={() => { useAuthStore.getState().signOut(); router.push("/"); }}
          className="px-3.5 py-2 rounded-lg text-sm font-semibold border border-owner-border"
        >
          Log out
        </button>
      </header>
      <nav className="flex gap-1 px-4 sm:px-8 bg-owner-surface border-b border-owner-border">
        {NAV.map((item) => {
          const active = pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className="px-3 py-3 text-sm font-semibold border-b-2 -mb-px"
              style={{
                borderColor: active ? "#0E6274" : "transparent",
                color: active ? "#0E6274" : "#5B7079",
              }}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
