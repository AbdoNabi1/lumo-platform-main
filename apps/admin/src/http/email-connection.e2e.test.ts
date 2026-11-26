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
import { emailConnectionRoutes } from "./email-connection-routes";
import { createAdminHttpApi } from "./server";
import {
  STORE_API_KEY,
  storeEmailHarness,
  type StoreEmailHarness,
} from "./testing/store-email-harness";

/**
 * Wave 2b2: the store's own email account over the REAL admin pipeline (`createAdminHttpApi`,
 * multi-tenant, real permission guard and error mapping), exactly as Settings > Notifications calls
 * it. The platform's own sender is a spy: it must never be called for a store's customer mail.
 */

const clock: Clock = { now: () => new Date("2026-11-26T00:00:00.000Z") };
const owner: AuthenticatedIdentity = { id: "staff-1", kind: "staff", roles: ["admin"] };
const noAddress: AuthenticatedIdentity = { id: "staff-2", kind: "staff", roles: ["admin"] };
const operator: AuthenticatedIdentity = { id: "staff-3", kind: "staff", roles: ["operator"] };
const sessions: Record<string, AuthenticatedContext> = {
  "tok-a": { principal: owner, claims: { tenant_id: "tenant-a" } },
  "tok-b": { principal: owner, claims: { tenant_id: "tenant-b" } },
  "tok-noaddr": { principal: noAddress, claims: { tenant_id: "tenant-a" } },
  "tok-op": { principal: operator, claims: { tenant_id: "tenant-a" } },
};

function infra(testBudget: "allow" | "deny" | "throw" = "allow") {
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
  const consumed: string[] = [];
  const rateLimiter: RateLimiter = {
    consume: async (key) => {
      if (key.includes("email-connection-test")) {
        consumed.push(key);
        if (testBudget === "throw") throw new Error("redis down");
        if (testBudget === "deny") return { allowed: false, remaining: 0, retryAfterMs: 1_800_000 };
      }
      return { allowed: true, remaining: 999, retryAfterMs: 0 };
    },
  };
  const authenticator: ClaimsAuthenticator = {
    verify: async (token) => sessions[token]?.principal ?? null,
    verifyWithClaims: async (token) => sessions[token] ?? null,
  };
  return { cache, idempotencyKeys, rateLimiter, authenticator, consumed };
}

let n = 0;
const idGenerator = { generate: () => `id-${(n += 1)}` };

const headers = (token: string) => ({
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
});

const connect = { kind: "resend", fromEmail: "Shop@Merchant.test", apiKey: STORE_API_KEY };

describe("store email connection routes (Wave 2b2)", () => {
  let app: FastifyInstance;
  let mail: StoreEmailHarness;
  let fx: ReturnType<typeof infra>;

  async function boot(
    options: { vault?: boolean; budget?: "allow" | "deny" | "throw"; smtp?: boolean } = {},
  ): Promise<void> {
    mail = await storeEmailHarness({
      tenantId: "tenant-a",
      staffId: "staff-1",
      staffEmail: "owner@merchant.test",
      clock,
    });
    fx = infra(options.budget);
    const { emailVault, ...rest } = mail.deps;
    app = await createAdminHttpApi({
      tenantMode: "multi",
      tenantGate: { availability: async () => "active" as const },
      serializer: new InMemoryEventSerializer(),
      idGenerator,
      clock,
      authenticator: fx.authenticator,
      rateLimiter: fx.rateLimiter,
      idempotencyKeys: fx.idempotencyKeys,
      responseCache: fx.cache,
      ...rest,
      ...(options.vault === false ? {} : { emailVault }),
      ...(options.smtp === true ? { smtpEnabled: true } : {}),
    });
  }

  beforeEach(async () => {
    await boot();
  });
  afterEach(async () => {
    await app.close();
  });

  const call = (
    method: "GET" | "POST" | "PUT" | "DELETE",
    url: string,
    token: string,
    payload?: unknown,
  ) =>
    app.inject({
      method,
      url: `/api/v1${url}`,
      headers: headers(token),
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  const put = (body: Record<string, unknown>, token = "tok-a") =>
    call("PUT", "/notifications/email-connection", token, { expectedVersion: null, ...body });

  it("reads 'not connected' first: no connection, the server can seal keys", async () => {
    expect.hasAssertions();
    const read = await call("GET", "/notifications/email-connection", "tok-a");
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual({
      credentialsConfigured: true,
      smtpAvailable: false,
      connection: null,
    });
  });

  it("connect: seals the key, sends the test mail to YOUR address through the STORE's key, answers connected without the key", async () => {
    expect.hasAssertions();
    const res = await put(connect);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      credentialsConfigured: true,
      connection: {
        kind: "resend",
        fromEmail: "shop@merchant.test",
        secretLast4: STORE_API_KEY.slice(-4),
        enabled: true,
        status: "connected",
        state: "connected",
        lastError: null,
        version: 1,
      },
    });
    expect(res.body).not.toContain(STORE_API_KEY);
    expect(mail.provider.calls).toHaveLength(1);
    expect(mail.provider.calls[0]?.credentials.apiKey).toBe(STORE_API_KEY);
    expect(mail.provider.calls[0]?.message.to).toBe("owner@merchant.test");
    expect(mail.provider.calls[0]?.message.from).toContain("<shop@merchant.test>");
    // The platform's own account sent nothing, and a later read never returns the key either.
    expect(mail.platformMail).toHaveLength(0);
    const read = await call("GET", "/notifications/email-connection", "tok-a");
    expect(read.body).not.toContain(STORE_API_KEY);
    expect(read.json()).toMatchObject({ connection: { secretLast4: STORE_API_KEY.slice(-4) } });
  });

  it("a refused test is saved as failed with the provider's sanitized message: no key, no address", async () => {
    expect.hasAssertions();
    mail.provider.failNext(
      "EMAIL_SENDER_REJECTED",
      `The merchant.test domain is not verified (to owner@merchant.test, key ${STORE_API_KEY})`,
    );
    const res = await put(connect);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      connection: { status: "failed", state: "failed", verifiedAt: null },
    });
    expect(res.body).toContain("domain is not verified");
    expect(res.body).not.toContain(STORE_API_KEY);
    expect(res.body).not.toContain("owner@merchant.test");
  });

  it("answers 503 NOT_CONFIGURED 'Not available yet' while the server has no KEK, and stores nothing", async () => {
    expect.hasAssertions();
    await app.close();
    await boot({ vault: false });
    const read = await call("GET", "/notifications/email-connection", "tok-a");
    expect(read.json()).toEqual({
      credentialsConfigured: false,
      smtpAvailable: false,
      connection: null,
    });
    const res = await put(connect);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: "NOT_CONFIGURED", message: "Not available yet" });
    expect(mail.provider.calls).toHaveLength(0);
  });

  it("validates before anything is sent: 422 naming the field, never the key", async () => {
    expect.hasAssertions();
    for (const bad of [
      { fromEmail: "nope" },
      { apiKey: "not-a-resend-key" },
      { kind: "sendgrid" },
      { fromEmail: "" },
    ]) {
      const res = await put({ ...connect, ...bad });
      expect(res.statusCode).toBe(422);
      expect(res.body).not.toContain(STORE_API_KEY);
      expect(res.body).not.toContain("not-a-resend-key");
    }
    expect(mail.provider.calls).toHaveLength(0);
  });

  it("the body is strict: an unknown field (including a recipient) is 422", async () => {
    expect.hasAssertions();
    expect((await put({ ...connect, to: "victim@example.com" })).statusCode).toBe(422);
    expect((await put({ ...connect, status: "connected" })).statusCode).toBe(422);
    const test = await call("POST", "/notifications/email-connection/test", "tok-a", {
      to: "victim@example.com",
    });
    expect(test.statusCode).toBe(422);
  });

  it("answers 409 on a stale version and never overwrites", async () => {
    expect.hasAssertions();
    expect((await put(connect)).statusCode).toBe(200);
    const stale = await put(connect);
    expect(stale.statusCode).toBe(409);
    const fresh = await put({ ...connect, expectedVersion: 1, apiKey: null });
    expect(fresh.statusCode).toBe(200);
    expect(fresh.json()).toMatchObject({ connection: { version: 2 } });
  });

  it("a staff member with no address of their own gets 422: the test mail is never sent to anyone else", async () => {
    expect.hasAssertions();
    const res = await put(connect, "tok-noaddr");
    expect(res.statusCode).toBe(422);
    expect(mail.provider.calls).toHaveLength(0);
  });

  it("'Send test' re-tests through the stored key; the switch turns it off and on; disconnect deletes it", async () => {
    expect.hasAssertions();
    await put(connect);
    mail.provider.calls.length = 0;
    const test = await call("POST", "/notifications/email-connection/test", "tok-a", {});
    expect(test.statusCode).toBe(200);
    expect(test.json()).toMatchObject({ connection: { status: "connected", version: 2 } });
    expect(mail.provider.calls[0]?.credentials.apiKey).toBe(STORE_API_KEY);

    const off = await call("POST", "/notifications/email-connection/enabled", "tok-a", {
      enabled: false,
      expectedVersion: 2,
    });
    expect(off.json()).toMatchObject({ connection: { enabled: false, state: "disabled" } });
    const settings = await call("GET", "/notifications/settings", "tok-a");
    expect(settings.json()).toMatchObject({
      deliveryConfigured: false,
      emailConnection: "disabled",
    });
    const on = await call("POST", "/notifications/email-connection/enabled", "tok-a", {
      enabled: true,
      expectedVersion: 3,
    });
    expect(on.json()).toMatchObject({ connection: { enabled: true, state: "connected" } });
    expect((await call("GET", "/notifications/settings", "tok-a")).json()).toMatchObject({
      deliveryConfigured: true,
      emailConnection: "connected",
      sender: { mode: "store_connection", effectiveEmail: "shop@merchant.test" },
    });

    const removed = await call("DELETE", "/notifications/email-connection", "tok-a");
    expect(removed.json()).toEqual({
      credentialsConfigured: true,
      smtpAvailable: false,
      connection: null,
    });
    expect((await call("GET", "/notifications/settings", "tok-a")).json()).toMatchObject({
      deliveryConfigured: false,
      emailConnection: "none",
    });
    expect(mail.platformMail).toHaveLength(0);
  });

  it("'Send test' and saving share an hourly budget: 429 with retry-after, fail-closed when the limiter errors", async () => {
    expect.hasAssertions();
    for (const mode of ["deny", "throw"] as const) {
      await app.close();
      await boot({ budget: mode });
      const saved = await put(connect);
      expect(saved.statusCode, mode).toBe(429);
      expect(saved.headers["retry-after"]).toBeDefined();
      const tested = await call("POST", "/notifications/email-connection/test", "tok-a", {});
      expect(tested.statusCode, mode).toBe(429);
      expect(fx.consumed[0]).toBe("rl:tenant-a:email-connection-test");
      expect(mail.provider.calls).toHaveLength(0);
    }
  });

  it("keeps one store's connection out of another's", async () => {
    expect.hasAssertions();
    await put(connect);
    const other = await call("GET", "/notifications/email-connection", "tok-b");
    expect(other.json()).toEqual({
      credentialsConfigured: true,
      smtpAvailable: false,
      connection: null,
    });
    const settings = await call("GET", "/notifications/settings", "tok-b");
    expect(settings.json()).toMatchObject({ deliveryConfigured: false, emailConnection: "none" });
    const off = await call("POST", "/notifications/email-connection/enabled", "tok-b", {
      enabled: false,
      expectedVersion: 1,
    });
    expect(off.statusCode).toBe(404);
    await call("DELETE", "/notifications/email-connection", "tok-b");
    expect((await call("GET", "/notifications/email-connection", "tok-a")).json()).toMatchObject({
      connection: { status: "connected" },
    });
  });

  it("the read never carries the key or the sealed blob, whoever reads it", async () => {
    expect.hasAssertions();
    await put(connect);
    for (const token of ["tok-a", "tok-op"]) {
      const read = await call("GET", "/notifications/email-connection", token);
      expect(read.statusCode).toBe(200);
      expect(read.body).not.toContain(STORE_API_KEY);
      expect(read.body).not.toContain("sealed");
      expect(read.body).not.toContain("ciphertext");
    }
  });

  it("declares settings:read for the read and settings:update for every change (admin-only in the role table)", () => {
    expect.hasAssertions();
    const permissions = Object.fromEntries(
      emailConnectionRoutes({} as never).map((route) => [
        `${route.method} ${route.path}`,
        route.permission,
      ]),
    );
    expect(permissions).toEqual({
      "GET /notifications/email-connection": "settings:read",
      "PUT /notifications/email-connection": "settings:update",
      "DELETE /notifications/email-connection": "settings:update",
      "POST /notifications/email-connection/test": "settings:update",
      "POST /notifications/email-connection/enabled": "settings:update",
    });
    expect(
      [...ROLE_PERMISSIONS.operator, ...ROLE_PERMISSIONS.viewer].some((granted) =>
        permissionMatches(granted, "settings:update"),
      ),
    ).toBe(false);
  });

  it("template test-send goes through the STORE's account, never the platform's; with none it is 503 EMAIL_NOT_CONNECTED", async () => {
    expect.hasAssertions();
    const before = await call("POST", "/notifications/templates/order_confirmation/test", "tok-a", {
      locale: "en",
    });
    expect(before.statusCode).toBe(503);
    expect(before.json()).toMatchObject({ code: "EMAIL_NOT_CONNECTED" });
    expect(mail.provider.calls).toHaveLength(0);

    await put(connect);
    mail.provider.calls.length = 0;
    const sent = await call("POST", "/notifications/templates/order_confirmation/test", "tok-a", {
      locale: "en",
    });
    expect(sent.statusCode).toBe(200);
    expect(mail.provider.calls).toHaveLength(1);
    expect(mail.provider.calls[0]?.credentials.apiKey).toBe(STORE_API_KEY);
    expect(mail.provider.calls[0]?.message).toMatchObject({ to: "owner@merchant.test" });
    expect(mail.provider.calls[0]?.message.subject.startsWith("[Test] ")).toBe(true);
    expect(mail.platformMail).toHaveLength(0);

    mail.provider.failNext("EMAIL_RATE_LIMITED", "Too many requests");
    const limited = await call(
      "POST",
      "/notifications/templates/order_confirmation/test",
      "tok-a",
      {
        locale: "en",
      },
    );
    expect(limited.statusCode).toBe(502);
    expect(limited.json()).toMatchObject({ code: "PROVIDER_ERROR", retryable: true });
    expect(mail.platformMail).toHaveLength(0);
  });

  it("customer sign-up mails go through the store's account; without one sign-up is 503 EMAIL_NOT_CONNECTED (D51)", async () => {
    expect.hasAssertions();
    const storefront = { "x-tenant-id": "tenant-a", "content-type": "application/json" };
    const register = (email: string) =>
      app.inject({
        method: "POST",
        url: "/api/v1/public/auth/register",
        headers: storefront,
        payload: { email, name: "Sam", password: "correct-horse-battery" },
      });

    const refused = await register("sam@customer.test");
    expect(refused.statusCode).toBe(503);
    expect(refused.json()).toEqual({
      code: "EMAIL_NOT_CONNECTED",
      message: "Sign-up by email isn't available for this store yet",
      retryable: false,
      fields: [],
    });
    expect(mail.provider.calls).toHaveLength(0);
    expect(mail.platformMail).toHaveLength(0);

    await put(connect);
    mail.provider.calls.length = 0;
    expect((await register("sam@customer.test")).statusCode).toBe(201);
    // The same email again: the "you already have an account" mail, from the store's own account.
    expect((await register("sam@customer.test")).statusCode).toBe(202);
    expect(mail.provider.calls).toHaveLength(1);
    expect(mail.provider.calls[0]?.credentials.apiKey).toBe(STORE_API_KEY);
    expect(mail.provider.calls[0]?.message).toMatchObject({ to: "sam@customer.test" });
    expect(mail.provider.calls[0]?.message.from).toContain("<shop@merchant.test>");
    expect(mail.platformMail).toHaveLength(0);

    // Another store has no connection of its own: still refused.
    const other = await app.inject({
      method: "POST",
      url: "/api/v1/public/auth/register",
      headers: { ...storefront, "x-tenant-id": "tenant-b" },
      payload: { email: "sam@customer.test", name: "Sam", password: "correct-horse-battery" },
    });
    expect(other.statusCode).toBe(503);
  });

  describe("mailbox (SMTP) connection behind EMAIL_SMTP_ENABLED", () => {
    const gmail = {
      kind: "smtp",
      fromEmail: "Shop@Gmail.com",
      smtp: { preset: "gmail", username: "shop@gmail.com" },
      password: "abcd efgh ijkl mnop",
    };

    it("flag off: PUT kind smtp answers 503 NOT_CONFIGURED, stores nothing, GET says smtpAvailable false", async () => {
      expect.hasAssertions();
      const res = await put(gmail);
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ code: "NOT_CONFIGURED" });
      expect(res.body).not.toContain("abcdefghijklmnop");
      expect(res.body).not.toContain("abcd efgh");
      expect(mail.provider.calls).toHaveLength(0);
      expect(mail.platformMail).toHaveLength(0);
      const read = await call("GET", "/notifications/email-connection", "tok-a");
      expect(read.json()).toEqual({
        credentialsConfigured: true,
        smtpAvailable: false,
        connection: null,
      });
    });

    it("flag on: connects through the store's mailbox (not the platform's), answers no password", async () => {
      expect.hasAssertions();
      await app.close();
      await boot({ smtp: true });
      const res = await put(gmail);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        smtpAvailable: true,
        connection: {
          kind: "smtp",
          fromEmail: "shop@gmail.com",
          secretLast4: "",
          status: "connected",
          state: "connected",
          smtp: {
            preset: "gmail",
            host: "smtp.gmail.com",
            port: 465,
            security: "tls",
            username: "shop@gmail.com",
          },
        },
      });
      expect(res.body).not.toContain("abcdefghijklmnop");
      expect(mail.provider.calls).toHaveLength(1);
      expect(mail.provider.calls[0]?.credentials).toMatchObject({
        kind: "smtp",
        apiKey: "abcdefghijklmnop",
        smtp: { host: "smtp.gmail.com" },
      });
      expect(mail.provider.calls[0]?.message.to).toBe("owner@merchant.test");
      // Spy proof: Morbeh's own sender sent nothing for the store's mailbox.
      expect(mail.platformMail).toHaveLength(0);
      const read = await call("GET", "/notifications/email-connection", "tok-a");
      expect(read.body).not.toContain("abcdefghijklmnop");
    });

    it("a refused mailbox login is saved as failed with its fixed code, never the server's text or the password", async () => {
      expect.hasAssertions();
      await app.close();
      await boot({ smtp: true });
      mail.provider.failNext(
        "EMAIL_AUTH_FAILED",
        "AUTH_FAILED: The mail server didn't accept the username or password. abcdefghijklmnop",
      );
      const res = await put(gmail);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        connection: { status: "failed", state: "failed", lastErrorCode: "AUTH_FAILED" },
      });
      expect(res.body).not.toContain("abcdefghijklmnop");
      expect(mail.platformMail).toHaveLength(0);
    });

    it("validation: a mailbox From that is not the username, or a private host, is 422 naming the field", async () => {
      expect.hasAssertions();
      await app.close();
      await boot({ smtp: true });
      const wrongFrom = await put({ ...gmail, fromEmail: "orders@gmail.com" });
      expect(wrongFrom.statusCode).toBe(422);
      expect(JSON.stringify(wrongFrom.json())).toContain("fromEmail");
      const internal = await put({
        ...gmail,
        fromEmail: "a@b.test",
        smtp: { preset: "custom", host: "localhost", port: 25, security: "tls", username: "a" },
      });
      expect(internal.statusCode).toBe(422);
      expect(JSON.stringify(internal.json())).toContain("smtp.host");
      const stray = await put({ ...gmail, smtp: { ...gmail.smtp, password: "x" } });
      expect(stray.statusCode).toBe(422);
      expect(mail.provider.calls).toHaveLength(0);
    });
  });
});
