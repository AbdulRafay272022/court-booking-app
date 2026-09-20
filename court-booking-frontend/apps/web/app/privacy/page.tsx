import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/nav-auth";
import { SUPPORT_WHATSAPP_NUMBER } from "@/lib/support";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What Maidan collects, why, and how it's protected.",
};

const LAST_UPDATED = "20 September 2026";

export default function PrivacyPage() {
  return (
    <>
      <SiteHeader />
      <main className="max-w-2xl mx-auto px-6 py-12 flex flex-col gap-8 text-player-ink">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-extrabold tracking-tight">Privacy Policy</h1>
          <p className="text-player-ink-faint text-sm">Last updated {LAST_UPDATED}</p>
        </div>

        <Section title="1. What we collect">
          <p>
            <strong className="text-player-ink">To create an account:</strong> your name, phone number, email
            address, city, and gender, plus a one-way hash of the password you set (we never store the password
            itself). Your phone number is verified by a one-time WhatsApp code.
          </p>
          <p>
            <strong className="text-player-ink">If you list a venue:</strong> the venue&apos;s name, address, GPS
            location, photos, sports and pricing, and — if you provide them — bank account or mobile-wallet
            (JazzCash/Easypaisa-style) details for players to pay into. Those payment details are encrypted before
            they&apos;re stored and are only ever decrypted back for you or a Maidan admin, never shown to other
            players or other venues.
          </p>
          <p>
            <strong className="text-player-ink">When you book and pay:</strong> the booking itself (court, time,
            price), and the payment screenshot you upload as proof of a bank/wallet transfer. That screenshot is
            processed automatically to read the amount and reference off it (see §3), stored privately, and only
            ever shown to that venue&apos;s own owner or a Maidan admin reviewing the payment — never to another
            player or venue.
          </p>
          <p>
            <strong className="text-player-ink">Messages:</strong> if you message the Maidan WhatsApp number or use
            in-app chat, we keep that conversation (including AI assistant replies) so it can be shown back to you and
            so a venue owner or admin can look into an issue you raise.
          </p>
          <p>
            <strong className="text-player-ink">Usage and device data:</strong> basic technical logs (request
            timestamps, error rates), and — if you enable it — a push-notification token for your device. Location is
            only ever requested from a player&apos;s device to power a &ldquo;courts near me&rdquo; search, and from an
            owner&apos;s device to pin a venue&apos;s exact location during setup; neither is collected in the background.
          </p>
        </Section>

        <Section title="2. Why we collect it">
          <ul className="list-disc pl-5 flex flex-col gap-1.5">
            <li>To create and secure your account, and to verify a phone number really belongs to you.</li>
            <li>To run the actual booking flow: showing availability, holding a slot, confirming payment.</li>
            <li>To verify a submitted payment proof matches what&apos;s owed, and to detect a proof reused from an earlier submission.</li>
            <li>To send you booking-related notifications (confirmations, rejections, reminders, a venue reply) over push notifications and/or WhatsApp.</li>
            <li>To review new venue listings before they go live, and to look into disputes or reported problems.</li>
          </ul>
        </Section>

        <Section title="3. Who else sees it">
          <p>We don&apos;t sell your data, and we don&apos;t share it for advertising. It does pass through a small number of services that make the app work:</p>
          <ul className="list-disc pl-5 flex flex-col gap-1.5">
            <li>
              <strong className="text-player-ink">WhatsApp (Meta):</strong> carries your verification codes, booking
              notifications, and any WhatsApp conversation you have with Maidan.
            </li>
            <li>
              <strong className="text-player-ink">An AI provider</strong> (currently Google Gemini; Claude or OpenAI
              at other times) reads chat messages to power the booking assistant, and reads payment screenshots to
              extract the amount/reference for verification. This happens automatically as part of processing your
              request, not as a separate data sale.
            </li>
            <li>
              <strong className="text-player-ink">Amazon Web Services (AWS)</strong> hosts the app, the database, and
              stores uploaded photos and payment screenshots (screenshots are kept in a private, encrypted bucket —
              never publicly listed the way venue photos are).
            </li>
            <li>
              <strong className="text-player-ink">The venue you&apos;re booking with</strong> sees your name, phone
              number, booking details, and payment proof for that booking — a venue never sees any other venue&apos;s
              players or bookings.
            </li>
          </ul>
        </Section>

        <Section title="4. How it's protected">
          <p>
            Passwords are hashed (argon2id), never stored in reverse-able form. Venue bank/payment details are
            encrypted at rest. Payment-proof screenshots are stored in a private cloud bucket with encryption
            enabled, not publicly reachable — viewing one requires a short-lived, permission-checked link generated
            only for that booking&apos;s venue owner or a Maidan admin. Session tokens are hashed at rest and expire
            after 8 hours of use.
          </p>
        </Section>

        <Section title="5. How long we keep it">
          <p>
            We keep account and booking data for as long as your account is active, plus a period afterwards for
            legitimate business needs (resolving a late dispute, financial/legal record-keeping). Payment-proof
            screenshots are kept for a rolling window used for duplicate-payment detection and dispute resolution,
            then aged out. If you want your account and personal data deleted sooner, see §6 — this isn&apos;t yet a
            self-service action in the app, so we handle it manually on request.
          </p>
        </Section>

        <Section title="6. Your choices">
          <p>
            You can review and edit your profile (name, email, city, gender) from the app at any time, and change your
            phone number or password through the app&apos;s account screens. To request a copy of your data, or to
            request your account be closed and your personal data deleted, message us on WhatsApp at{" "}
            {SUPPORT_WHATSAPP_NUMBER} — we&apos;ll action it manually and confirm once it&apos;s done. Some records (e.g.
            a completed booking&apos;s financial trail) may need to be retained for a period even after account
            deletion, where we&apos;re legally required to keep them.
          </p>
        </Section>

        <Section title="7. Changes">
          <p>
            We may update this policy as the pilot evolves. If a change is material, we&apos;ll do our best to let you
            know through the app or WhatsApp.
          </p>
        </Section>

        <Section title="8. Contact">
          <p>Questions about this policy, or about your data: message us on WhatsApp at {SUPPORT_WHATSAPP_NUMBER}.</p>
        </Section>

        <p className="text-player-ink-faint text-sm">
          See also our <Link href="/terms" className="underline font-semibold">Terms of Service</Link>.
        </p>
      </main>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="font-bold text-[15px]">{title}</h2>
      <div className="text-[14.5px] leading-[1.65] text-player-ink-muted flex flex-col gap-2.5">{children}</div>
    </section>
  );
}
