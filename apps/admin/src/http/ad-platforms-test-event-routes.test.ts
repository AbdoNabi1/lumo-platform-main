import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import type { RateLimiter } from "@platform/contracts";
import type { TestEventOutcome, TestEventRequest, TestEventService } from "@platform/tracking";
import { API, authed, buildAdPlatformsApp } from "./testing/ad-platforms-harness";

/**
 * Tracking P2-D11: `POST /ad-platforms/:platform/test-event` through the real multi-mode pipeline. The sender is a
 * recording double (its own behaviour is `apps/runtime`'s test); this is the transport: permission, tenant, strict
 * body, rate limit, and how each outcome becomes HTTP.
 */

const SENT_AT = "2026-11-28T10:00:00.000Z";

function recorder(outcome: TestEventOutcome | ((request: TestEventRequest) => TestEventOutcome)) {
  const calls: TestEventRequest[] = [];
  const service: TestEventService = {
    send: (request) => {
      calls.push(request);
      return Promise.resolve(typeof outcome === "function" ? outcome(request) : outcome);
    },
  };
  return { service, calls };
}

const SENT: TestEventOutcome = {
  ok: true,
  result: { platform: "meta", status: "sent", vendorStatus: 200, sentAt: SENT_AT },
};

describe("ad platform test event route", () => {
  let app: FastifyInstance | undefined;

  beforeEach(() => {
    expect.hasAssertions();
  });
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function start(options: Parameters<typeof buildAdPlatformsApp>[0] = {}) {
    const harness = await buildAdPlatformsApp(options);
    app = harness.app;
    return harness.app;
  }

  const post = (
    instance: FastifyInstance,
    token: string,
    platform: string,
    payload?: unknown,
  ): Promise<LightMyRequestResponse> =>
    instance.inject({
      method: "POST",
      url: `${API}/ad-platforms/${platform}/test-event`,
      headers: authed(token),
      ...(payload === undefined ? {} : { payload: payload as object }),
    });

  it("an admin sends one: the shop is the token's, the platform the path's, the body optional", async () => {
    const { service, calls } = recorder(SENT);
    const instance = await start({ testEvents: service });

    const res = await post(instance, "a-admin", "meta");

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      platform: "meta",
      status: "sent",
      vendorStatus: 200,
      sentAt: SENT_AT,
    });
    expect(calls).toEqual([{ tenantId: "tenant-a", platform: "meta" }]);
  });

  it("another shop's admin is that shop: the tenant never comes from the body or the path", async () => {
    const { service, calls } = recorder(SENT);
    const instance = await start({ testEvents: service });

    await post(instance, "b-admin", "tiktok", { testEventCode: "TEST4242" });
    const smuggled = await post(instance, "b-admin", "tiktok", { tenantId: "tenant-a" });

    expect(calls).toEqual([
      { tenantId: "tenant-b", platform: "tiktok", testEventCode: "TEST4242" },
    ]);
    expect(smuggled.statusCode).toBe(422);
  });

  it("viewer and operator are 403, no token is 401, and the sender is never asked", async () => {
    const { service, calls } = recorder(SENT);
    const instance = await start({ testEvents: service });

    for (const token of ["a-viewer", "a-operator"]) {
      expect((await post(instance, token, "meta")).statusCode).toBe(403);
    }
    const anonymous = await instance.inject({
      method: "POST",
      url: `${API}/ad-platforms/meta/test-event`,
    });

    expect(anonymous.statusCode).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("the body is strict: only a test code of letters, digits, _ and - up to 64", async () => {
    const { service, calls } = recorder(SENT);
    const instance = await start({ testEvents: service });

    const bad: unknown[] = [
      { testEventCode: "has space" },
      { testEventCode: "" },
      { testEventCode: "x".repeat(65) },
      { testEventCode: "emoji😀" },
      { testEventCode: 42 },
      { testEventCode: null },
      { testEventCode: "OK1", extra: true },
      { platform: "ga4" },
    ];
    for (const payload of bad) {
      expect((await post(instance, "a-admin", "meta", payload)).statusCode).toBe(422);
    }
    expect((await post(instance, "a-admin", "meta", {})).statusCode).toBe(200);
    expect(
      (await post(instance, "a-admin", "meta", { testEventCode: "A".repeat(64) })).statusCode,
    ).toBe(200);
    expect(
      (await post(instance, "a-admin", "meta", { testEventCode: "TEST_ab-9" })).statusCode,
    ).toBe(200);
    expect(calls).toHaveLength(3);
  });

  it("an unknown platform in the path is 422", async () => {
    const { service, calls } = recorder(SENT);
    const instance = await start({ testEvents: service });

    expect((await post(instance, "a-admin", "pinterest")).statusCode).toBe(422);
    expect(calls).toHaveLength(0);
  });

  it("GA4 validation messages are returned as they are", async () => {
    const { service } = recorder({
      ok: true,
      result: {
        platform: "ga4",
        status: "rejected",
        vendorStatus: 200,
        messages: ["events[0].params.currency: Value must be a valid currency code."],
        sentAt: SENT_AT,
      },
    });
    const instance = await start({ testEvents: service });

    const res = await post(instance, "a-admin", "ga4");

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      platform: "ga4",
      status: "rejected",
      vendorStatus: 200,
      messages: ["events[0].params.currency: Value must be a valid currency code."],
      sentAt: SENT_AT,
    });
  });

  it.each([
    ["NOT_CONNECTED", 409],
    ["TEST_CODE_REQUIRED", 422],
    ["TEST_NOT_SUPPORTED", 422],
    ["UNAVAILABLE", 503],
  ] as const)("%s answers %i with its code and a plain message", async (code, status) => {
    const { service } = recorder({ ok: false, code, message: "Plain words for the merchant." });
    const instance = await start({ testEvents: service });

    const res = await post(instance, "a-admin", "snap");

    expect(res.statusCode).toBe(status);
    expect(res.json()).toMatchObject({
      code,
      message: "Plain words for the merchant.",
      retryable: false,
    });
  });

  it("answers 503 NOT_CONFIGURED when the runtime did not wire a sender", async () => {
    const instance = await start();

    const res = await post(instance, "a-admin", "meta");

    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: "NOT_CONFIGURED" });
  });

  it("10 per minute per shop: the 11th is 429 with Retry-After, and the sender is not asked", async () => {
    const used = new Map<string, number>();
    const rateLimiter: RateLimiter = {
      consume: (key, limit, windowMs) => {
        if (!key.includes("ad-platform-test-event")) {
          return Promise.resolve({ allowed: true, remaining: 99, retryAfterMs: 0 });
        }
        expect(limit).toBe(10);
        expect(windowMs).toBe(60_000);
        const count = (used.get(key) ?? 0) + 1;
        used.set(key, count);
        return Promise.resolve(
          count <= limit
            ? { allowed: true, remaining: limit - count, retryAfterMs: 0 }
            : { allowed: false, remaining: 0, retryAfterMs: 42_000 },
        );
      },
    };
    const { service, calls } = recorder(SENT);
    const instance = await start({ testEvents: service, rateLimiter });

    for (let n = 0; n < 10; n += 1) {
      expect((await post(instance, "a-admin", "meta")).statusCode).toBe(200);
    }
    const limited = await post(instance, "a-admin", "ga4");
    const otherShop = await post(instance, "b-admin", "meta");

    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBe("42");
    expect(limited.json()).toMatchObject({ code: "RATE_LIMITED", retryable: true });
    expect(otherShop.statusCode).toBe(200);
    expect(calls.filter((call) => call.tenantId === "tenant-a")).toHaveLength(10);
    expect([...used.keys()].every((key) => key.includes("tenant-"))).toBe(true);
  });

  it("a rate limiter that fails closes the route (429), it does not send", async () => {
    const rateLimiter: RateLimiter = {
      consume: (key) =>
        key.includes("ad-platform-test-event")
          ? Promise.reject(new Error("redis down"))
          : Promise.resolve({ allowed: true, remaining: 99, retryAfterMs: 0 }),
    };
    const { service, calls } = recorder(SENT);
    const instance = await start({ testEvents: service, rateLimiter });

    const res = await post(instance, "a-admin", "meta");

    expect(res.statusCode).toBe(429);
    expect(calls).toHaveLength(0);
  });

  it("a sender that throws is a generic error: nothing of the exception reaches the response", async () => {
    const service: TestEventService = {
      send: () => Promise.reject(new Error("secret-token-in-error-text")),
    };
    const instance = await start({ testEvents: service });

    const res = await post(instance, "a-admin", "meta");

    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    expect(res.body).not.toContain("secret-token-in-error-text");
  });
});
