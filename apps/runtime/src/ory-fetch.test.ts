import type { HttpFetch } from "@platform/auth";
import { describe, expect, it, vi } from "vitest";
import { createOryFetch } from "./ory-fetch";

/** A stub matching `HttpFetch`'s narrow shape (not the global `fetch`/`Response` pair). */
function stubFetch(): HttpFetch & { calls: { url: string; init?: Parameters<HttpFetch>[1] }[] } {
  const calls: { url: string; init?: Parameters<HttpFetch>[1] }[] = [];
  const fn = vi.fn(async (url: string, init?: Parameters<HttpFetch>[1]) => {
    calls.push({ url, init });
    return { status: 200, json: async () => ({ allowed: true }) };
  });
  return Object.assign(fn, { calls });
}

describe("createOryFetch", () => {
  it("attaches the bearer token when an api key is configured", async () => {
    const inner = stubFetch();
    await createOryFetch("ory_pat_abc", inner)("https://example.test/relation-tuples/check");
    expect(inner.calls[0]?.init?.headers?.["authorization"]).toBe("Bearer ory_pat_abc");
  });

  it("preserves caller-supplied headers alongside the token", async () => {
    const inner = stubFetch();
    await createOryFetch("ory_pat_abc", inner)("https://example.test/x", {
      headers: { "content-type": "application/json" },
    });
    const headers = inner.calls[0]?.init?.headers;
    expect(headers?.["content-type"]).toBe("application/json");
    expect(headers?.["authorization"]).toBe("Bearer ory_pat_abc");
  });

  it("preserves method and body", async () => {
    const inner = stubFetch();
    await createOryFetch("ory_pat_abc", inner)("https://example.test/x", {
      method: "PUT",
      body: '{"a":1}',
    });
    expect(inner.calls[0]?.init?.method).toBe("PUT");
    expect(inner.calls[0]?.init?.body).toBe('{"a":1}');
  });

  it("sends no authorization header when no api key is configured", async () => {
    const inner = stubFetch();
    await createOryFetch(undefined, inner)("https://example.test/x");
    expect(inner.calls[0]?.init?.headers?.["authorization"]).toBeUndefined();
  });

  it("passes init through untouched when no api key is configured", async () => {
    const inner = stubFetch();
    await createOryFetch(undefined, inner)("https://example.test/x", {
      headers: { "content-type": "application/json" },
    });
    expect(inner.calls[0]?.init?.headers).toEqual({ "content-type": "application/json" });
  });

  it("treats an empty api key as absent rather than sending 'Bearer '", async () => {
    const inner = stubFetch();
    await createOryFetch("", inner)("https://example.test/x");
    expect(inner.calls[0]?.init?.headers?.["authorization"]).toBeUndefined();
  });
});
