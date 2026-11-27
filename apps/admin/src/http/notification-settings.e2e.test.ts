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
import { notificationSettingsRoutes } from "./notification-settings-routes";
import { createAdminHttpApi } from "./server";
import { STORE_API_KEY, storeEmailHarness } from "./testing/store-email-harness";

/**
 * Wave 2b/2b2: Settings > Notifications over the REAL admin pipeline (`createAdminHttpApi`, multi-tenant,
 * real permission guard and error mapping), exactly as the admin page calls it.
 */

const clock: Clock = { now: () => new Date("2026-11-26T00:00:00.000Z") };
const admin: AuthenticatedIdentity = { id: "staff-1", kind: "staff", roles: ["admin"] };
const noAddress: AuthenticatedIdentity = { id: "staff-2", kind: "staff", roles: ["admin"] };
const sessions: Record<string, AuthenticatedContext> = {
  "tok-a": { principal: admin, claims: { tenant_id: "tenant-a" } },
  "tok-b": { principal: admin, claims: { tenant_id: "tenant-b" } },
  "tok-noaddr": { principal: noAddress, claims: { tenant_id: "tenant-a" } },
};

type Fixture = ReturnType<typeof infra>;

function infra(testEmailBudget: "allow" | "deny" | "throw") {
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
      if (key.includes("notification-test-email")) {
        consumed.push(key);
        if (testEmailBudget === "throw") throw new Error("redis down");
        if (testEmailBudget === "deny")
          return { allowed: false, remaining: 0, retryAfterMs: 1_800_000 };
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

async function build(fx: Fixture, extra: Record<string, unknown> = {}): Promise<FastifyInstance> {
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
    ...extra,
  });
}

const headers = (token: string) => ({
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
});

describe("notification settings routes (Wave 2b)", () => {
  let app: FastifyInstance;
  let fx: Fixture;

  beforeEach(async () => {
    fx = infra("allow");
    app = await build(fx);
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

  it("reads the defaults (not connected: deliveryConfigured false, the banner case) and saves with a version", async () => {
    expect.hasAssertions();
    const read = await call("GET", "/notifications/settings", "tok-a");
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({
      version: null,
      deliveryConfigured: false,
      emailConnection: "none",
      values: { senderEmail: null, staffRecipients: [], disabledTemplates: [] },
      sender: { mode: "not_connected", effectiveEmail: null },
    });

    const saved = await call("POST", "/notifications/settings", "tok-a", {
      senderEmail: "Hello@Shop.com",
      staffRecipients: ["me@shop.com"],
      disabledTemplates: ["order_canceled"],
      expectedVersion: null,
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      version: 1,
      values: { senderEmail: "hello@shop.com", disabledTemplates: ["order_canceled"] },
      sender: { mode: "not_connected", effectiveEmail: null },
    });
  });

  it("answers 409 on a stale version and 422 on an invalid document, naming the field", async () => {
    expect.hasAssertions();
    const body = {
      senderEmail: null,
      staffRecipients: [],
      disabledTemplates: [],
      expectedVersion: null,
    };
    expect((await call("POST", "/notifications/settings", "tok-a", body)).statusCode).toBe(200);
    const stale = await call("POST", "/notifications/settings", "tok-a", {
      ...body,
      senderEmail: "x@y.com",
    });
    expect(stale.statusCode).toBe(409);
    const invalid = await call("POST", "/notifications/settings", "tok-a", {
      ...body,
      expectedVersion: 1,
      senderEmail: "nope",
    });
    expect(invalid.statusCode).toBe(422);
    expect(JSON.stringify(invalid.json())).toContain("senderEmail");
    const unknownKey = await call("POST", "/notifications/settings", "tok-a", {
      ...body,
      extra: 1,
    });
    expect(unknownKey.statusCode).toBe(422);
  });

  it("keeps one store's settings and templates out of another's", async () => {
    expect.hasAssertions();
    await call("POST", "/notifications/settings", "tok-a", {
      senderEmail: "a@a-shop.com",
      staffRecipients: [],
      disabledTemplates: [],
      expectedVersion: null,
    });
    await call("PUT", "/notifications/templates/order_canceled/en", "tok-a", {
      subject: "A only",
      body: "A only body",
    });
    const other = await call("GET", "/notifications/settings", "tok-b");
    expect(other.json()).toMatchObject({ version: null, values: { senderEmail: null } });
    const templates = await call("GET", "/notifications/templates/order_canceled/en", "tok-b");
    expect(templates.json()).toMatchObject({ locales: { en: { customized: false } } });
  });

  it("lists the templates, saves an override, previews a draft and reverts to the default", async () => {
    expect.hasAssertions();
    const list = await call("GET", "/notifications/templates", "tok-a");
    expect(list.statusCode).toBe(200);
    expect((list.json() as { templates: { key: string }[] }).templates.map((t) => t.key)).toContain(
      "staff_new_order",
    );

    const saved = await call("PUT", "/notifications/templates/order_confirmation/ar", "tok-a", {
      subject: "طلب {{order_number}}",
      body: "مرحبا {{customer_name}} {{bogus}}",
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ locales: { ar: { customized: true } } });

    const preview = await call(
      "POST",
      "/notifications/templates/order_confirmation/preview",
      "tok-a",
      {
        locale: "ar",
        body: "<script>alert(1)</script> {{customer_name}} {{nope}}",
        subject: "S {{order_number}}",
      },
    );
    expect(preview.statusCode).toBe(200);
    const rendered = preview.json() as {
      subject: string;
      html: string;
      unknownVariables: string[];
    };
    expect(rendered.subject).toBe("S #1042");
    expect(rendered.html).not.toContain("<script>");
    expect(rendered.unknownVariables).toEqual(["nope"]);

    const reverted = await call(
      "DELETE",
      "/notifications/templates/order_confirmation/ar",
      "tok-a",
    );
    expect(reverted.statusCode).toBe(200);
    expect(reverted.json()).toMatchObject({ locales: { ar: { customized: false } } });
  });

  it("refuses an unknown template and an unknown language with 422", async () => {
    expect.hasAssertions();
    expect((await call("GET", "/notifications/templates/nope/en", "tok-a")).statusCode).toBe(422);
    expect(
      (await call("GET", "/notifications/templates/order_canceled/fr", "tok-a")).statusCode,
    ).toBe(422);
    expect(
      (
        await call("PUT", "/notifications/templates/order_canceled/en", "tok-a", {
          subject: "x".repeat(201),
          body: "ok",
        })
      ).statusCode,
    ).toBe(422);
  });

  it("declares settings:read for reads and settings:update for every change and the test mail (both admin-only in the role table)", () => {
    expect.hasAssertions();
    const permissions = Object.fromEntries(
      notificationSettingsRoutes({} as never).map((route) => [
        `${route.method} ${route.path}`,
        route.permission,
      ]),
    );
    expect(permissions).toEqual({
      "GET /notifications/settings": "settings:read",
      "POST /notifications/settings": "settings:update",
      "GET /notifications/templates": "settings:read",
      "GET /notifications/templates/:key/:locale": "settings:read",
      "PUT /notifications/templates/:key/:locale": "settings:update",
      "DELETE /notifications/templates/:key/:locale": "settings:update",
      "POST /notifications/templates/:key/preview": "settings:read",
      "POST /notifications/templates/:key/test": "settings:update",
    });
    expect(
      [...ROLE_PERMISSIONS.operator, ...ROLE_PERMISSIONS.viewer].some((granted) =>
        permissionMatches(granted, "settings:update"),
      ),
    ).toBe(false);
  });

  it("test send: 503 EMAIL_NOT_CONNECTED while the store has no email account, with no recipient field accepted", async () => {
    expect.hasAssertions();
    const res = await call("POST", "/notifications/templates/order_confirmation/test", "tok-a", {
      locale: "en",
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: "EMAIL_NOT_CONNECTED" });
    const withRecipient = await call(
      "POST",
      "/notifications/templates/order_confirmation/test",
      "tok-a",
      {
        to: "victim@example.com",
      },
    );
    expect(withRecipient.statusCode).toBe(422);
  });

  it("test send: 429 with retry-after when the hourly budget is spent, and fail-closed when the limiter errors", async () => {
    expect.hasAssertions();
    for (const mode of ["deny", "throw"] as const) {
      const local = infra(mode);
      const api = await build(local);
      const res = await api.inject({
        method: "POST",
        url: "/api/v1/notifications/templates/order_confirmation/test",
        headers: headers("tok-a"),
        payload: {},
      });
      expect(res.statusCode, mode).toBe(429);
      expect(res.headers["retry-after"]).toBeDefined();
      expect(local.consumed).toEqual(["rl:tenant-a:notification-test-email"]);
      await api.close();
    }
  });

  it("test send: a staff member with no resolvable address of their own gets 422, never someone else's mail", async () => {
    expect.hasAssertions();
    const local = infra("allow");
    const mail = await storeEmailHarness({
      tenantId: "tenant-a",
      staffId: "staff-1",
      staffEmail: "owner@shop.test",
      clock,
    });
    const api = await build(local, { ...mail.deps });
    const connected = await api.inject({
      method: "PUT",
      url: "/api/v1/notifications/email-connection",
      headers: headers("tok-a"),
      payload: {
        kind: "resend",
        fromEmail: "shop@shop.test",
        apiKey: STORE_API_KEY,
        expectedVersion: null,
      },
    });
    expect(connected.statusCode).toBe(200);
    mail.storeMail.length = 0;
    const res = await api.inject({
      method: "POST",
      url: "/api/v1/notifications/templates/order_confirmation/test",
      headers: headers("tok-noaddr"),
      payload: {},
    });
    expect(res.statusCode).toBe(422);
    expect(mail.storeMail).toHaveLength(0);
    expect(mail.platformMail).toHaveLength(0);
    await api.close();
  });

  it("reports deliveryConfigured true only when the store has a connected, switched-on email account", async () => {
    expect.hasAssertions();
    const local = infra("allow");
    const mail = await storeEmailHarness({
      tenantId: "tenant-a",
      staffId: "staff-1",
      staffEmail: "owner@shop.test",
      clock,
    });
    // The platform's own sender being configured does NOT make delivery configured.
    const api = await build(local, { ...mail.deps });
    const read = () =>
      api.inject({
        method: "GET",
        url: "/api/v1/notifications/settings",
        headers: headers("tok-a"),
      });
    expect((await read()).json()).toMatchObject({ deliveryConfigured: false });
    await api.inject({
      method: "PUT",
      url: "/api/v1/notifications/email-connection",
      headers: headers("tok-a"),
      payload: {
        kind: "resend",
        fromEmail: "shop@shop.test",
        apiKey: STORE_API_KEY,
        expectedVersion: null,
      },
    });
    expect((await read()).json()).toMatchObject({
      deliveryConfigured: true,
      emailConnection: "connected",
      sender: { mode: "store_connection", effectiveEmail: "shop@shop.test" },
    });
    await api.close();
  });
});
