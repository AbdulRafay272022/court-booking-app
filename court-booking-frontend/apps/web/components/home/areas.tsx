import Link from "next/link";
import { Eyebrow, SectionTitle } from "@/components/site/primitives";

/** Real areas that have at least one approved venue. The caller hides this section when there are none. */
export function Areas({ areas }: { areas: string[] }) {
  return (
    <section aria-labelledby="areas-title" className="mx-auto w-full max-w-[1200px] px-6 pb-6 pt-[88px]">
      <Eyebrow>LOCATIONS</Eyebrow>
      <SectionTitle id="areas-title" className="mt-3">Karachi se shuru</SectionTitle>
      <p className="mt-3.5 max-w-[560px] text-[17px] leading-[1.6] text-khelo-muted">Pilot ke pehle venues Karachi mein hain. Naye areas jaldi add honge.</p>
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
          <span className="inline-flex min-h-11 items-center rounded-full border-[1.5px] border-dashed border-[#B9C6C3] px-[26px] py-4 font-bold text-khelo-muted-2">Aur aa rahe hain</span>
        </li>
      </ul>
    </section>
  );
}
