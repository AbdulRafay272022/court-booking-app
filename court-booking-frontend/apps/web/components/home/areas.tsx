import Link from "next/link";
import { Eyebrow, SectionTitle } from "@/components/site/primitives";
import { getT } from "@/lib/i18n-server";

/** Real areas that have at least one approved venue. The caller hides this section when there are none. */
export async function Areas({ areas }: { areas: string[] }) {
  const t = await getT();
  return (
    <section aria-labelledby="areas-title" className="mx-auto w-full max-w-[1248px] px-6 pb-6 pt-[88px]">
      <Eyebrow>{t("home.areas.eyebrow")}</Eyebrow>
      <SectionTitle id="areas-title" className="mt-3">{t("home.areas.title")}</SectionTitle>
      <p className="mt-3.5 max-w-[560px] text-[17px] leading-[1.6] text-khelo-muted">{t("home.areas.sub")}</p>
      <ul className="m-0 mt-8 flex list-none flex-wrap gap-3 p-0">
        {areas.map((area, i) => (
          <li key={area}>
            <Link
              href={`/search?area=${encodeURIComponent(area)}`}
              className={`khelo-btn inline-flex min-h-11 items-center rounded-full px-[26px] py-4 font-bold ${i === 0 ? "bg-khelo-ink text-white" : "border-[1.5px] border-khelo-border bg-khelo-surface"}`}
            >
              {area}
            </Link>
          </li>
        ))}
        <li>
          <span className="inline-flex min-h-11 items-center rounded-full border-[1.5px] border-dashed border-khelo-dash px-[26px] py-4 font-bold text-khelo-muted-2">{t("home.areas.more")}</span>
        </li>
      </ul>
    </section>
  );
}
