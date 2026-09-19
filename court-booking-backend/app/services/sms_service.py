import httpx
import structlog
from tenacity import retry, stop_after_attempt, wait_exponential

from app.config import Settings

logger = structlog.get_logger(__name__)


class SMSService:
    """Last rung of the payment-submitted escalation ladder. No specific
    provider is wired in -- like the other external services in this app, it
    no-ops locally when unconfigured rather than failing the request."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=8))
    async def send_text(self, to_phone_number: str, body: str) -> dict:
        if not self.settings.SMS_API_URL or not self.settings.SMS_API_TOKEN:
            logger.info("sms.send.skipped_no_token", to=to_phone_number)
            return {"status": "skipped"}
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                self.settings.SMS_API_URL,
                headers={"Authorization": f"Bearer {self.settings.SMS_API_TOKEN}"},
                json={
                    "to": to_phone_number,
                    "message": body,
                    "sender_id": self.settings.SMS_SENDER_ID,
                },
            )
            response.raise_for_status()
            return response.json()
