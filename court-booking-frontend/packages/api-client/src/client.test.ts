// Audit 2026-10-28 item 1: a 401 must only rotate the session when the SAME token was refused.
// Run: cd packages/api-client && npx tsx --test src/client.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { createApiClient } from "./client";

type Call = { url: string; auth: string | null };

function harness(handler: (call: Call) => { status: number; body?: unknown }) {
  const calls: Call[] = [];
  let token: string | null = null;
  let unauthorized = 0;
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    const call = { url: String(url), auth: headers["Authorization"] ?? null };
    calls.push(call);
    const { status, body } = handler(call);
    return new Response(body === undefined ? null : JSON.stringify(body), { status });
  }) as typeof fetch;
  const client = createApiClient({
    baseUrl: "http://api",
    getToken: async () => token,
    onTokenRefreshed: async (t) => {
      token = t;
    },
    onUnauthorized: async () => {
      unauthorized += 1;
      token = null;
    },
  });
  return {
    client,
    calls,
    setToken: (t: string | null) => {
      token = t;
    },
    unauthorized: () => unauthorized,
  };
}

test("a request sent before the token was hydrated is retried with the token, never refreshed", async () => {
  let h!: ReturnType<typeof harness>;
  h = harness((call) => {
    if (call.auth === null) {
      h.setToken("t1"); // the page hydrated the stored token while this request was in flight
      return { status: 401, body: { error: { code: "NOT_AUTHENTICATED", message: "x" } } };
    }
    return { status: 200, body: { ok: true } };
  });
  const out = await h.client.request<{ ok: boolean }>("/owners/venues");
  assert.deepEqual(out, { ok: true });
  assert.equal(h.calls.filter((c) => c.url.endsWith("/auth/refresh")).length, 0);
  assert.equal(h.calls[h.calls.length - 1]?.auth, "Bearer t1");
  assert.equal(h.unauthorized(), 0);
});

test("a 401 for an old token after another request already refreshed retries with the new token", async () => {
  let h!: ReturnType<typeof harness>;
  h = harness((call) => {
    if (call.auth === "Bearer old") {
      h.setToken("new"); // a parallel request refreshed in the meantime
      return { status: 401 };
    }
    return { status: 200, body: { n: 1 } };
  });
  h.setToken("old");
  await h.client.request("/users/me/notifications/feed");
  assert.equal(h.calls.filter((c) => c.url.endsWith("/auth/refresh")).length, 0);
  assert.equal(h.calls[h.calls.length - 1]?.auth, "Bearer new");
});

test("the same token refused still refreshes once and retries", async () => {
  const h = harness((call) => {
    if (call.url.endsWith("/auth/refresh")) return { status: 200, body: { token: "t2", expires_at: "2030-01-01T00:00:00Z" } };
    if (call.auth === "Bearer t1") return { status: 401 };
    return { status: 200, body: { ok: 1 } };
  });
  h.setToken("t1");
  await h.client.request("/auth/me");
  assert.equal(h.calls.filter((c) => c.url.endsWith("/auth/refresh")).length, 1);
  assert.equal(h.calls[h.calls.length - 1]?.auth, "Bearer t2");
});

test("no token at all: the 401 is surfaced, no refresh, nobody signed out", async () => {
  const h = harness(() => ({ status: 401, body: { error: { code: "NOT_AUTHENTICATED", message: "x" } } }));
  await assert.rejects(h.client.request("/owners/venues"), (e: { status: number }) => e.status === 401);
  assert.equal(h.calls.length, 1);
  assert.equal(h.unauthorized(), 0);
});

test("a refused refresh signs the user out", async () => {
  const h = harness((call) => (call.url.endsWith("/auth/refresh") ? { status: 401 } : { status: 401 }));
  h.setToken("dead");
  await assert.rejects(h.client.request("/auth/me"));
  assert.equal(h.unauthorized(), 1);
});

test("requestText retries at most once (no 401 loop)", async () => {
  let h!: ReturnType<typeof harness>;
  let n = 0;
  h = harness((call) => {
    if (call.url.endsWith("/auth/refresh")) return { status: 200, body: { token: `t${++n}`, expires_at: "2030-01-01T00:00:00Z" } };
    return { status: 401 };
  });
  h.setToken("t0");
  await assert.rejects(h.client.requestText("/owners/ledger/export"));
  assert.ok(h.calls.length <= 3, `calls: ${h.calls.length}`);
});
