import Link from "next/link";
import type { Metadata } from "next";
import { NavAuth } from "@/components/nav-auth";
import { Logo } from "@/components/auth/logo";

export const metadata: Metadata = {
  title: "Padel & Futsal Court Booking in Karachi",
  description:
    "Maidan is a free operations tool for court venues and a real-time booking marketplace for players in DHA and Clifton, Karachi.",
};

function NavBar() {
  return (
    <header className="flex items-center gap-8 px-6 md:px-14 py-5 bg-player-surface border-b border-player-border-light">
      <Link href="/" aria-label="Maidan home">
        <Logo size={40} />
      </Link>
      <nav className="hidden md:flex gap-7 flex-1 text-[14.5px] font-semibold text-player-ink-muted">
        <Link href="/signup?role=owner">For venues</Link>
        <Link href="/search">Find a court</Link>
      </nav>
      <div className="flex-1 md:flex-none" />
      <NavAuth />
    </header>
  );
}

export default function LandingPage() {
  return (
    <div>
      <NavBar />

      <section className="grid md:grid-cols-2 gap-12 px-6 md:px-14 py-16 md:py-20 bg-player-surface items-center">
        <div className="flex flex-col gap-6">
          <span className="self-start px-3.5 py-1.5 rounded-full bg-player-accent-soft border border-player-accent-soft-border text-[12.5px] font-bold text-player-accent-hover">
            FREE FOR VENUES IN KARACHI
          </span>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight leading-[1.05] text-balance">
            Run your courts without the notebook
          </h1>
          <p className="text-lg text-player-ink-muted leading-relaxed max-w-prose">
            Every booking in one place — the ones from this app, the ones from WhatsApp, and the walk-ins you write
            down by hand. Approve payments with one tap instead of squinting at screenshots.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/signup?role=owner" className="px-7 py-4 rounded-2xl bg-player-accent text-white font-bold">
              List your venue free
            </Link>
            <Link href="/search" className="px-6 py-4 rounded-2xl border border-player-border font-semibold">
              Find a court instead
            </Link>
          </div>
        </div>

        <div className="bg-player-ink rounded-3xl p-7 flex flex-col gap-4 text-white">
          <div className="flex items-center justify-between">
            <span className="text-[11.5px] font-bold tracking-widest text-white/50">TODAY · COURT 1</span>
            <span className="font-mono text-[13px] font-semibold text-player-success">14 / 24 booked</span>
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3 px-4 py-3.5 bg-white/5 rounded-xl">
              <span className="font-mono text-sm font-semibold">16:00</span>
              <span className="flex-1 text-sm text-white/70">Hamza Sheikh</span>
              <span className="px-2.5 py-1 rounded-md bg-player-success/20 text-player-success text-[11.5px] font-bold">PAID</span>
            </div>
            <div className="flex items-center gap-3 px-4 py-3.5 bg-player-warn/10 border border-player-warn/30 rounded-xl">
              <span className="font-mono text-sm font-semibold text-player-warn">18:00</span>
              <span className="flex-1 text-sm text-white/70">Bilal Ahmed</span>
              <span className="px-2.5 py-1 rounded-md bg-player-warn text-black text-[11.5px] font-bold">Approve</span>
            </div>
          </div>
          <div className="flex items-center gap-2.5 px-4 py-3.5 bg-player-success/15 rounded-xl">
            <span className="text-player-success text-sm font-semibold">✓ We read the screenshot — amount matches</span>
          </div>
        </div>
      </section>

      <section className="px-6 md:px-14 py-16 flex flex-col gap-9">
        <div className="flex flex-col gap-3 max-w-prose">
          <span className="text-xs font-bold tracking-widest text-player-accent">WHY VENUES SWITCH</span>
          <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight">Built around how you already work</h2>
        </div>
        <div className="grid md:grid-cols-3 gap-5">
          {[
            { title: "Walk-ins still count", body: "Someone rings, someone turns up at the gate — add them in two taps and the slot closes everywhere at once." },
            { title: "Screenshots read themselves", body: "We pull out the amount and reference number and check them against what's owed — approving is a glance and a tap." },
            { title: "WhatsApp keeps working", body: "Your customers can keep booking on WhatsApp exactly as they do now. It lands in the same place as everything else." },
          ].map((c) => (
            <div key={c.title} className="bg-player-surface border border-player-border-light rounded-2xl p-7 flex flex-col gap-3">
              <h3 className="text-lg font-bold">{c.title}</h3>
              <p className="text-[15px] text-player-ink-muted leading-relaxed">{c.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-6 md:mx-14 mb-16 bg-player-ink rounded-3xl p-10 md:p-14 flex flex-col gap-4 text-white">
        <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight">Free while we're building this with you</h2>
        <p className="text-white/70 leading-relaxed max-w-prose">
          We're starting with a small number of venues in DHA and Clifton, and setting each one up in person. Early
          venues keep the Pro plan free permanently.
        </p>
        <div className="flex gap-3 pt-2">
          <Link href="/signup?role=owner" className="px-7 py-3.5 rounded-2xl bg-player-accent text-white font-bold">
            List your venue
          </Link>
        </div>
      </section>
    </div>
  );
}
