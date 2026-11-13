"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useFeatureFlags } from "@/lib/use-feature-flags";
import { useMyPermissions } from "@/lib/use-my-permissions";
import { useOwnerVenues } from "@/lib/use-owner-venues";
import { paisaHref, parsePaisaTab, type PaisaTab } from "@/lib/paisa-redirect";
import { HisaabTab } from "@/components/owner/paisa/hisaab-tab";
import { BankTab } from "@/components/owner/paisa/bank-tab";
import { DuesTab } from "@/components/owner/paisa/dues-tab";
import { RefundsTab } from "@/components/owner/paisa/refunds-tab";
import { PaisaV2Page } from "@/components/owner/paisa-v2/paisa-page";
import { useLedgerV2 } from "@/lib/use-paisa-v2";

const TABS: { key: PaisaTab; label: string }[] = [
  { key: "hisaab", label: "Hisaab" },
  { key: "bank", label: "Bank check" },
  { key: "baqi", label: "Lena baqi" },
  { key: "wapas", label: "Wapas dena" },
];

/** fix/nov-7: ONE owner "Paisa" page; Ledger (Hisaab), Bank check, Dues (Lena baqi) and Refunds (Wapas dena) are its tabs, kept
 * in `?tab=`. The old URLs redirect here (lib/paisa-redirect.ts). A staff member sees the tabs their permissions open. */
function PaisaPage() {
  const params = useSearchParams();
  const pathname = usePathname();
  const perms = useMyPermissions();
  const { isOn } = useFeatureFlags();
  const { activeVenueId } = useOwnerVenues();
  const badges = useQuery({ queryKey: ["owner-badges", activeVenueId], queryFn: () => api.owners.badges(activeVenueId), enabled: !!activeVenueId });
  const visible = TABS.filter((tab) => (tab.key === "wapas" ? isOn("refunds") && perms.can("mark_refunds") : perms.can("view_ledger")));
  const asked = parsePaisaTab(params.get("tab"));
  const current = visible.find((tab) => tab.key === asked)?.key ?? visible[0]?.key ?? asked;
  const keep = Object.fromEntries([...params.entries()].filter(([k]) => k !== "tab"));
  const refunds = badges.data?.refunds ?? 0;

  return (
    <div className="flex min-w-0 max-w-5xl flex-col gap-5 p-4 sm:p-8" data-testid="paisa-page">
      <h1 className="text-2xl font-bold">Paisa</h1>
      <nav role="tablist" aria-label="Paisa" className="flex flex-wrap gap-1 border-b border-owner-border">
        {visible.map((tab) => {
          const active = tab.key === current;
          return (
            <Link
              key={tab.key}
              role="tab"
              aria-selected={active}
              href={tab.key === current ? `${pathname}${params.toString() ? `?${params.toString()}` : ""}` : paisaHref(tab.key, tab.key === "wapas" ? keep : {})}
              replace
              scroll={false}
              data-testid={`paisa-tab-${tab.key}`}
              className={`-mb-px inline-flex min-h-11 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-[14.5px] font-semibold ${active ? "border-owner-accent text-owner-ink" : "border-transparent text-owner-ink-muted hover:text-owner-ink"}`}
            >
              {tab.label}
              {tab.key === "wapas" && refunds > 0 ? (
                <span className="rounded-full bg-owner-danger px-2 py-0.5 text-[11.5px] font-bold text-white">{refunds}</span>
              ) : null}
            </Link>
          );
        })}
      </nav>
      <div role="tabpanel">
        {current === "hisaab" ? <HisaabTab /> : current === "bank" ? <BankTab /> : current === "baqi" ? <DuesTab /> : <RefundsTab />}
      </div>
    </div>
  );
}

/** ledger v2 (flag ledger_v2, default OFF): the new four-tab page; flag off = the page above, unchanged. */
function PaisaSwitch() {
  const v2 = useLedgerV2();
  if (v2.loading) return null;
  return v2.on ? <PaisaV2Page /> : <PaisaPage />;
}

export default function PaisaRoute() {
  return (
    <Suspense fallback={null}>
      <PaisaSwitch />
    </Suspense>
  );
}
