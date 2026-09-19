"""Section 21 Part B.3: every AIProvider's HTTP call retries on a transient
failure (timeout/5xx/429) but never on a client error (4xx other than 429),
since a bad request or a bad API key will fail identically on retry. The
retry policy itself lives in one place (app/services/ai/http.post_json),
shared by all three providers -- exercised here through ClaudeProvider so
the test also proves the policy is actually wired up, not just correct in
isolation."""

import httpx
import pytest

from app.services.ai.claude_provider import ClaudeProvider
from app.services.ai.http import is_retryable_error


@pytest.fixture
def provider():
    return ClaudeProvider("test-key", "claude-haiku", "claude-sonnet")


async def test_provider_retries_on_timeout(provider, monkeypatch):
    calls = []

    async def fake_post(self, url, headers=None, json=None, **kwargs):
        calls.append(url)
        if len(calls) == 1:
            raise httpx.ReadTimeout("simulated timeout", request=httpx.Request("POST", url))
        return httpx.Response(
            200,
            request=httpx.Request("POST", url),
            json={
                "content": [{"type": "text", "text": "Hello there!"}],
                "model": "claude-haiku",
                "usage": {"input_tokens": 10, "output_tokens": 5},
            },
        )

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    reply = await provider.chat("system prompt", [{"role": "user", "content": "hi"}], tools=[], model_tier="routine")

    assert reply.text == "Hello there!"
    assert len(calls) == 2, "expected exactly one retry after the first timeout"


async def test_provider_does_not_retry_on_bad_request(provider, monkeypatch):
    calls = []

    async def fake_post(self, url, headers=None, json=None, **kwargs):
        calls.append(url)
        return httpx.Response(
            400, request=httpx.Request("POST", url), json={"error": {"message": "invalid request"}}
        )

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    with pytest.raises(httpx.HTTPStatusError) as exc_info:
        await provider.chat("system prompt", [{"role": "user", "content": "hi"}], tools=[], model_tier="routine")

    assert exc_info.value.response.status_code == 400
    assert len(calls) == 1, "a 400 must fail immediately, never retried"


@pytest.mark.parametrize(
    "status_code, expected_retryable",
    [(429, True), (500, True), (502, True), (503, True), (400, False), (401, False), (403, False), (404, False)],
)
def test_is_retryable_error_status_code_boundaries(status_code, expected_retryable):
    response = httpx.Response(status_code, request=httpx.Request("POST", "https://example.com"))
    exc = httpx.HTTPStatusError("boom", request=response.request, response=response)
    assert is_retryable_error(exc) is expected_retryable


def test_is_retryable_error_timeout_and_network_errors():
    request = httpx.Request("POST", "https://example.com")
    assert is_retryable_error(httpx.ReadTimeout("timeout", request=request)) is True
    assert is_retryable_error(httpx.ConnectError("connect failed", request=request)) is True
    assert is_retryable_error(ValueError("not an httpx error at all")) is False
