import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/nav-auth";
import { SUPPORT_WHATSAPP_NUMBER } from "@/lib/support";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms that apply to using Maidan to find, book and manage court bookings.",
};

const LAST_UPDATED = "20 September 2026";

export default function TermsPage() {
  return (
    <>
      <SiteHeader />
      <main className="max-w-2xl mx-auto px-6 py-12 flex flex-col gap-8 text-player-ink">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-extrabold tracking-tight">Terms of Service</h1>
          <p className="text-player-ink-faint text-sm">Last updated {LAST_UPDATED}</p>
        </div>

        <Section title="1. Who this is">
          <p>
            Maidan is a court-booking platform operated by Logic Link System (&ldquo;Maidan&rdquo;, &ldquo;we&rdquo;,
            &ldquo;us&rdquo;) for padel, futsal and other court sports, currently piloting in Karachi, Pakistan. These
            terms apply whenever you use the Maidan app, the Maidan website, or the Maidan WhatsApp number to find,
            hold, pay for, or manage a court booking, or to list and run a venue.
          </p>
        </Section>

        <Section title="2. Accounts">
          <p>
            You need an account to hold or pay for a booking. Signing up requires a phone number, which we verify by
            sending a one-time code over WhatsApp — this proves you control the number, not your identity in any
            stronger sense. You also set a password, which is how you log in afterwards; we never see or store your
            password itself, only a one-way hash of it. You&apos;re responsible for keeping your password and your
            phone (since verification codes go there) to yourself.
          </p>
          <p>
            A player account and a venue-owner account are the same kind of account with a different role attached.
            If you want to switch from booking courts to also listing a venue, contact us (below) — there is
            currently no self-service way to add owner access to an existing account.
          </p>
          <p>
            We may suspend an account that abuses the platform (repeated no-shows, fraudulent payment proofs, abusive
            messages to venues or other players, or attempts to interfere with how bookings or payments work). We&apos;ll
            tell you why if we do.
          </p>
        </Section>

        <Section title="3. Bookings and holds">
          <p>
            Tapping an available slot creates a short hold, not a booking — you have a limited window to submit proof
            of payment before the hold expires and the slot is released. A booking only becomes confirmed once the
            venue (or, where a venue has switched it on, an automated check) accepts your payment proof.
          </p>
          <p>
            Each venue sets its own cancellation policy for a booking you&apos;ve already paid for: some allow
            cancelling any time before your booking starts, some require cancelling a set number of hours ahead, and
            some don&apos;t allow player-initiated cancellation of a paid booking at all. The exact policy for a given
            court is shown to you before you pay. Holds and unpaid bookings can generally be cancelled or simply
            allowed to expire with no penalty beyond losing the hold.
          </p>
        </Section>

        <Section title="4. Payments and refunds">
          <p>
            Maidan does not process, hold, or move your money. Payment is a direct bank or mobile-wallet transfer
            from you to the venue, outside the app — you upload a screenshot of that transfer as proof, which we read
            automatically (and the venue can review manually) to confirm the amount matches what&apos;s owed.
          </p>
          <p>
            Because we&apos;re not a party to the transfer itself, refunds are handled directly between you and the
            venue, not automatically by Maidan. Where a paid booking is cancelled (by you, where the venue&apos;s policy
            allows it, or automatically if a venue never reviews a submitted payment), we flag it to the venue as a
            refund owed, but the venue processes that refund manually, outside the app. If a venue isn&apos;t
            responding about a refund you&apos;re owed, contact us and we&apos;ll follow up.
          </p>
        </Section>

        <Section title="5. Venue owners">
          <p>
            If you list a venue, you&apos;re responsible for the accuracy of what you publish (hours, prices, courts,
            photos, bank/payment details) and for reviewing payment proofs promptly — a slow review is the single
            biggest source of player frustration on a platform like this, and repeated failures to review may affect
            your account. New venues are reviewed by us before they&apos;re publicly listed; we can reject a listing or
            ask for changes, and can suspend a listed venue that repeatedly mishandles bookings or payments.
          </p>
        </Section>

        <Section title="6. Conduct">
          <p>
            Don&apos;t use Maidan to submit fraudulent payment proof, impersonate someone else, harass another user or a
            venue, or try to interfere with the booking system (e.g. scripting holds you don&apos;t intend to pay for).
            We can suspend accounts that do this, and where real money or fraud is involved, may share information
            with the affected venue or, where required, with law enforcement.
          </p>
        </Section>

        <Section title="7. No warranty, limits on liability">
          <p>
            Maidan connects players and venues; we don&apos;t operate the courts themselves and aren&apos;t responsible for
            the condition of a venue, a venue&apos;s own cancellation or safety practices, or disputes between a player
            and a venue that we&apos;re not able to resolve. The service is provided as-is, during an active pilot —
            features, availability, and the AI chat assistant&apos;s responses can be imperfect or unavailable at times.
          </p>
        </Section>

        <Section title="8. Changes">
          <p>
            We may update these terms as the pilot evolves. If a change is material, we&apos;ll do our best to let you
            know through the app or WhatsApp. Continuing to use Maidan after a change means you accept the updated
            terms.
          </p>
        </Section>

        <Section title="9. Governing law">
          <p>These terms are governed by the laws of Pakistan.</p>
        </Section>

        <Section title="10. Contact">
          <p>
            Questions about these terms, or about a specific booking: message us on WhatsApp at{" "}
            {SUPPORT_WHATSAPP_NUMBER}, the same number Maidan uses for booking notifications and the chat assistant.
          </p>
        </Section>

        <p className="text-player-ink-faint text-sm">
          See also our <Link href="/privacy" className="underline font-semibold">Privacy Policy</Link>.
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
