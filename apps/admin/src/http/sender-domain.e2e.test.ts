import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type {
  AuthenticatedContext,
  AuthenticatedIdentity,
  Cache,
  ClaimsAuthenticator,
  Clock,
  IdempotencyClaim,
  IdempotencyKeyStore,
  RateLimiter,
} from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { permissionMatches, ROLE_PERMISSIONS } from "@platform/auth";
import { InMemorySenderDomainProvider } from "@platform/notifications";
import { createAdminHttpApi } from "./server";
import { senderDomainRoutes } from "./sender-domain-routes";

/**
 * Wave 2b (D43): "Authenticate domain" over the REAL admin pipeline (multi-tenant, real permission
 * guard and error mapping), with the in-memory twin of the provider standing in for Resend.
 */

const clock: Clock = { now: () => new Date("2026-11-26T00:00:00.000Z") };
const admin: AuthenticatedIdentity = { id: "staff-1", kind: "staff", roles: ["admin"] };
const sessions: Record<string, AuthenticatedContext> = {
  "tok-a": { principal: admin, claims: { tenant_id: "tenant-a" } },
  "tok-b": { principal: admin, claims: { tenant_id: "tenant-b" } },
};

function infra() {
  const kv = new Map<string, unknown>();
  const cache: Cache = {
    get: async <T>(k: string) => (kv.get(`cache:${k}`) as T | undefined) ?? null,
    set: async (k, v) => void kv.set(`cache:${k}`, JSON.parse(JSON.stringify(v))),
    delete: async (k) => void kv.delete(`cache:${k}`),
    has: async (k) => kv.has(`cache:${k}`),
  };
  const idempotencyKeys: IdempotencyKeyStore = {
    claim: async (key): Promise<IdempotencyClaim | null> => {
      if (kv.has(`idem:${key}`)) return null;
      kv.set(`idem:${key}`, true);
      return { key, token: "t", release: async () => kv.delete(`idem:${key}`) };
    },
  };
  const rateLimiter: RateLimiter = {
    consume: async () => ({ allowed: true, remaining: 999, retryAfterMs: 0 }),
  };
  const authenticator: ClaimsAuthenticator = {
    verify: async (token) => sessions[token]?.principal ?? null,
    verifyWithClaims: async (token) => sessions[token] ?? null,
  };
  return { cache, idempotencyKeys, rateLimiter, authenticator };
}

let n = 0;
const idGenerator = { generate: () => `id-${(n += 1)}` };

const headers = (token: string) => ({
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
});

describe("sender domain routes (Wave 2b)", () => {
  let app: FastifyInstance;
  let twin: InMemorySenderDomainProvider;

  async function build(withProvider = true): Promise<FastifyInstance> {
    const fx = infra();
    return createAdminHttpApi({
      tenantMode: "multi",
      tenantGate: { availability: async () => "active" as const },
      serializer: new InMemoryEventSerializer(),
      idGenerator,
      clock,
      authenticator: fx.authenticator,
      rateLimiter: fx.rateLimiter,
      idempotencyKeys: fx.idempotencyKeys,
      responseCache: fx.cache,
      ...(withProvider ? { senderDomainProvider: twin } : {}),
    });
  }

  beforeEach(async () => {
    twin = new InMemorySenderDomainProvider();
    app = await build();
  });
  afterEach(async () => {
    await app.close();
  });

  const call = (
    method: "GET" | "POST",
    url: string,
    token: string,
    payload: unknown = method === "POST" ? {} : undefined,
  ) =>
    app.inject({
      method,
      url: `/api/v1${url}`,
      headers: headers(token),
      ...(payload === undefined ? {} : { payload: payload as object }),
    });

  /** Saves the sender email (the settings page's own call, with the current version). */
  async function setSenderEmail(token: string, email: string | null): Promise<void> {
    const read = await call("GET", "/notifications/settings", token);
    const saved = await call("POST", "/notifications/settings", token, {
      senderEmail: email,
      staffRecipients: [],
      disabledTemplates: [],
      expectedVersion: (read.json() as { version: number | null }).version,
    });
    expect(saved.statusCode).toBe(200);
  }

  const senderMode = async (token: string) =>
    ((await call("GET", "/notifications/settings", token)).json() as { sender: { mode: string } })
      .sender.mode;

  it("declares settings:read for the read and settings:update for both writes (admin-only)", () => {
    expect.hasAssertions();
    const permissions = Object.fromEntries(
      senderDomainRoutes({} as never).map((route) => [
        `${route.method} ${route.path}`,
        route.permission,
      ]),
    );
    expect(permissions).toEqual({
      "GET /notifications/sender-domain": "settings:read",
      "POST /notifications/sender-domain": "settings:update",
      "POST /notifications/sender-domain/verify": "settings:update",
    });
    expect(
      [...ROLE_PERMISSIONS.operator, ...ROLE_PERMISSIONS.viewer].some((granted) =>
        permissionMatches(granted, "settings:read"),
      ),
    ).toBe(false);
  });

  it("reads nothing yet, with the suggestion from the sender email", async () => {
    expect.hasAssertions();
    await setSenderEmail("tok-a", "support@nusuj.example");
    const res = await call("GET", "/notifications/sender-domain", "tok-a");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      available: true,
      domain: null,
      suggestion: { domain: "nusuj.example", freeMail: false },
    });
  });

  it("authenticate -> verify -> own domain, then a status regression falls back to Reply-To", async () => {
    expect.hasAssertions();
    await setSenderEmail("tok-a", "support@nusuj.example");
    expect(await senderMode("tok-a")).toBe("reply_to");

    const started = await call("POST", "/notifications/sender-domain", "tok-a");
    expect(started.statusCode).toBe(200);
    expect(started.json()).toMatchObject({
      domain: { domain: "nusuj.example", status: "not_started", verified: false },
    });
    expect(
      (started.json() as { domain: { records: unknown[] } }).domain.records.length,
    ).toBeGreaterThan(0);
    expect(await senderMode("tok-a")).toBe("reply_to");

    const pending = await call("POST", "/notifications/sender-domain/verify", "tok-a");
    expect(pending.json()).toMatchObject({ domain: { status: "pending", verified: false } });

    const id = twin.idOf("nusuj.example") ?? "";
    twin.setStatus(id, "verified");
    const verified = await call("POST", "/notifications/sender-domain/verify", "tok-a");
    expect(verified.json()).toMatchObject({ domain: { status: "verified", verified: true } });
    expect(await senderMode("tok-a")).toBe("own_domain");
    expect(await senderMode("tok-b")).not.toBe("own_domain");

    twin.setStatus(id, "failed");
    await call("POST", "/notifications/sender-domain/verify", "tok-a");
    expect(await senderMode("tok-a")).toBe("reply_to");
  });

  it("a different store cannot take a domain another store has verified", async () => {
    expect.hasAssertions();
    await setSenderEmail("tok-a", "support@nusuj.example");
    await call("POST", "/notifications/sender-domain", "tok-a");
    twin.setStatus(twin.idOf("nusuj.example") ?? "", "verified");
    await call("POST", "/notifications/sender-domain/verify", "tok-a");

    await setSenderEmail("tok-b", "hi@nusuj.example");
    const res = await call("POST", "/notifications/sender-domain", "tok-b");
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      code: "BUSINESS_RULE",
      message: "This domain is used by another store",
    });
    expect(twin.calls.filter((c) => c.startsWith("create:"))).toHaveLength(1);
  });

  it("refuses a free-mail sender email with the plain sentence (409)", async () => {
    expect.hasAssertions();
    await setSenderEmail("tok-a", "shop@gmail.com");
    const res = await call("POST", "/notifications/sender-domain", "tok-a");
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      message: "Emails from gmail.com can't be authenticated. Replies will still reach you.",
    });
  });

  it("422 when the store has no sender or contact email yet", async () => {
    expect.hasAssertions();
    expect((await call("POST", "/notifications/sender-domain", "tok-a")).statusCode).toBe(422);
  });

  it.each(["rejected", "unavailable", "timeout"] as const)(
    "a provider %s failure answers 502 with a plain message",
    async (failure) => {
      expect.hasAssertions();
      await setSenderEmail("tok-a", "support@nusuj.example");
      twin.failNext(failure);
      const res = await call("POST", "/notifications/sender-domain", "tok-a");
      expect(res.statusCode).toBe(502);
      expect(res.json()).toMatchObject({ code: "PROVIDER_ERROR", retryable: true });
      expect((res.json() as { message: string }).message).not.toMatch(/resend|re_|api/i);

      await call("POST", "/notifications/sender-domain", "tok-a");
      twin.failNext(failure);
      const verify = await call("POST", "/notifications/sender-domain/verify", "tok-a");
      expect(verify.statusCode).toBe(502);
    },
  );

  it("verify before authenticating is 404", async () => {
    expect.hasAssertions();
    expect((await call("POST", "/notifications/sender-domain/verify", "tok-a")).statusCode).toBe(
      404,
    );
  });

  it("with no RESEND_DOMAINS_API_KEY: 503 NOT_CONFIGURED on both writes; the read says not available", async () => {
    expect.hasAssertions();
    await app.close();
    app = await build(false);
    await setSenderEmail("tok-a", "support@nusuj.example");
    for (const url of ["/notifications/sender-domain", "/notifications/sender-domain/verify"]) {
      const res = await call("POST", url, "tok-a");
      expect(res.statusCode, url).toBe(503);
      expect(res.json()).toMatchObject({ code: "NOT_CONFIGURED" });
    }
    const read = await call("GET", "/notifications/sender-domain", "tok-a");
    expect(read.json()).toMatchObject({ available: false, domain: null });
  });

  it("the body is strict: a domain named by the client is refused (the domain is never client-chosen)", async () => {
    expect.hasAssertions();
    await setSenderEmail("tok-a", "support@nusuj.example");
    const res = await call("POST", "/notifications/sender-domain", "tok-a", {
      domain: "evil.example",
    });
    expect(res.statusCode).toBe(422);
    expect(twin.calls).toEqual([]);
  });
});
