"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { useT } from "@/components/i18n/lang-provider";
import { FALLBACK_SEARCH, LAST_SEARCH_KEY, asSearchPath, encodeLastSearch, resolveBackHref } from "@/lib/venue-nav";

const subscribeNever = () => () => {};

/** Called when a venue card on /search is opened: remembers the full Search URL (filters included) for that venue's "Back to results". */
export function rememberSearch(slug: string): void {
  try {
    const path = asSearchPath(window.location.pathname + window.location.search);
    if (path) window.sessionStorage.setItem(LAST_SEARCH_KEY, encodeLastSearch(slug, path));
  } catch {
    // sessionStorage unavailable (private mode, blocked): the link just falls back to the referrer or /search
  }
}

/**
 * "Back to results" on the venue page. Goes to the Search URL the visitor came from, with its filters (the URL is the only state
 * Search has), and to plain /search when the venue was opened directly. The server render and first paint use /search; the
 * remembered URL takes over right after hydration.
 */
export function BackToResults({ slug }: { slug: string }) {
  const t = useT();
  const href = useSyncExternalStore(
    subscribeNever,
    () => {
      let stored: string | null = null;
      try {
        stored = window.sessionStorage.getItem(LAST_SEARCH_KEY);
      } catch {
        stored = null;
      }
      return resolveBackHref({ stored, slug, referrer: document.referrer, origin: window.location.origin });
    },
    () => FALLBACK_SEARCH,
  );

  return (
    <Link
      href={href}
      data-testid="back-to-results"
      className="inline-flex min-h-11 items-center gap-1.5 rounded-full text-[14px] font-extrabold text-khelo-orange-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-khelo-orange"
    >
      <span aria-hidden="true">&larr;</span>
      {t("venue.back")}
    </Link>
  );
}
