from datetime import datetime, timedelta, timezone

import structlog
import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from app.config import Settings
from app.services.whatsapp_templates import TEMPLATES, build_components

logger = structlog.get_logger(__name__)


class WhatsAppService:
    """Thin wrapper around the WhatsApp Cloud API (Graph API)."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.base_url = f"{settings.WHATSAPP_API_URL}/{settings.WHATSAPP_PHONE_NUMBER_ID}/messages"

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.settings.WHATSAPP_API_TOKEN}",
            "Content-Type": "application/json",
        }

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=8))
    async def _send(self, payload: dict) -> dict:
        if not self.settings.WHATSAPP_API_TOKEN:
            logger.info("whatsapp.send.skipped_no_token", to=payload.get("to"))
            return {"messages": [{"id": "local-dev-noop"}]}
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(self.base_url, headers=self._headers(), json=payload)
            response.raise_for_status()
            return response.json()

    async def send_text(self, to_phone_number: str, body: str) -> dict:
        payload = {
            "messaging_product": "whatsapp",
            "to": to_phone_number.lstrip("+"),
            "type": "text",
            "text": {"body": body},
        }
        return await self._send(payload)

    async def send_otp(self, to_phone_number: str, code: str) -> dict:
        """TEMPORARY -- free-form text instead of the `whatsapp_otp`
        authentication template, because Meta Business Verification (which
        Authentication templates require) isn't done yet.

        The catch: free text only delivers inside the recipient's open 24h
        customer-service window, i.e. they must have messaged the business
        number first. Otherwise Meta rejects it (error 131047, HTTP 400),
        `_send` raises, and `AuthService.request_otp` turns that into
        OTP_DELIVERY_FAILED. For now testers open the window manually.

        REVERT once an Authentication template is approved: replace the two
        lines below with
            return await self.send_registered_template(to_phone_number, "whatsapp_otp", [code])
        (the original behavior -- WhatsApp requires an approved template for
        OTPs to a recipient with no open window, which is most real users on
        their very first contact). Also drop the CLAUDE.md/README notes."""
        body = (
            f"{code} is your verification code. For your security, do not share this code. "
            f"It expires in {self.settings.OTP_EXPIRE_MINUTES} minutes."
        )
        return await self.send_text(to_phone_number, body)

    async def send_template(
        self, to_phone_number: str, template_name: str, language_code: str, components: list | None = None
    ) -> dict:
        payload = {
            "messaging_product": "whatsapp",
            "to": to_phone_number.lstrip("+"),
            "type": "template",
            "template": {
                "name": template_name,
                "language": {"code": language_code},
                "components": components or [],
            },
        }
        return await self._send(payload)

    async def send_registered_template(
        self, to_phone_number: str, template_name: str, params: list[str], language_code: str = "en"
    ) -> dict:
        """Send by name from the app's own template catalog (whatsapp_templates.py)."""
        return await self.send_template(
            to_phone_number, template_name, language_code, build_components(params)
        )

    def verify_webhook_challenge(self, mode: str, token: str, challenge: str) -> str | None:
        if mode == "subscribe" and token == self.settings.WHATSAPP_WEBHOOK_VERIFY_TOKEN:
            return challenge
        return None

    async def download_media(self, media_id: str) -> tuple[bytes, str] | None:
        """Two-step fetch per the Cloud API: resolve the media ID to a
        short-lived CDN URL, then download from it with the same auth header.
        Returns (bytes, mime_type), or None if unconfigured/unavailable."""
        if not self.settings.WHATSAPP_API_TOKEN:
            logger.info("whatsapp.media.skipped_no_token", media_id=media_id)
            return None
        base = self.settings.WHATSAPP_API_URL.rstrip("/")
        async with httpx.AsyncClient(timeout=15) as client:
            meta_resp = await client.get(f"{base}/{media_id}", headers=self._headers())
            meta_resp.raise_for_status()
            meta = meta_resp.json()
            media_url = meta.get("url")
            if not media_url:
                return None
            data_resp = await client.get(media_url, headers=self._headers())
            data_resp.raise_for_status()
            content_type = meta.get("mime_type", data_resp.headers.get("content-type", "image/jpeg"))
            return data_resp.content, content_type

    @staticmethod
    def parse_inbound_messages(payload: dict) -> list[dict]:
        """Extract a flat list of normalized inbound messages from a webhook
        body. `type` is one of text | image | interactive | button (template
        reply); `button_id`/`button_text` are set for interactive/button
        replies (booking confirmation/cancellation, template CTA replies)."""
        messages = []
        for entry in payload.get("entry", []):
            for change in entry.get("changes", []):
                value = change.get("value", {})
                for msg in value.get("messages", []):
                    msg_type = msg.get("type")
                    interactive = msg.get("interactive", {})
                    button_reply = interactive.get("button_reply") or interactive.get("list_reply")
                    button = msg.get("button")

                    messages.append(
                        {
                            "phone_number": f"+{msg.get('from')}",
                            "message_id": msg.get("id"),
                            "type": msg_type,
                            "text": msg.get("text", {}).get("body") if msg_type == "text" else None,
                            "image_id": msg.get("image", {}).get("id") if msg_type == "image" else None,
                            "image_mime_type": msg.get("image", {}).get("mime_type")
                            if msg_type == "image"
                            else None,
                            "button_id": (button_reply or {}).get("id") or (button or {}).get("payload"),
                            "button_text": (button_reply or {}).get("title") or (button or {}).get("text"),
                        }
                    )
        return messages

    async def is_within_free_window(self, last_inbound_at: datetime | None) -> bool:
        """Free-form text is only allowed within 24h of the customer's last
        message; outside it a registered template is required."""
        if last_inbound_at is None:
            return False
        return datetime.now(timezone.utc) - last_inbound_at < timedelta(hours=24)

    async def send_smart(
        self,
        to_phone_number: str,
        body: str,
        *,
        last_inbound_at: datetime | None,
        template_name: str,
        template_params: list[str],
    ) -> tuple[dict, str | None]:
        """Send free-form text if we're still inside the 24h window, else the
        named (or generic fallback) template. Returns (api_result,
        template_name_used) -- the second element is None for a plain-text
        send, so callers can drop it straight into notification_log.template_name."""
        if await self.is_within_free_window(last_inbound_at):
            return await self.send_text(to_phone_number, body), None

        template = TEMPLATES.get(template_name)
        if template is None:
            template = TEMPLATES["generic_notification"]
            params = [body]
        else:
            params = template_params
        result = await self.send_registered_template(to_phone_number, template.name, params)
        return result, template.name
