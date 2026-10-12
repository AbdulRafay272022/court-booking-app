import type { MessageKey } from "@/lib/i18n";

/** The four "Humare usool" cards on /about (dictionary keys). */
export const VALUES: ReadonlyArray<{ title: MessageKey; body: MessageKey }> = [
  { title: "about.values.honest.title", body: "about.values.honest.body" },
  { title: "about.values.simple.title", body: "about.values.simple.body" },
  { title: "about.values.owners.title", body: "about.values.owners.body" },
  { title: "about.values.safe.title", body: "about.values.safe.body" },
];
