"""Audit build 2026-10-28, Phase 1 (no migration). One section per item; see docs/audit-build-progress.md."""

from app.services.auth_service import AuthService


# ---------------------------------------------------------------- item 1: /auth/me never 500s


async def test_auth_me_is_401_when_the_session_rotates_between_lookups(client, make_user, make_auth_headers, monkeypatch):
    """CurrentUser resolved the token, then a parallel refresh revoked the session before get_me's own lookup."""
    user = await make_user("+923001110001")
    headers = await make_auth_headers(user)

    async def _gone(self, token):
        return None

    async def _user(self, token):
        return user

    monkeypatch.setattr(AuthService, "get_user_from_token", _user)
    monkeypatch.setattr(AuthService, "get_session_from_token", _gone)
    resp = await client.get("/api/v1/auth/me", headers=headers)
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "SESSION_EXPIRED"


async def test_auth_me_still_works(client, make_user, make_auth_headers):
    user = await make_user("+923001110002")
    resp = await client.get("/api/v1/auth/me", headers=await make_auth_headers(user))
    assert resp.status_code == 200
    assert resp.json()["user"]["id"] == str(user.id)
