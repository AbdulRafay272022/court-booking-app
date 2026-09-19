// TODO: replace with the pilot's real support WhatsApp number before launch
// -- this is a placeholder. WhatsApp is already a first-class channel in
// this app (OTP, notifications, the AI chat), so routing help requests
// through the same number means they land in the same inbound-message
// pipeline (app/api/webhooks.py) as everything else, with no separate
// support system to build. See AUDIT_FINDINGS.md finding #22. Mirrors
// apps/mobile/lib/support.ts.
export const SUPPORT_WHATSAPP_NUMBER = "+923000000000";

export function supportWhatsAppUrl(prefill?: string): string {
  const text = prefill ? `?text=${encodeURIComponent(prefill)}` : "";
  return `https://wa.me/${SUPPORT_WHATSAPP_NUMBER.replace(/[^0-9]/g, "")}${text}`;
}
