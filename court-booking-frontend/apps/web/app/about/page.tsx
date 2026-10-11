import type { Metadata } from "next";
import { KheloPage } from "@/components/site/page-shell";
import { Container, Eyebrow, SectionTitle } from "@/components/site/primitives";
import { Button } from "@/components/site/button";
import { VALUES } from "@/components/about/about-content";

const DESCRIPTION =
  "Khelo is a court booking marketplace starting in Karachi. Players find open slots instantly and venue owners never leave a court empty. Built by Logic Link System.";

export const metadata: Metadata = {
  title: "About",
  description: DESCRIPTION,
  openGraph: { title: "About · Khelo", description: DESCRIPTION, type: "website" },
};

export default function AboutPage() {
  return (
    <KheloPage>
      {/* HERO */}
      <section className="bg-khelo-ink text-white">
        <Container className="pb-[72px] pt-12 md:pb-24">
          <Eyebrow tone="orange">About Khelo</Eyebrow>
          <h1 className="mt-4 max-w-[900px] font-khelo-display text-[40px] font-extrabold leading-none tracking-[-1.4px] md:text-[68px] md:tracking-[-2.2px]">
            Khelna asaan hona chahiye. Court dhoondna nahi.
          </h1>
          <p className="mt-6 max-w-[640px] text-[17px] leading-[1.65] text-white/80 md:text-[19px]">
            Khelo ek court booking marketplace hai jo Karachi se shuru ho raha hai. Humara maqsad hai ke players ko khali slot foran milay aur venue
            owners ka court kabhi khali na rahe.
          </p>
        </Container>
      </section>

      {/* PROBLEM / SOLUTION */}
      <Container className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-6 pt-[88px]">
        <div className="rounded-[28px] bg-khelo-surface p-7 md:p-9">
          <div className="text-[13px] font-extrabold uppercase tracking-[1.5px] text-khelo-orange-label">Masla</div>
          <h2 className="mt-3 font-khelo-display text-[30px] font-extrabold leading-[1.1] tracking-[-1px] md:text-[34px]">Calls, messages aur intezar</h2>
          <p className="mt-3.5 leading-[1.7] text-khelo-muted">
            Slot poochne ke liye kai logon ko message karna parta hai. Owners ke paas bookings kahin copy mein, kahin WhatsApp mein hoti hain, aur
            khali slots ka pata nahi chalta.
          </p>
        </div>
        <div className="rounded-[28px] bg-khelo-teal p-7 text-white md:p-9">
          <div className="text-[13px] font-extrabold uppercase tracking-[1.5px] text-[#BFF3EC]">Hal</div>
          <h2 className="mt-3 font-khelo-display text-[30px] font-extrabold leading-[1.1] tracking-[-1px] md:text-[34px]">Ek calendar, ek chat</h2>
          <p className="mt-3.5 leading-[1.7] text-white/90">
            Players live calendar dekh kar chat se book karte hain. Owners ek dashboard se payment approve karte hain aur khali slots ke liye mashwara
            lete hain.
          </p>
        </div>
      </Container>

      {/* VALUES */}
      <Container className="pt-24">
        <Eyebrow>Humare usool</Eyebrow>
        <SectionTitle className="mt-3">Jis par hum banate hain</SectionTitle>
        <ul className="mt-9 grid list-none grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-5 p-0">
          {VALUES.map((v) => (
            <li key={v.title} className="khelo-card rounded-[24px] bg-khelo-surface p-[30px]">
              <h3 className="text-[22px] font-extrabold">{v.title}</h3>
              <p className="mt-2.5 leading-[1.6] text-khelo-muted">{v.body}</p>
            </li>
          ))}
        </ul>
      </Container>

      {/* STORY / FOUNDER */}
      <Container className="flex flex-wrap items-stretch gap-10 pt-24">
        <div className="min-w-0 flex-[1_1_380px] rounded-[32px] bg-khelo-ink p-7 text-white md:p-11">
          <Eyebrow tone="orange">Humari kahani</Eyebrow>
          <h2 className="mt-3 font-khelo-display text-[32px] font-extrabold leading-[1.08] tracking-[-1.2px] md:text-[38px]">Karachi pilot se shuruaat</h2>
          <p className="mt-4 leading-[1.75] text-white/80">
            Khelo ka pehla safar Karachi ke futsal aur padel venues ke sath ho raha hai. Pilot se jo seekhenge, usi se agle shehar aur agle sports tay
            honge.
          </p>
        </div>
        <div className="min-w-0 flex-[1_1_380px] rounded-[32px] bg-khelo-surface p-7 md:p-11">
          <Eyebrow>Banane wala</Eyebrow>
          <div className="mt-5 flex items-center gap-[18px]">
            <div
              aria-hidden="true"
              className="flex h-[72px] w-[72px] flex-none items-center justify-center rounded-full bg-khelo-orange font-khelo-display text-[28px] font-extrabold text-khelo-ink"
            >
              AR
            </div>
            <div>
              <div className="text-[22px] font-extrabold">Abdul Rafay</div>
              <div className="text-[15px] text-khelo-muted-2">Founder, Logic Link System</div>
            </div>
          </div>
          <p className="mt-[22px] leading-[1.75] text-khelo-muted">Khelo, Logic Link System ka product hai, jo Pakistan mein registered software company hai.</p>
        </div>
      </Container>

      {/* CTA */}
      <Container className="py-24">
        <div className="rounded-[36px] bg-khelo-orange px-6 py-14 text-center md:px-10">
          <h2 className="font-khelo-display text-[38px] font-extrabold leading-none tracking-[-1.8px] text-khelo-ink md:text-[52px]">Hamare sath khelo.</h2>
          <div className="mt-7 flex flex-wrap justify-center gap-3.5">
            <Button href="/search" variant="dark" size="lg" className="px-8">
              Start playing
            </Button>
            <Button href="/contact" variant="outlineDark" size="lg" className="px-8 !border-2">
              Baat karo
            </Button>
          </div>
        </div>
      </Container>
    </KheloPage>
  );
}
