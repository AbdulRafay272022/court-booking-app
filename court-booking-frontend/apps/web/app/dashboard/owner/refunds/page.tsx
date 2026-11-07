import { redirect } from "next/navigation";
import { paisaHref } from "@/lib/paisa-redirect";

/** fix/nov-7: this page is now the "wapas" tab of the Paisa page; old links and bookmarks land there. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(paisaHref("wapas", await searchParams));
}
