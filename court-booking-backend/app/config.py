from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # App
    APP_VERSION: str = "0.1.0"
    APP_NAME: str = "Court Booking API"
    DEBUG: bool = False
    API_V1_PREFIX: str = "/api/v1"
    ALLOWED_ORIGINS: list[str] = ["*"]

    # Database
    DATABASE_URL: str

    # Auth
    SESSION_TOKEN_SECRET: str
    # Must be a distinct value from SESSION_TOKEN_SECRET, generated separately
    # (e.g. Fernet.generate_key()). Unset + DEBUG=true falls back to
    # SESSION_TOKEN_SECRET (logged loudly) for local-dev convenience only;
    # unset + DEBUG=false makes app/utils/encryption.py raise at first use.
    BANK_DETAILS_ENCRYPTION_KEY: str = ""
    # Section 26: sessions are short-lived (8h) and kept alive by proactive
    # refresh (POST /auth/refresh) while the user is active. This is NOT the
    # same clock as phone verification below.
    SESSION_TOKEN_EXPIRE_HOURS: int = 8
    # A verified phone stays trusted this long (measured from
    # users.phone_verified_at); after that, password login is refused with
    # PHONE_REVERIFICATION_REQUIRED until the user passes an OTP again.
    PHONE_VERIFICATION_TRUST_DAYS: int = 365
    PASSWORD_MIN_LENGTH: int = 8
    # Failed password logins per phone per window before 429 -- same shape as
    # the OTP limit below (derived from rows, not a counter to keep in sync).
    LOGIN_MAX_FAILED_ATTEMPTS: int = 5
    LOGIN_RATE_LIMIT_WINDOW_MINUTES: int = 15
    OTP_EXPIRE_MINUTES: int = 5
    OTP_MAX_ATTEMPTS: int = 5
    OTP_RATE_LIMIT_WINDOW_MINUTES: int = 15
    # Local-dev convenience only: when set (and DEBUG is true), every OTP request
    # returns this code instead of a random one, so login doesn't need WhatsApp
    # delivery or a DB brute-force. Must stay unset in any shared/staging env --
    # double-gated on DEBUG so it can't silently leak into one. Never give this a
    # real value in .env.example, only in a local .env.
    DEV_FIXED_OTP: str = ""

    # Booking
    BOOKING_HOLD_MINUTES: int = 15
    PAYMENT_REVIEW_HOURS: int = 2  # owner-action expiry after a proof is submitted
    NO_SHOW_GRACE_MINUTES: int = 60  # how long past starts_at before an unchecked-in booking is a no-show

    # Payment verification
    OCR_MATCH_TOLERANCE_PERCENT: float = 5.0
    DUPLICATE_HASH_DISTANCE: int = 10  # perceptual-hash Hamming distance threshold
    DUPLICATE_LOOKBACK_DAYS: int = 90

    # Notification escalation (payment_submitted -> owner)
    ESCALATION_WHATSAPP_MINUTES: int = 5
    ESCALATION_SMS_MINUTES: int = 15

    # Marketing tier caps (Tier 3 sends per venue per calendar month)
    MARKETING_CAP_FREE: int = 0
    MARKETING_CAP_PRO: int = 100
    MARKETING_CAP_BUSINESS: int = 1000

    # Waitlist
    WAITLIST_RENOTIFY_GRACE_MINUTES: int = 10  # time a notified waitlister has before we try the next person

    # Growth suggestions (owner dashboard, Pro tier+) -- data-sufficiency guardrail
    GROWTH_LOOKBACK_DAYS: int = 180
    GROWTH_MIN_WEEKS: int = 6
    GROWTH_MIN_OBSERVATIONS: int = 20
    GROWTH_UNDERBOOKED_RATE_THRESHOLD: float = 0.30

    # Global rate limiting (per IP; OTP has its own tighter per-phone limit, see OTP_* above)
    RATE_LIMIT_PER_MINUTE: int = 1000
    # Per-user limit on POST /chat/message -- each turn is a real paid
    # Claude/Gemini tool-calling call, so this is a cost-abuse guard, not
    # just an abuse guard (see AUDIT_FINDINGS.md finding #11). Separate from
    # the blanket per-IP RATE_LIMIT_PER_MINUTE above, same reasoning as
    # OTP's own tighter per-phone limit.
    CHAT_RATE_LIMIT_PER_MINUTE: int = 20

    # Admin disputes queue: a player rejected this many times (platform-wide) surfaces for review
    DISPUTE_MIN_REJECTIONS: int = 2
    # A venue whose payment_review_expired cancellations reach this count
    # surfaces as "passive inaction" -- an owner who never opens the
    # approvals screen produces zero explicit rejections and so was
    # otherwise invisible to the dispute system (AUDIT_FINDINGS.md finding #14)
    DISPUTE_MIN_PASSIVE_EXPIRIES: int = 2
    # Section 32 Part 10: a refund still marked "owed" this many days after
    # it was flagged surfaces as overdue to admin. Picked as a reasonable
    # default for a real-money pilot, not specified by the spec -- flagged
    # as a decision made without asking.
    REFUND_OVERDUE_DAYS: int = 3

    # Platform-wide kill switches, read at request time (no redeploy needed
    # to flip either) -- see AUDIT_FINDINGS.md finding #21. If the AI chat
    # gets manipulated into an abusive tool-calling loop, or vision OCR
    # starts mis-extracting amounts and auto-approving underpaid bookings,
    # these are the emergency stop.
    AI_CHAT_ENABLED: bool = True
    GLOBAL_AUTO_APPROVE_ENABLED: bool = True

    # SMS
    SMS_API_URL: str = ""
    SMS_API_TOKEN: str = ""
    SMS_SENDER_ID: str = ""

    # AWS
    AWS_REGION: str = "ap-south-1"
    AWS_ACCESS_KEY_ID: str = ""
    AWS_SECRET_ACCESS_KEY: str = ""
    AWS_ENDPOINT_URL: str = ""  # localstack override
    S3_BUCKET_PUBLIC: str = "court-booking-public"
    S3_BUCKET_PRIVATE: str = "court-booking-private"
    S3_KMS_KEY_ID: str = ""
    CLOUDFRONT_DOMAIN: str = ""

    # WhatsApp
    WHATSAPP_API_URL: str = "https://graph.facebook.com/v20.0"
    WHATSAPP_API_TOKEN: str = ""
    WHATSAPP_PHONE_NUMBER_ID: str = ""
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: str = ""
    # Meta app secret used to verify the X-Hub-Signature-256 HMAC on every
    # inbound POST /webhooks/whatsapp -- distinct from
    # WHATSAPP_WEBHOOK_VERIFY_TOKEN (that one only guards the one-time GET
    # subscribe handshake). Unset + DEBUG=true skips verification for local
    # dev; unset + DEBUG=false rejects every webhook. See
    # webhooks.py::receive_whatsapp_webhook.
    WHATSAPP_APP_SECRET: str = ""

    # AI provider selection (Section 21) -- "claude" | "gemini" | "openai".
    # One provider is active at a time, chosen at deploy time; AI_VISION_PROVIDER
    # optionally overrides just the OCR path (e.g. run chat on Gemini, keep
    # payment-proof OCR on Claude). Blank means "reuse AI_PROVIDER."
    AI_PROVIDER: str = "claude"
    AI_VISION_PROVIDER: str = ""

    # Claude
    ANTHROPIC_API_KEY: str = ""
    CLAUDE_HAIKU_MODEL: str = "claude-haiku-4-20250514"
    CLAUDE_SONNET_MODEL: str = "claude-sonnet-4-20250514"

    # Gemini
    GEMINI_API_KEY: str = ""
    # gemini-2.0-flash/-pro (this project's original defaults) and even
    # gemini-2.5-flash/-pro were confirmed dead (404 "no longer available
    # to new users") during Part B.1's live verification against the real
    # API on 2026-09-07. gemini-3.6-flash was confirmed live that same day
    # and used briefly as the chat-tier default; superseded on 2026-09-08
    # by gemini-3.5-flash-lite, also live-verified (chat, tool-calling
    # incl. the thoughtSignature round-trip, and vision) before switching.
    # Google churns model names quickly here -- re-verify against a real
    # key before assuming any of these are still current.
    GEMINI_FLASH_MODEL: str = "gemini-3.5-flash-lite"
    # Deliberate quality-for-availability tradeoff, not a silent regression:
    # `gemini-pro-latest` (the prior default) hit 429 quota errors on every
    # vision call tried against this project's key/plan, making it
    # unusable in practice regardless of the "vision quality matters more
    # than latency" rationale in payment_service.py/README. Live-verified
    # 2026-09-19 (real GEMINI_API_KEY, a synthetic receipt image through
    # GeminiProvider.extract_payment_proof): amount/reference/timestamp all
    # extracted correctly, no 429. See CLAUDE.md's gotcha log for the full
    # history of this model's churn.
    GEMINI_PRO_MODEL: str = "gemini-3.5-flash-lite"

    # OpenAI
    OPENAI_API_KEY: str = ""
    OPENAI_MINI_MODEL: str = "gpt-4o-mini"
    OPENAI_FULL_MODEL: str = "gpt-4o"

    # FCM: service-account JSON, raw or base64 (see app/services/fcm.py)
    FCM_SERVICE_ACCOUNT_KEY: str = ""

    # APNs: iOS tokens go straight to Apple (see app/services/apns.py). APNS_KEY is the .p8
    # contents, raw or base64. Any of KEY/KEY_ID/TEAM_ID blank = iOS push is skipped.
    APNS_KEY: str = ""
    APNS_KEY_ID: str = ""
    APNS_TEAM_ID: str = ""
    APNS_BUNDLE_ID: str = "com.maidan.app"  # must match ios.bundleIdentifier in app.json
    # Development-client builds register sandbox tokens; ad-hoc / TestFlight / App Store use production.
    APNS_USE_SANDBOX: bool = False

    # Sentry
    SENTRY_DSN: str = ""

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=True, extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()
