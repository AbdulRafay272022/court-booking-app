from datetime import datetime, timedelta, timezone

import structlog
import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

from app.config import Settings
from app.services.whatsapp_templates import TEMPLATES, build_components

logger = structlog.get_logger(__name__)


def mask_phone(phone: str | None) -> str | None:
    """Last 4 digits only -- enough to correlate log lines, not to identify."""
    if not phone:
        return phone
    return f"***{str(phone)[-4:]}"


def _meta_error(response: httpx.Response) -> dict | str:
    """Meta's `error` object from a failed Graph API response (the response,
    never the request, so the bearer token can't end up in it), or a
    truncated body if it isn't JSON."""
    try:
        err = response.json().get("error")
    except ValueError:
        err = None
    if not isinstance(err, dict):
        return response.text[:300]
    return {
        k: err.get(k)
        for k in ("code", "type", "message", "error_subcode", "error_data", "fbtrace_id")
        if err.get(k) is not None
    }


# Meta error 131047: free-form message outside the recipient's 24h customer-service window.
META_ERR_NO_OPEN_WINDOW = 131047


def describe_send_failure(exc: BaseException) -> tuple[str, int | None]:
    """Classify a failed `_send` for logging: ("no_open_window" | "send_failed", meta error code).

    `_send` is wrapped in tenacity's `retry` without `reraise`, so what escapes is a `RetryError`
    around the last attempt's `httpx.HTTPStatusError`; unwrap both to reach Meta's error code."""
    inner: BaseException = exc
    last_attempt = getattr(exc, "last_attempt", None)
    if last_attempt is not None:
        inner = last_attempt.exception() or exc
    response = getattr(inner, "response", None)
    code = None
    if isinstance(response, httpx.Response):
        err = _meta_error(response)
        code = err.get("code") if isinstance(err, dict) else None
    return ("no_open_window" if code == META_ERR_NO_OPEN_WINDOW else "send_failed"), code


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
            if response.is_error:
                # Without this, Meta's error object (code/message/error_data)
                # is lost: raise_for_status() below only keeps the status line.
                logger.warning(
                    "whatsapp.send.rejected",
                    to=mask_phone(payload.get("to")),
                    type=payload.get("type"),
                    http_status=response.status_code,
                    meta_error=_meta_error(response),
                )
            response.raise_for_status()
            result = response.json()
            # HTTP 2xx only means Meta *accepted* the message. Whether it was
            # delivered comes later, in a `statuses` webhook (see
            # parse_status_updates and the webhook handler) -- the wamid here
            # is what ties the two together.
            logger.info(
                "whatsapp.send.accepted",
                to=mask_phone(payload.get("to")),
                type=payload.get("type"),
                wamid=(result.get("messages") or [{}])[0].get("id"),
            )
            return result

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

    async def send_phone_changed_notice(self, old_phone: str, new_phone: str) -> dict:
        """Tell the OLD number that the account's phone was just changed (account-takeover
        detection). BEST-EFFORT by design: it is free-form text like `send_otp`, so under the
        temporary setup it only delivers if the old number has an open 24h window -- most won't.
        That is expected, not a bug; it becomes reliable once a verified business account and an
        approved Utility template exist (switch to `send_registered_template` then). Callers must
        never let a failure here affect the phone change itself."""
        body = (
            f"Your Maidan account's phone number was just changed to the number ending "
            f"{str(new_phone)[-4:]}. If this wasn't you, contact support immediately."
        )
        return await self.send_text(old_phone, body)

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

    @staticmethod
    def parse_status_updates(payload: dict) -> list[dict]:
        """Delivery-status callbacks (`value.statuses[]`): sent / delivered /
        read / failed for a message *we* sent, keyed by its wamid. A `failed`
        one carries Meta's error code -- e.g. 131047 when a free-text message
        was refused because the recipient's 24h window was closed. That is
        often where such a failure first appears: the original send call can
        still have returned HTTP 200."""
        updates = []
        for entry in payload.get("entry", []):
            for change in entry.get("changes", []):
                for st in change.get("value", {}).get("statuses") or []:
                    updates.append(
                        {
                            "message_id": st.get("id"),
                            "status": st.get("status"),
                            "recipient": st.get("recipient_id"),
                            "timestamp": st.get("timestamp"),
                            "errors": [
                                {
                                    "code": e.get("code"),
                                    "title": e.get("title"),
                                    "message": e.get("message"),
                                    "details": (e.get("error_data") or {}).get("details"),
                                }
                                for e in (st.get("errors") or [])
                            ],
                        }
                    )
        return updates

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
