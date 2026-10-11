// The pilot's real support WhatsApp number (set 2026-10-12; was a +923000000000 placeholder). WhatsApp is already a first-class
// channel in this app (OTP, notifications, the AI chat), so routing help requests through a WhatsApp number means they land in the
// same inbound-message pipeline (app/api/webhooks.py) as everything else, with no separate support system to build.
// See AUDIT_FINDINGS.md finding #22. Used by the Terms and Privacy pages, the pay screen, the owner dashboard and venue-setup
// help links on web, and the profile screen on mobile. The web Contact page reads NEXT_PUBLIC_SUPPORT_WHATSAPP (server .env.web)
// instead, so keep the two in step if the number ever changes.
export const SUPPORT_WHATSAPP_NUMBER = "+923345634571";

export function supportWhatsAppUrl(prefill?: string): string {
  const text = prefill ? `?text=${encodeURIComponent(prefill)}` : "";
  return `https://wa.me/${SUPPORT_WHATSAPP_NUMBER.replace(/[^0-9]/g, "")}${text}`;
}
