/** fix/nov-7: Ledger, Bank check, Dues and Refunds are tabs of ONE "Paisa" page; their old URLs land on the right tab and
 * keep any other query (e.g. the Overview's ?date= filter on refunds). Pure, unit-tested in paisa-redirect.test.ts. */
export type PaisaTab = "hisaab" | "bank" | "baqi" | "wapas";

export const PAISA_PATH = "/dashboard/owner/paisa";

export function paisaHref(tab: PaisaTab, query: Record<string, string | string[] | undefined> = {}): string {
  const usp = new URLSearchParams();
  if (tab !== "hisaab") usp.set("tab", tab);
  for (const [k, v] of Object.entries(query)) {
    if (k === "tab" || v === undefined) continue;
    for (const one of Array.isArray(v) ? v : [v]) usp.append(k, one);
  }
  const qs = usp.toString();
  return qs ? `${PAISA_PATH}?${qs}` : PAISA_PATH;
}

export function parsePaisaTab(value: string | null | undefined): PaisaTab {
  return value === "bank" || value === "baqi" || value === "wapas" ? value : "hisaab";
}
