"""Minimum app version for OWNER / STAFF (founder 14 Nov, ledger v2 rollout).

After ledger_v2 is ON an old owner/staff app breaks on money actions (it cannot send the refund/credit choice, "who cancelled",
a duplicate confirmation...). So, from the day the setting is set, such an app gets 426 UPGRADE_REQUIRED and the new app shows
"Update karein" (it fetches the OTA update itself). Rules:

- OFF unless settings.MIN_STAFF_APP_LEVEL > 0 (default 0): deploying this code blocks nobody.
- Only an authenticated OWNER or STAFF member; never a player (an old player app can still book, pay, cancel) or an admin.
- Never the web: the web sends X-Client-Platform: web, and a request from a browser (an Origin header or a browser user
  agent, e.g. a tab opened before a deploy) is never treated as an old app.
- Never /auth/* (login, refresh, logout, me) so an old app can still sign in and out.
- The app's level is X-App-Level (an integer constant in the app's code, raised by an OTA update); an app that sends none is
  level 0 (every build before this change).
"""

from fastapi import Request

from app.config import Settings
from app.errors import AppError, ErrorCode
from app.models.user import User, UserRole

PLATFORM_HEADER = "X-Client-Platform"
APP_LEVEL_HEADER = "X-App-Level"
UPGRADE_MESSAGE = "Khelo app purani hai: naya update install karein. / Your Khelo app is out of date: please update it."


def _is_browser(request: Request) -> bool:
    ua = (request.headers.get("user-agent") or "").lower()
    return bool(request.headers.get("origin")) or "mozilla" in ua


def app_level(request: Request) -> int:
    try:
        return max(int(request.headers.get(APP_LEVEL_HEADER) or 0), 0)
    except ValueError:
        return 0


def check_staff_client(request: Request, user: User, settings: Settings) -> None:
    """Raise 426 UPGRADE_REQUIRED for an owner/staff app below MIN_STAFF_APP_LEVEL (see the module doc)."""
    minimum = int(getattr(settings, "MIN_STAFF_APP_LEVEL", 0) or 0)
    if minimum <= 0 or user.role not in (UserRole.OWNER, UserRole.STAFF):
        return
    if "/auth/" in request.url.path:
        return
    platform = (request.headers.get(PLATFORM_HEADER) or "").strip().lower()
    if platform == "web" or (not platform and _is_browser(request)):
        return
    if app_level(request) >= minimum:
        return
    raise AppError(426, ErrorCode.UPGRADE_REQUIRED, UPGRADE_MESSAGE, details={"min_level": minimum})
