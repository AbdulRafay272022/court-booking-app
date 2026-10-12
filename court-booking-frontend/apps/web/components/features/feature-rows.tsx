import type { ReactNode } from "react";
import { Eyebrow } from "@/components/site/primitives";
import { getT } from "@/lib/i18n-server";
import type { MessageKey } from "@/lib/i18n";

/** Row headline (44px display on desktop, smaller on phones). */
export function RowTitle({ children }: { children: ReactNode }) {
  return <h2 className="mt-3 font-khelo-display text-[32px] font-extrabold leading-[1.05] tracking-[-1.3px] md:text-[44px]">{children}</h2>;
}

/** One feature row: copy on one side, a static illustration on the other. `reverse` puts the illustration first (wrapped rows put it first on phones too, as designed). */
export function FeatureRow({ eyebrow, title, body, reverse = false, children }: { eyebrow: string; title: string; body: string; reverse?: boolean; children: ReactNode }) {
  const copy = (
    <div className="min-w-0 flex-[1_1_380px]">
      <Eyebrow>{eyebrow}</Eyebrow>
      <RowTitle>{title}</RowTitle>
      <p className="mt-[18px] text-[17px] leading-[1.7] text-khelo-muted">{body}</p>
    </div>
  );
  return (
    <section className={`mx-auto flex w-full max-w-[1248px] items-center gap-14 px-6 pt-[88px] ${reverse ? "flex-wrap-reverse" : "flex-wrap"}`}>
      {reverse ? (
        <>
          {children}
          {copy}
        </>
      ) : (
        <>
          {copy}
          {children}
        </>
      )}
    </section>
  );
}

const BUBBLE_ME = "self-end rounded-[20px_20px_4px_20px] bg-khelo-orange px-[18px] py-3 font-semibold text-khelo-ink";
const BUBBLE_AI = "max-w-[80%] self-start rounded-[20px_20px_20px_4px] bg-white/10 px-[18px] py-3";

/** Static chat illustration (not a live chat). */
export async function ChatMockup() {
  const t = await getT();
  return (
    <div className="min-w-0 flex-[1_1_380px] rounded-[32px] bg-khelo-ink p-[30px]">
      <div className="flex flex-col gap-3 text-[15px] text-white">
        <div className={`${BUBBLE_ME} max-w-[80%]`}>{t("features.chat.m1")}</div>
        <div className={BUBBLE_AI}>{t("features.chat.m2")}</div>
        <div className={BUBBLE_ME}>{t("features.chat.m3")}</div>
        <div className={BUBBLE_AI}>{t("features.chat.m4")}</div>
      </div>
    </div>
  );
}

type SlotState = "free" | "booked" | "mine";
const SLOTS: { t: string; s: SlotState }[] = [
  { t: "5 PM", s: "free" },
  { t: "6 PM", s: "booked" },
  { t: "7 PM", s: "booked" },
  { t: "8 PM", s: "mine" },
  { t: "9 PM", s: "free" },
  { t: "10 PM", s: "booked" },
  { t: "11 PM", s: "free" },
  { t: "12 AM", s: "free" },
];
const SLOT_STYLE: Record<SlotState, string> = {
  free: "border-khelo-border bg-khelo-page text-khelo-ink",
  booked: "border-khelo-booked-bg bg-khelo-booked-bg text-khelo-booked-text",
  mine: "border-khelo-orange bg-khelo-orange text-khelo-ink",
};
const SLOT_LABEL: Record<SlotState, MessageKey> = { free: "features.cal.free", booked: "features.cal.booked", mine: "features.cal.mine" };

/** Static calendar illustration. */
export async function CalendarMockup() {
  const t = await getT();
  return (
    <div className="min-w-0 flex-[1_1_380px] rounded-[32px] bg-white p-[30px]">
      <div className="text-[18px] font-extrabold">{t("features.cal.court")}</div>
      <ul className="m-0 mt-4 grid list-none grid-cols-4 gap-2 p-0">
        {SLOTS.map((c) => (
          <li key={c.t} className={`rounded-xl border-[1.5px] py-3.5 text-center text-[13px] font-bold ${SLOT_STYLE[c.s]}`}>
            {c.t}
            <span className="sr-only">, {t(SLOT_LABEL[c.s])}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const PAYMENT_STATES: { dot: string; title: MessageKey; sub: MessageKey }[] = [
  { dot: "bg-khelo-warning", title: "features.pay.s1.title", sub: "features.pay.s1.sub" },
  { dot: "bg-khelo-success", title: "features.pay.s2.title", sub: "features.pay.s2.sub" },
  { dot: "bg-khelo-danger", title: "features.pay.s3.title", sub: "features.pay.s3.sub" },
];

/** Static payment-state illustration. */
export async function PaymentStates() {
  const t = await getT();
  return (
    <ul className="m-0 flex min-w-0 flex-[1_1_380px] list-none flex-col gap-3.5 p-0">
      {PAYMENT_STATES.map((p) => (
        <li key={p.title} className="flex items-center gap-4 rounded-[22px] bg-white p-[22px]">
          <span aria-hidden="true" className={`h-3.5 w-3.5 flex-none rounded-full ${p.dot}`} />
          <div>
            <div className="font-extrabold">{t(p.title)}</div>
            <div className="text-[14px] text-khelo-muted-2">{t(p.sub)}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

const SMALL_FEATURES: { title: MessageKey; body: MessageKey }[] = [
  { title: "features.more.filters.title", body: "features.more.filters.body" },
  { title: "features.more.favorites.title", body: "features.more.favorites.body" },
  { title: "features.more.reviews.title", body: "features.more.reviews.body" },
  { title: "features.more.cancel.title", body: "features.more.cancel.body" },
  { title: "features.more.alerts.title", body: "features.more.alerts.body" },
  { title: "features.more.security.title", body: "features.more.security.body" },
];

export async function SmallFeatures() {
  const t = await getT();
  return (
    <section aria-labelledby="more-features" className="mx-auto w-full max-w-[1248px] px-6 pt-24">
      <h2 id="more-features" className="font-khelo-display text-[32px] font-extrabold leading-[1.05] tracking-[-1.3px] md:text-[44px]">
        {t("features.more.title")}
      </h2>
      <ul className="m-0 mt-9 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-5 p-0">
        {SMALL_FEATURES.map((f) => (
          <li key={f.title} className="khelo-card rounded-3xl bg-white p-7">
            <h3 className="text-[20px] font-extrabold">{t(f.title)}</h3>
            <p className="mt-2 leading-[1.6] text-khelo-muted">{t(f.body)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
