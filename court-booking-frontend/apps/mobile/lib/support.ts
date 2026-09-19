import { Linking } from "react-native";

// TODO: replace with the pilot's real support WhatsApp number before launch
// -- this is a placeholder. WhatsApp is already a first-class channel in
// this app (OTP, notifications, the AI chat), so routing help requests
// through the same number means they land in the same inbound-message
// pipeline (app/api/webhooks.py) as everything else, with no separate
// support system to build. See AUDIT_FINDINGS.md finding #22.
export const SUPPORT_WHATSAPP_NUMBER = "+923000000000";

export function openSupportWhatsApp(prefill?: string) {
  const text = prefill ? `?text=${encodeURIComponent(prefill)}` : "";
  Linking.openURL(`https://wa.me/${SUPPORT_WHATSAPP_NUMBER.replace(/[^0-9]/g, "")}${text}`);
}
