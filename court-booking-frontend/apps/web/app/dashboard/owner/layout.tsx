"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRequireAuth } from "@/lib/use-require-auth";
import { useAuthStore } from "@/lib/auth-store";
import { SUPPORT_WHATSAPP_NUMBER, supportWhatsAppUrl } from "@/lib/support";

const NAV = [
  { href: "/dashboard/owner/today", label: "Today" },
  { href: "/dashboard/owner/approvals", label: "Approvals" },
  { href: "/dashboard/owner/walkin", label: "Add booking" },
  { href: "/dashboard/owner/ledger", label: "Ledger" },
  { href: "/dashboard/owner/growth", label: "Growth" },
];

export default function OwnerDashboardLayout({ children }: { children: React.ReactNode }) {
  const { ready } = useRequireAuth(["owner"]);
  const pathname = usePathname();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  if (!ready) return <div className="min-h-screen bg-owner-bg" />;

  return (
    <div className="min-h-screen flex bg-owner-bg text-owner-ink">
      <aside className="w-60 shrink-0 bg-owner-surface border-r border-owner-border flex flex-col">
        <div className="px-6 py-6">
          <span className="font-bold text-lg text-owner-accent">Maidan</span>
          <p className="text-xs text-owner-ink-faint mt-0.5">{user?.name ?? "Owner"}</p>
        </div>
        <nav className="flex flex-col gap-1 px-3">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="px-3.5 py-2.5 rounded-lg text-[14px] font-semibold"
              style={{
                background: pathname === item.href ? "#EBF2F4" : "transparent",
                color: pathname === item.href ? "#0E6274" : "#5B7079",
              }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto p-3 flex flex-col gap-2">
          <a
            href={supportWhatsAppUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full px-3.5 py-2.5 rounded-lg text-[14px] font-semibold text-owner-ink-muted border border-owner-border text-center"
          >
            Need help? WhatsApp us at {SUPPORT_WHATSAPP_NUMBER}
          </a>
          <button
            onClick={() => {
              useAuthStore.getState().signOut();
              router.push("/");
            }}
            className="w-full px-3.5 py-2.5 rounded-lg text-[14px] font-semibold text-owner-ink-muted border border-owner-border"
          >
            Log out
          </button>
        </div>
      </aside>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
