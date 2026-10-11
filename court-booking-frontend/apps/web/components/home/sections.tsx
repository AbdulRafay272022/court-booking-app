import type { ReactNode } from "react";
import { Button } from "@/components/site/button";
import { Badge, Container, Eyebrow, FaqItem, SectionTitle } from "@/components/site/primitives";

const WRAP = "mx-auto w-full max-w-[1248px] px-6 pb-6 pt-[88px]";

/* ---------- How it works ---------- */

const STEPS = [
  { n: "01", title: "Court chuno", body: "Area, sport, price aur time ke filter lagao. Poora calendar ek nazar mein." },
  { n: "02", title: "Slot par tap karo", body: "Khelo AI poochega “book karun?”. Haan kaho, slot hold ho jayega." },
  { n: "03", title: "Pay karo, khelo", body: "Payment ka screenshot chat mein bhejo. Owner approve kare, booking confirm." },
];

export function HowItWorks() {
  return (
    <section id="how" aria-labelledby="how-title" className={WRAP}>
      <Eyebrow>SIMPLE PROCESS</Eyebrow>
      <SectionTitle id="how-title" className="mt-3">Teen step. Bas.</SectionTitle>
      <ol className="m-0 mt-10 grid list-none grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-5 p-0">
        {STEPS.map((s) => (
          <li key={s.n} className="khelo-card rounded-3xl bg-khelo-surface p-[30px]">
            <div aria-hidden="true" className="font-khelo-display text-[64px] font-extrabold leading-none text-khelo-orange-text">{s.n}</div>
            <h3 className="mt-4 text-[22px] font-extrabold">{s.title}</h3>
            <p className="mt-2.5 leading-[1.6] text-khelo-muted">{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ---------- Features ---------- */

function Icon({ children, stroke = "var(--color-khelo-teal)" }: { children: ReactNode; stroke?: string }) {
  return (
    <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

function FeatureCard({ icon, title, body, tone = "light" }: { icon: ReactNode; title: string; body: string; tone?: "light" | "orange" }) {
  return (
    <div className={`khelo-card rounded-[28px] p-8 ${tone === "orange" ? "bg-khelo-orange" : "bg-khelo-surface"}`}>
      {icon}
      <h3 className="mt-[18px] text-2xl font-extrabold">{title}</h3>
      <p className={`mt-2 leading-[1.6] ${tone === "orange" ? "text-khelo-ink opacity-[.82]" : "text-khelo-muted"}`}>{body}</p>
    </div>
  );
}

export function Features() {
  return (
    <section id="features" aria-labelledby="features-title" className={WRAP}>
      <Eyebrow>FEATURES</Eyebrow>
      <SectionTitle id="features-title" className="mt-3 max-w-[720px]">Booking ko banaya hai asaan, tez aur saaf</SectionTitle>
      <div className="mt-10 grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-5">
        <div className="khelo-card rounded-[28px] bg-khelo-ink p-8 text-white">
          <h3 className="text-2xl font-extrabold">Chat se booking</h3>
          <p className="mb-[22px] mt-2 leading-[1.6] text-white/[.72]">App ya WhatsApp, jahan comfortable ho wahan baat karo.</p>
          <div className="flex flex-col gap-2.5 text-[14px]">
            <div className="max-w-[85%] self-end rounded-[18px_18px_4px_18px] bg-khelo-orange px-4 py-[11px] font-semibold text-khelo-ink">Kal raat 8 baje futsal DHA?</div>
            <div className="max-w-[85%] self-start rounded-[18px_18px_18px_4px] bg-white/10 px-4 py-[11px]">Slot available hai. Booking start karun?</div>
            <div className="self-end rounded-[18px_18px_4px_18px] bg-khelo-orange px-4 py-[11px] font-semibold text-khelo-ink">Haan</div>
          </div>
        </div>
        <FeatureCard
          icon={<Icon><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></Icon>}
          title="Live slot calendar"
          body="Booked aur available slots foran nazar aate hain. Double booking ka sawal hi nahi."
        />
        <FeatureCard
          icon={<Icon><rect x="3" y="6" width="18" height="13" rx="3" /><path d="M3 10h18M7 15h4" /></Icon>}
          title="Screenshot se payment"
          body="Apne bank app se pay karo, proof chat mein bhejo. Approve hote hi notification."
        />
        <FeatureCard
          tone="orange"
          icon={<Icon stroke="var(--color-khelo-ink)"><path d="M12 21s-7-4.500-9-9.200C1.700 8 4 5 7 5c2 0 3.500 1 5 3 1.500-2 3-3 5-3 3 0 5.300 3 4 6.800-2 4.700-9 9.200-9 9.200z" /></Icon>}
          title="Favorite venues"
          body="Pasandida courts save karo aur dobara booking ek tap par."
        />
        <FeatureCard
          icon={<Icon><path d="M12 3l2.800 5.700 6.200.9-4.500 4.400 1.100 6.200L12 17.200 6.400 20.200l1.100-6.200L3 9.600l6.200-.9z" /></Icon>}
          title="Reviews aur ratings"
          body="Asli players ke reviews dekh kar sahi court ka intikhab."
        />
        <FeatureCard
          icon={<Icon><path d="M6 9a6 6 0 0112 0c0 6 2.500 7 2.500 7h-17S6 15 6 9zM10 20a2 2 0 004 0" /></Icon>}
          title="Slot khali hote hi alert"
          body="Booking cancel ho to jo slot chahiye tha uski notification foran."
        />
      </div>
    </section>
  );
}

/* ---------- Owners ---------- */

const OWNER_POINTS = [
  "Venue minutes mein setup, admin approval ke baad live",
  "Payment proof ek tap par approve ya reject",
  "Peak aur off-peak pricing, har court ki apni policy",
];
const BARS: { h: number; on: boolean }[] = [
  { h: 40, on: false }, { h: 55, on: false }, { h: 35, on: false }, { h: 70, on: false }, { h: 100, on: true }, { h: 85, on: true }, { h: 60, on: false },
];

export function Owners() {
  return (
    <section id="owners" aria-labelledby="owners-title" className="mt-[88px] bg-khelo-teal text-white">
      <Container className="flex flex-wrap items-center gap-14 py-[88px]">
        <div className="min-w-0 flex-[1_1_420px]">
          <div className="text-[13px] font-extrabold uppercase tracking-[1.5px] text-khelo-mint-text">FOR VENUE OWNERS</div>
          <h2 id="owners-title" className="mt-3 font-khelo-display text-[36px] font-extrabold leading-[1.03] tracking-[-1.5px] min-[761px]:text-[52px]">Apna court list karo. Khali slots bharo.</h2>
          <p className="mt-[22px] max-w-[520px] text-[18px] leading-[1.65] text-white/[.88]">
            Ek dashboard mein saari bookings, payments aur revenue. Khelo dekhta hai kaun se slots nahi bik rahe aur discount lagane ka mashwara deta hai.
          </p>
          <ul className="m-0 mt-7 flex list-none flex-col gap-3.5 p-0 text-[16px] font-semibold">
            {OWNER_POINTS.map((p) => (
              <li key={p} className="flex items-center gap-3">
                <span aria-hidden="true" className="inline-flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full bg-khelo-orange">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-khelo-ink)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-10" /></svg>
                </span>
                {p}
              </li>
            ))}
          </ul>
          <Button href="/for-owners" size="lg" className="mt-[34px]">List your venue</Button>
        </div>

        <div className="min-w-0 flex-[1_1_380px]">
          <div className="rounded-[28px] bg-khelo-surface p-[26px] text-khelo-ink shadow-[0_30px_60px_rgba(0,0,0,.25)]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-khelo-display text-[22px] font-extrabold">Owner dashboard</div>
              <Badge tone="mint" className="px-2.5 py-[5px] text-[11px] !font-bold">Sample data</Badge>
            </div>
            <div className="mt-[18px] grid grid-cols-3 gap-2.5">
              {[
                { l: "Aaj", v: "12", c: "" },
                { l: "Is hafte", v: "67", c: "" },
                { l: "Pending", v: "3", c: "text-khelo-orange-text" },
              ].map((s) => (
                <div key={s.l} className="rounded-2xl bg-khelo-page p-3.5">
                  <div className="text-[11px] font-semibold text-khelo-muted-2">{s.l}</div>
                  <div className={`text-2xl font-extrabold ${s.c}`}>{s.v}</div>
                </div>
              ))}
            </div>
            <div aria-hidden="true" className="mt-3.5 flex h-[90px] items-end gap-2 px-1">
              {BARS.map((b, i) => (
                <div key={i} style={{ height: `${b.h}%` }} className={`flex-1 rounded-lg ${b.on ? "bg-khelo-teal" : "bg-khelo-chart"}`} />
              ))}
            </div>
            <div className="mt-[18px] rounded-[18px] border-[1.5px] border-khelo-orange bg-khelo-warm-2 p-4">
              <div className="text-[12px] font-extrabold tracking-[.5px] text-khelo-orange-label">GROWTH TIP</div>
              <div className="mt-1.5 font-bold leading-[1.5]">Mangal 2–4 PM ke slots kam book ho rahe hain. 15% discount lagayein?</div>
              <div aria-hidden="true" className="mt-3 flex gap-2">
                <span className="rounded-[10px] bg-khelo-ink px-4 py-2.5 text-[13px] font-bold text-white">Apply discount</span>
                <span className="rounded-[10px] border-[1.5px] border-khelo-ink px-4 py-2.5 text-[13px] font-bold">Later</span>
              </div>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}

/* ---------- FAQ ---------- */

const FAQS = [
  { q: "Booking kaise hoti hai?", a: "Court chuno, slot par tap karo, aur Khelo AI se chat mein confirm karo. Phir payment ka screenshot bhejo. Owner approve karta hai to booking confirm ho jati hai." },
  { q: "Kya WhatsApp se bhi booking ho sakti hai?", a: "Haan. App aur WhatsApp dono mein wahi AI assistant hai, aur dono jagah booking ka process ek jaisa hai." },
  { q: "Payment reject ho jaye to?", a: "Agar owner payment verify na kare to slot dobara khali ho jata hai aur aapko notification milti hai." },
  { q: "Main apna venue kaise list karun?", a: "Owner account banao, venue ki details, courts aur pricing bharo. Admin approval ke baad aapka venue live ho jata hai." },
];

export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="mx-auto w-full max-w-[908px] px-6 pb-6 pt-[88px]">
      <Eyebrow>FAQ</Eyebrow>
      <SectionTitle id="faq-title" className="mt-3">Aam sawal</SectionTitle>
      <div className="mt-8 flex flex-col gap-3">
        {FAQS.map((f, i) => (
          <FaqItem key={f.q} question={f.q} defaultOpen={i === 0}>
            <p className="m-0">{f.a}</p>
          </FaqItem>
        ))}
      </div>
    </section>
  );
}

/* ---------- Final CTA ---------- */

export function FinalCta() {
  return (
    <section id="cta" aria-labelledby="cta-title" className="mx-auto w-full max-w-[1248px] px-6 py-[88px]">
      <div className="rounded-[36px] bg-khelo-orange px-6 py-14 text-center text-khelo-ink min-[761px]:px-10 min-[761px]:py-16">
        <h2 id="cta-title" className="m-0 font-khelo-display text-[38px] font-extrabold leading-none tracking-[-1.5px] min-[761px]:text-[60px] min-[761px]:tracking-[-2px]">Agla match, ek tap door.</h2>
        <p className="mx-auto mt-[18px] max-w-[520px] text-[18px] leading-[1.6] opacity-85">Khelo par account banao aur apne area ka pehla court book karo.</p>
        <div className="mt-[30px] flex flex-wrap justify-center gap-3.5">
          <Button href="/signup" variant="dark" size="lg" className="px-8">Sign up free</Button>
          <Button href="/for-owners" variant="outlineDark" size="lg" className="border-2 px-8 font-extrabold">List your venue</Button>
        </div>
      </div>
    </section>
  );
}
