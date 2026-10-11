import type { ReactNode } from "react";
import { Eyebrow } from "@/components/site/primitives";

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
export function ChatMockup() {
  return (
    <div className="min-w-0 flex-[1_1_380px] rounded-[32px] bg-khelo-ink p-[30px]">
      <div className="flex flex-col gap-3 text-[15px] text-white">
        <div className={`${BUBBLE_ME} max-w-[80%]`}>Sunday 9 baje padel court chahiye</div>
        <div className={BUBBLE_AI}>Court 2 free hai, 9:00 PM. Booking start karun?</div>
        <div className={BUBBLE_ME}>Haan karo</div>
        <div className={BUBBLE_AI}>Slot hold ho gaya. Payment ka screenshot yahan bhej dein.</div>
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
const SLOT_LABEL: Record<SlotState, string> = { free: "free", booked: "booked", mine: "your slot" };

/** Static calendar illustration. */
export function CalendarMockup() {
  return (
    <div className="min-w-0 flex-[1_1_380px] rounded-[32px] bg-white p-[30px]">
      <div className="text-[18px] font-extrabold">Court A · Futsal</div>
      <ul className="m-0 mt-4 grid list-none grid-cols-4 gap-2 p-0">
        {SLOTS.map((c) => (
          <li key={c.t} className={`rounded-xl border-[1.5px] py-3.5 text-center text-[13px] font-bold ${SLOT_STYLE[c.s]}`}>
            {c.t}
            <span className="sr-only">, {SLOT_LABEL[c.s]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const PAYMENT_STATES: { dot: string; title: string; sub: string }[] = [
  { dot: "bg-khelo-warning", title: "Payment received", sub: "Owner ke approval ka intezar" },
  { dot: "bg-khelo-success", title: "Booking confirmed", sub: "Player ko notification mil gayi" },
  { dot: "bg-khelo-danger", title: "Payment verify nahi hui", sub: "Slot dobara sab ke liye khali" },
];

/** Static payment-state illustration. */
export function PaymentStates() {
  return (
    <ul className="m-0 flex min-w-0 flex-[1_1_380px] list-none flex-col gap-3.5 p-0">
      {PAYMENT_STATES.map((p) => (
        <li key={p.title} className="flex items-center gap-4 rounded-[22px] bg-white p-[22px]">
          <span aria-hidden="true" className={`h-3.5 w-3.5 flex-none rounded-full ${p.dot}`} />
          <div>
            <div className="font-extrabold">{p.title}</div>
            <div className="text-[14px] text-khelo-muted-2">{p.sub}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

const SMALL_FEATURES: { title: string; body: string }[] = [
  { title: "Smart filters", body: "Area, sport, price aur time se court dhoondo." },
  { title: "Favorites", body: "Pasandida venues save karo, dobara ek tap mein." },
  { title: "Reviews aur ratings", body: "Khelne ke baad rate karo, agle player ki madad karo." },
  { title: "Cancel aur refund", body: "Har court ki apni cancellation policy, pehle se saaf likhi hui." },
  { title: "Slot alerts", body: "Slot khali ho to foran khabar." },
  { title: "Security", body: "Password, WhatsApp OTP aur mehfooz sessions." },
];

export function SmallFeatures() {
  return (
    <section aria-labelledby="more-features" className="mx-auto w-full max-w-[1248px] px-6 pt-24">
      <h2 id="more-features" className="font-khelo-display text-[32px] font-extrabold leading-[1.05] tracking-[-1.3px] md:text-[44px]">
        Aur bhi bohat kuch
      </h2>
      <ul className="m-0 mt-9 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-5 p-0">
        {SMALL_FEATURES.map((f) => (
          <li key={f.title} className="khelo-card rounded-3xl bg-white p-7">
            <h3 className="text-[20px] font-extrabold">{f.title}</h3>
            <p className="mt-2 leading-[1.6] text-khelo-muted">{f.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
