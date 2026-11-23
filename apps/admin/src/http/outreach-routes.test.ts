import { createHmac } from "node:crypto";
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type {
  AuthenticatedIdentity,
  Authenticator,
  Cache,
  ClaimsAuthenticator,
  Clock,
  IdempotencyKeyStore,
  RateLimiter,
} from "@platform/contracts";
import { RoleTableAccessControl } from "@platform/auth";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { defineRoute, type RequestContext, type TenantGate } from "@platform/http";
import type { MetaTemplateRecord } from "@platform/outreach";
import { FakeEmailPort, FakeVault, FakeWhatsAppPort } from "@platform/outreach/testing/fake-ports";
import { InMemoryAuditTrail } from "../infrastructure/in-memory-audit-trail";
import type { WiredAdmin } from "../composition";
import { outreachRoutes } from "./outreach-routes";
import { createAdminHttpApi, type AdminHttpDeps } from "./server";

const clock: Clock = { now: () => new Date("2026-11-20T10:00:00.000Z") };
const PLATFORM = "t-platform";
const SHOP = "t-1";
const APP_SECRET = "app-secret-0123456789";
const VERIFY_TOKEN = "verify-token-0123456789";
// The numeric asset ids Embedded Signup returns (the fake port lists PHONE under the shop's WABA).
const WABA = "200000000001";
const PHONE = "100000000001";
// Digits are assembled so no literal phone number sits in the source.
const BUYER_DIGITS = ["20", "10", "12345679"].join("");
const BUYER = `+${BUYER_DIGITS}`;
const SIGNUP = { appId: "1234567890", configId: "cfg-42", graphApiVersion: "v24.0" } as const;

type Mode = "single" | "multi";

interface Harness {
  readonly app: FastifyInstance;
  /** Forgets every HTTP response snapshot and in-flight claim (a cold cache / an evicted snapshot). */
  clearHttpCaches(): void;
  readonly whatsapp: FakeWhatsAppPort;
  readonly email: FakeEmailPort;
  /** Headers for an authenticated staff request of `role` against `tenant`. */
  as(role: string, tenant?: string): Record<string, string>;
}

let sequence = 0;

async function buildHarness(
  mode: Mode,
  options: { configured?: boolean; gate?: TenantGate; verifyToken?: string } = {},
): Promise<Harness> {
  const configured = options.configured ?? true;
  const whatsapp = new FakeWhatsAppPort();
  const email = new FakeEmailPort();
  const cacheData = new Map<string, unknown>();
  const cache: Cache = {
    get: <T>(key: string) => Promise.resolve((cacheData.get(key) as T | undefined) ?? null),
    set: (key, value) => {
      cacheData.set(key, JSON.parse(JSON.stringify(value)));
      return Promise.resolve();
    },
    delete: (key) => {
      cacheData.delete(key);
      return Promise.resolve();
    },
    has: (key) => Promise.resolve(cacheData.has(key)),
  };
  const claims = new Set<string>();
  const idempotencyKeys: IdempotencyKeyStore = {
    claim: (key) => {
      if (claims.has(key)) return Promise.resolve(null);
      claims.add(key);
      return Promise.resolve({
        key,
        token: "t",
        release: () => Promise.resolve(claims.delete(key)),
      });
    },
  };
  const rateLimiter: RateLimiter = {
    consume: () => Promise.resolve({ allowed: true, remaining: 99, retryAfterMs: 0 }),
  };
  const roles = new Set(["admin", "operator", "viewer", "customer"]);
  const identity = (role: string): AuthenticatedIdentity => ({
    id: `${role}-1`,
    kind: role === "customer" ? "customer" : "staff",
    roles: [role],
  });
  // Single mode: bearer = role, tenant pinned. Multi mode: bearer = `role@tenant`, the tenant is a verified claim.
  const authenticator: Authenticator & ClaimsAuthenticator = {
    verify: (token) => Promise.resolve(roles.has(token) ? identity(token) : null),
    verifyWithClaims: (token) => {
      const [role = "", tenant = ""] = token.split("@");
      return Promise.resolve(
        roles.has(role) && tenant !== ""
          ? { principal: identity(role), claims: { tenant_id: tenant } }
          : null,
      );
    },
  };
  const deps: AdminHttpDeps = {
    serializer: new InMemoryEventSerializer(),
    idGenerator: { generate: () => crypto.randomUUID() },
    clock,
    auditTrail: new InMemoryAuditTrail(),
    authenticator: mode === "single" ? { verify: authenticator.verify } : authenticator,
    accessControl: new RoleTableAccessControl(),
    rateLimiter,
    idempotencyKeys,
    responseCache: cache,
    tenantId: mode === "single" ? SHOP : PLATFORM,
    ...(mode === "multi"
      ? {
          tenantMode: "multi" as const,
          tenantGate:
            options.gate ?? ({ availability: async () => "active" as const } satisfies TenantGate),
        }
      : {}),
    outreach: configured
      ? {
          whatsapp,
          vault: new FakeVault(),
          email,
          emailFrom: "no-reply@morbeh.test",
          randomPin: () => "654321",
          signup: SIGNUP,
          webhook: { appSecret: APP_SECRET, verifyToken: options.verifyToken ?? VERIFY_TOKEN },
        }
      : {},
  };
  const app = await createAdminHttpApi(deps);
  return {
    app,
    clearHttpCaches: () => {
      cacheData.clear();
      claims.clear();
    },
    whatsapp,
    email,
    as: (role, tenant = SHOP): Record<string, string> =>
      mode === "single"
        ? { authorization: `Bearer ${role}`, "x-tenant-id": SHOP }
        : { authorization: `Bearer ${role}@${tenant}` },
  };
}

function sign(body: string, secret = APP_SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function key(): string {
  sequence += 1;
  return `key-${sequence}`;
}

const approvedTemplate: MetaTemplateRecord = {
  id: "meta-1",
  name: "order_shipped",
  language: "en",
  category: "UTILITY",
  status: "APPROVED",
  components: [
    {
      type: "BODY",
      text: "Hello {{1}}, your order is on its way",
      example: { body_text: [["Sara"]] },
    },
  ],
  rejectedReason: null,
  qualityScore: null,
};

async function connect(h: Harness, headers = h.as("admin")) {
  return h.app.inject({
    method: "POST",
    url: "/api/v1/outreach/whatsapp/connect",
    headers: { ...headers, "idempotency-key": key() },
    payload: { code: "auth-code", wabaId: WABA, phoneNumberId: PHONE },
  });
}

const apps: FastifyInstance[] = [];
async function fresh(mode: Mode, options: Parameters<typeof buildHarness>[1] = {}) {
  const h = await buildHarness(mode, options);
  apps.push(h.app);
  return h;
}
afterEach(async () => {
  while (apps.length > 0) await apps.pop()?.close();
});

describe.each<Mode>(["single", "multi"])("outreach routes (%s mode)", (mode) => {
  let h: Harness;
  beforeAll(async () => {
    h = await buildHarness(mode);
  });
  afterAll(async () => {
    await h.app.close();
  });

  describe("permissions: every route", () => {
    const merchant: ReadonlyArray<{
      name: string;
      method: "GET" | "POST" | "DELETE";
      url: string;
      payload?: unknown;
      need: "read" | "manage" | "send";
    }> = [
      { name: "GET whatsapp", method: "GET", url: "/outreach/whatsapp", need: "read" },
      {
        name: "POST connect",
        method: "POST",
        url: "/outreach/whatsapp/connect",
        payload: { code: "c", wabaId: WABA, phoneNumberId: PHONE },
        need: "manage",
      },
      { name: "POST refresh", method: "POST", url: "/outreach/whatsapp/refresh", need: "manage" },
      {
        name: "POST disconnect",
        method: "POST",
        url: "/outreach/whatsapp/disconnect",
        payload: { expectedVersion: 0 },
        need: "manage",
      },
      {
        name: "POST abandon",
        method: "POST",
        url: "/outreach/whatsapp/onboarding/abandon",
        payload: { expectedVersion: 0 },
        need: "manage",
      },
      { name: "GET templates", method: "GET", url: "/outreach/whatsapp/templates", need: "read" },
      {
        name: "POST templates/sync",
        method: "POST",
        url: "/outreach/whatsapp/templates/sync",
        need: "manage",
      },
      {
        name: "POST templates",
        method: "POST",
        url: "/outreach/whatsapp/templates",
        payload: {
          name: "promo_one",
          language: "en",
          category: "MARKETING",
          body: { text: "Hi {{1}}", examples: ["Sara"] },
        },
        need: "manage",
      },
      {
        name: "DELETE template",
        method: "DELETE",
        url: "/outreach/whatsapp/templates/promo_one",
        need: "manage",
      },
      {
        name: "POST test-send",
        method: "POST",
        url: "/outreach/whatsapp/test-send",
        payload: {
          to: "+201012345678",
          templateName: "order_shipped",
          language: "en",
          values: { body: ["Sara"] },
        },
        need: "send",
      },
      { name: "GET email", method: "GET", url: "/outreach/email", need: "read" },
      {
        name: "POST email/test-send",
        method: "POST",
        url: "/outreach/email/test-send",
        payload: { to: "owner@example.com" },
        need: "send",
      },
    ];
    const allowed: Readonly<Record<string, ReadonlySet<string>>> = {
      admin: new Set(["read", "manage", "send"]),
      operator: new Set(["read", "send"]),
      viewer: new Set(["read"]),
    };

    it.each(merchant)("$name needs outreach:$need", async (route) => {
      expect.hasAssertions();
      for (const role of ["admin", "operator", "viewer"]) {
        const res = await h.app.inject({
          method: route.method,
          url: `/api/v1${route.url}`,
          headers: { ...h.as(role), "idempotency-key": key() },
          ...(route.payload === undefined ? {} : { payload: route.payload as object }),
        });
        if (allowed[role]?.has(route.need) === true) {
          expect(res.statusCode, `${role} ${route.name}`).not.toBe(403);
          expect(res.statusCode, `${role} ${route.name}`).toBeLessThan(500);
        } else {
          expect(res.statusCode, `${role} ${route.name}`).toBe(403);
        }
      }
      const customer = await h.app.inject({
        method: route.method,
        url: `/api/v1${route.url}`,
        headers: { ...h.as("customer"), "idempotency-key": key() },
        ...(route.payload === undefined ? {} : { payload: route.payload as object }),
      });
      expect(customer.statusCode).toBe(403);
    });

    it("an unauthenticated caller is refused on every merchant route (401)", async () => {
      expect.hasAssertions();
      for (const route of merchant) {
        const res = await h.app.inject({
          method: route.method,
          url: `/api/v1${route.url}`,
          headers: mode === "single" ? { "x-tenant-id": SHOP } : {},
        });
        expect(res.statusCode, route.name).toBe(401);
      }
    });
  });

  describe("422 on a bad body", () => {
    const cases: ReadonlyArray<readonly [string, string, unknown]> = [
      ["connect without a code", "/outreach/whatsapp/connect", { wabaId: "w", phoneNumberId: "p" }],
      [
        "connect with a nonnumeric waba id",
        "/outreach/whatsapp/connect",
        { code: "c", wabaId: "waba-one", phoneNumberId: "456" },
      ],
      [
        "connect with a nonnumeric phone id",
        "/outreach/whatsapp/connect",
        { code: "c", wabaId: "123", phoneNumberId: "12a" },
      ],
      [
        "connect with a 65-digit phone id",
        "/outreach/whatsapp/connect",
        { code: "c", wabaId: "123", phoneNumberId: "9".repeat(65) },
      ],
      [
        "connect with a 65-digit waba id",
        "/outreach/whatsapp/connect",
        { code: "c", wabaId: "9".repeat(65), phoneNumberId: "456" },
      ],
      [
        "connect with an over-long code",
        "/outreach/whatsapp/connect",
        { code: "c".repeat(8193), wabaId: "123", phoneNumberId: "456" },
      ],
      [
        "disconnect with a negative version",
        "/outreach/whatsapp/disconnect",
        { expectedVersion: -1 },
      ],
      [
        "disconnect with a fractional version",
        "/outreach/whatsapp/disconnect",
        { expectedVersion: 1.5 },
      ],
      ["abandon without a version", "/outreach/whatsapp/onboarding/abandon", {}],
      [
        "a template with an unknown category",
        "/outreach/whatsapp/templates",
        { name: "a", language: "en", category: "PROMO", body: { text: "x", examples: [] } },
      ],
      [
        "a template with an extra field",
        "/outreach/whatsapp/templates",
        {
          name: "a",
          language: "en",
          category: "UTILITY",
          body: { text: "x", examples: [] },
          evil: 1,
        },
      ],
      [
        "a test send with the old `variables` shape",
        "/outreach/whatsapp/test-send",
        { to: "+201012345678", templateName: "t", language: "en", variables: ["a"] },
      ],
      [
        "a test send with more than 10 body values",
        "/outreach/whatsapp/test-send",
        {
          to: "+201012345678",
          templateName: "t",
          language: "en",
          values: { body: Array.from({ length: 11 }, () => "x") },
        },
      ],
      ["an email test with a bad address", "/outreach/email/test-send", { to: "not-an-email" }],
    ];
    it.each(cases)("%s", async (_name, url, payload) => {
      expect.hasAssertions();
      const res = await h.app.inject({
        method: "POST",
        url: `/api/v1${url}`,
        headers: { ...h.as("admin"), "idempotency-key": key() },
        payload: payload as object,
      });
      expect(res.statusCode).toBe(422);
      expect(res.json<{ code: string }>().code).toBe("VALIDATION");
    });
  });

  describe("public webhook: verification challenge (GET)", () => {
    const verify = (query: Record<string, string>, headers: Record<string, string> = {}) =>
      h.app.inject({
        method: "GET",
        url: `/api/v1/public/outreach/whatsapp/webhook?${new URLSearchParams(query).toString()}`,
        headers,
      });

    it("answers the raw challenge as text/plain with no auth and no x-tenant-id", async () => {
      expect.hasAssertions();
      const res = await verify({
        "hub.mode": "subscribe",
        "hub.verify_token": VERIFY_TOKEN,
        "hub.challenge": "123456",
      });
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe("123456");
      expect(res.headers["content-type"]).toContain("text/plain");
    });

    it("a forged x-tenant-id changes nothing", async () => {
      expect.hasAssertions();
      const res = await verify(
        { "hub.mode": "subscribe", "hub.verify_token": VERIFY_TOKEN, "hub.challenge": "987" },
        { "x-tenant-id": "someone-elses-shop" },
      );
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe("987");
    });

    it.each([
      [
        "a wrong token",
        { "hub.mode": "subscribe", "hub.verify_token": "nope", "hub.challenge": "1" },
      ],
      ["a missing token", { "hub.mode": "subscribe", "hub.challenge": "1" }],
      ["a missing mode", { "hub.verify_token": VERIFY_TOKEN, "hub.challenge": "1" }],
      [
        "a wrong mode",
        { "hub.mode": "unsubscribe", "hub.verify_token": VERIFY_TOKEN, "hub.challenge": "1" },
      ],
      [
        "a token of a different length (must not throw)",
        { "hub.mode": "subscribe", "hub.verify_token": `${VERIFY_TOKEN}x`, "hub.challenge": "1" },
      ],
      ["a missing challenge", { "hub.mode": "subscribe", "hub.verify_token": VERIFY_TOKEN }],
      [
        "an oversized wrong token",
        { "hub.mode": "subscribe", "hub.verify_token": "x".repeat(4000), "hub.challenge": "1" },
      ],
      [
        "an oversized challenge",
        {
          "hub.mode": "subscribe",
          "hub.verify_token": VERIFY_TOKEN,
          "hub.challenge": "1".repeat(300),
        },
      ],
    ])("403 for %s", async (_name, query) => {
      expect.hasAssertions();
      const res = await verify(query);
      expect(res.statusCode).toBe(403);
      expect(res.body).not.toContain("1");
    });

    it.each([
      [
        "a repeated token",
        "hub.mode=subscribe&hub.verify_token=nope&hub.verify_token=again&hub.challenge=1",
      ],
      [
        "a repeated right token",
        `hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=1`,
      ],
      [
        "a repeated challenge",
        `hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=1&hub.challenge=2`,
      ],
      [
        "a repeated mode",
        `hub.mode=subscribe&hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=1`,
      ],
      [
        "a bracketed (non-scalar) token",
        "hub.mode=subscribe&hub.verify_token[a]=b&hub.challenge=1",
      ],
    ])("403 (never 422) for %s", async (_name, query) => {
      expect.hasAssertions();
      const res = await h.app.inject({
        method: "GET",
        url: `/api/v1/public/outreach/whatsapp/webhook?${query}`,
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ code: "FORBIDDEN", message: "Forbidden" });
    });
  });

  describe("public webhook: signed delivery (POST)", () => {
    const post = (body: string, headers: Record<string, string>) =>
      h.app.inject({
        method: "POST",
        url: "/api/v1/public/outreach/whatsapp/webhook",
        headers: { "content-type": "application/json", ...headers },
        payload: body,
      });
    const payload = JSON.stringify({ object: "whatsapp_business_account", entry: [] });

    it("a correctly signed POST with no auth and no x-tenant-id reaches the use case: 200 {received:true}", async () => {
      expect.hasAssertions();
      const res = await post(payload, { "x-hub-signature-256": sign(payload) });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ received: true });
    });

    it("a forged x-tenant-id changes nothing", async () => {
      expect.hasAssertions();
      const res = await post(payload, {
        "x-hub-signature-256": sign(payload),
        "x-tenant-id": "someone-elses-shop",
      });
      expect(res.statusCode).toBe(200);
    });

    it("a signed, NON-canonical JSON body (whitespace, key order) is accepted: the signature covers the bytes", async () => {
      expect.hasAssertions();
      const text = '{\n  "entry" : [ ] ,\n\t"object":"whatsapp_business_account"  }';
      expect(text).not.toBe(JSON.stringify(JSON.parse(text)));
      const res = await post(text, { "x-hub-signature-256": sign(text) });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ received: true });
    });

    it.each([
      ["no signature header", {}],
      ["a malformed signature", { "x-hub-signature-256": "sha256=zz" }],
      [
        "a signature from another secret",
        { "x-hub-signature-256": sign("{ not json", "other-secret-0123456") },
      ],
    ])(
      "malformed JSON with %s is 401 (authentication first), not a parser error",
      async (_name, headers) => {
        expect.hasAssertions();
        const res = await post("{ not json", headers);
        expect(res.statusCode).toBe(401);
        expect(res.json()).toEqual({ code: "UNAUTHORIZED", message: "Unauthorized" });
      },
    );

    it("a correctly signed body that is not JSON is a 422 (decoded once, after authentication)", async () => {
      expect.hasAssertions();
      const text = "{ not json";
      const res = await post(text, { "x-hub-signature-256": sign(text) });
      expect(res.statusCode).toBe(422);
      expect(res.json<{ code: string }>().code).toBe("VALIDATION");
    });

    it.each([
      ["no signature header", {}],
      ["a malformed signature", { "x-hub-signature-256": "sha256=zz" }],
      [
        "a signature from another secret",
        { "x-hub-signature-256": sign(payload, "other-secret-0123456") },
      ],
      ["a signature of a different body", { "x-hub-signature-256": sign("{}") }],
    ])("401 for %s", async (_name, headers) => {
      expect.hasAssertions();
      const res = await post(payload, headers);
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ code: "UNAUTHORIZED", message: "Unauthorized" });
    });
  });

  describe("public webhook: transport scope", () => {
    it("a cancelled shop's x-tenant-id cannot block ingestion, while an ordinary public route still resolves the tenant", async () => {
      expect.hasAssertions();
      const gated = await fresh(mode, {
        gate: { availability: async (id) => (id === "cancelled-shop" ? "cancelled" : "active") },
      });
      const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
      const ingest = await gated.app.inject({
        method: "POST",
        url: "/api/v1/public/outreach/whatsapp/webhook",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": sign(body),
          "x-tenant-id": "cancelled-shop",
        },
        payload: body,
      });
      expect(ingest.statusCode).toBe(200);

      const ordinary = await gated.app.inject({
        method: "GET",
        url: "/api/v1/public/products",
        headers: { "x-tenant-id": "cancelled-shop" },
      });
      // Single mode has no lifecycle gate (and pins the tenant, so a foreign header is refused as unresolved);
      // multi mode refuses the cancelled shop. Either way it is NOT served.
      expect(ordinary.statusCode).toBe(403);
      const unresolved = await gated.app.inject({ method: "GET", url: "/api/v1/public/products" });
      expect(unresolved.statusCode).toBe(403);
    });
  });
});

describe("the verification token length: every token the runtime accepts passes the route", () => {
  it("a configured token longer than the old 512 cap verifies (the runtime sets no maximum), unquoted challenge", async () => {
    expect.hasAssertions();
    const token = "v".repeat(2000);
    const h = await fresh("single", { verifyToken: token });
    const res = await h.app.inject({
      method: "GET",
      url: `/api/v1/public/outreach/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=424242`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("424242");
    const wrong = await h.app.inject({
      method: "GET",
      url: `/api/v1/public/outreach/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${token}x&hub.challenge=424242`,
    });
    expect(wrong.statusCode).toBe(403);
  });
});

describe("GET /outreach/whatsapp and /outreach/email", () => {
  it("unconfigured: available:false, no signup object, and the webhook fails closed", async () => {
    expect.hasAssertions();
    const h = await fresh("single", { configured: false });
    const res = await h.app.inject({
      method: "GET",
      url: "/api/v1/outreach/whatsapp",
      headers: h.as("viewer"),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body["available"]).toBe(false);
    expect(Object.keys(body)).not.toContain("signup");

    const email = await h.app.inject({
      method: "GET",
      url: "/api/v1/outreach/email",
      headers: h.as("viewer"),
    });
    expect(email.json()).toEqual({ available: false, from: null, replyTo: null });

    const verify = await h.app.inject({
      method: "GET",
      url: "/api/v1/public/outreach/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=&hub.challenge=1",
    });
    expect(verify.statusCode).toBe(403);
    const delivery = await h.app.inject({
      method: "POST",
      url: "/api/v1/public/outreach/whatsapp/webhook",
      headers: { "content-type": "application/json", "x-hub-signature-256": sign("{}") },
      payload: "{}",
    });
    expect(delivery.statusCode).toBe(401);
  });

  it("configured: the signup object carries only {appId, configId, graphApiVersion}", async () => {
    expect.hasAssertions();
    const h = await fresh("single");
    const res = await h.app.inject({
      method: "GET",
      url: "/api/v1/outreach/whatsapp",
      headers: h.as("viewer"),
    });
    const body = res.json<{ available: boolean; signup: unknown }>();
    expect(body.available).toBe(true);
    expect(body.signup).toEqual(SIGNUP);
    expect(res.body).not.toContain(APP_SECRET);
    expect(res.body).not.toContain(VERIFY_TOKEN);

    const email = await h.app.inject({
      method: "GET",
      url: "/api/v1/outreach/email",
      headers: h.as("viewer"),
    });
    expect(email.json<{ available: boolean; from: string }>()).toMatchObject({
      available: true,
      from: expect.stringContaining("<no-reply@morbeh.test>") as string,
    });
  });
});

describe("DTOs never leak credentials", () => {
  it("no response contains sealedCredentials, accessToken or the exchanged token", async () => {
    expect.hasAssertions();
    const h = await fresh("single");
    h.whatsapp.templates = [approvedTemplate];
    const connected = await connect(h);
    expect(connected.statusCode).toBe(200);
    const bodies = [connected.body];
    for (const [method, url] of [
      ["GET", "/api/v1/outreach/whatsapp"],
      ["POST", "/api/v1/outreach/whatsapp/refresh"],
      ["POST", "/api/v1/outreach/whatsapp/templates/sync"],
      ["GET", "/api/v1/outreach/whatsapp/templates"],
    ] as const) {
      const res = await h.app.inject({
        method,
        url,
        headers: { ...h.as("admin"), "idempotency-key": key() },
      });
      expect(res.statusCode, url).toBe(200);
      bodies.push(res.body);
    }
    for (const body of bodies) {
      expect(body).not.toContain("sealedCredentials");
      expect(body).not.toContain("accessToken");
      expect(body).not.toContain("token-auth-code");
      expect(body).not.toContain("sealed:");
      expect(body).not.toContain("654321");
    }
  });
});

describe("exact 409 envelopes (feature conflicts keep the CONFLICT code with the CODE as message)", () => {
  const conflict = (message: string) => ({
    code: "CONFLICT",
    message,
    retryable: false,
    fields: [],
  });

  it("WHATSAPP_NOT_CONFIGURED when the platform is not configured", async () => {
    expect.hasAssertions();
    const h = await fresh("single", { configured: false });
    const res = await connect(h);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual(conflict("WHATSAPP_NOT_CONFIGURED"));
  });

  it("WHATSAPP_NOT_CONNECTED for a test send before any connection", async () => {
    expect.hasAssertions();
    const h = await fresh("single");
    const res = await h.app.inject({
      method: "POST",
      url: "/api/v1/outreach/whatsapp/test-send",
      headers: { ...h.as("operator"), "idempotency-key": key() },
      payload: {
        to: "+201012345678",
        templateName: "order_shipped",
        language: "en",
        values: { body: ["Sara"] },
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual(conflict("WHATSAPP_NOT_CONNECTED"));
    expect(h.whatsapp.count("sendTemplate")).toBe(0);
  });

  it.each([
    ["an empty name", { name: "" }, "name", "name_format"],
    ["an overlong name", { name: "n".repeat(513) }, "name", "name_format"],
    ["a badly formed name", { name: "Not Valid" }, "name", "name_format"],
    ["an empty language", { language: "" }, "language", "language_unsupported"],
    ["an overlong language", { language: "e".repeat(17) }, "language", "language_unsupported"],
    ["an unsupported language", { language: "xx" }, "language", "language_unsupported"],
  ])(
    "template create with %s keeps the domain's stable issue code",
    async (_label, patch, field, code) => {
      expect.hasAssertions();
      const h = await fresh("single");
      expect((await connect(h)).statusCode).toBe(200);
      const res = await h.app.inject({
        method: "POST",
        url: "/api/v1/outreach/whatsapp/templates",
        headers: { ...h.as("admin"), "idempotency-key": key() },
        payload: {
          name: "promo_one",
          language: "en",
          category: "UTILITY",
          body: { text: "Hello {{1}}, your order is on its way", examples: ["Sara"] },
          ...patch,
        },
      });
      expect(res.statusCode).toBe(422);
      const body = res.json<{ code: string; fields: { field: string; message: string }[] }>();
      expect(body.code).toBe("VALIDATION");
      expect(body.fields).toContainEqual({ field, message: code });
    },
  );

  it("TEMPLATE_NOT_APPROVED for a template Meta has not approved yet", async () => {
    expect.hasAssertions();
    const h = await fresh("single");
    expect((await connect(h)).statusCode).toBe(200);
    const created = await h.app.inject({
      method: "POST",
      url: "/api/v1/outreach/whatsapp/templates",
      headers: { ...h.as("admin"), "idempotency-key": key() },
      payload: {
        name: "promo_one",
        language: "en",
        category: "UTILITY",
        body: { text: "Hello {{1}}, your order is on its way", examples: ["Sara"] },
      },
    });
    expect(created.statusCode).toBe(201);
    const res = await h.app.inject({
      method: "POST",
      url: "/api/v1/outreach/whatsapp/test-send",
      headers: { ...h.as("operator"), "idempotency-key": key() },
      payload: {
        to: "+201012345678",
        templateName: "promo_one",
        language: "en",
        values: { body: ["Sara"] },
        attestConsent: true,
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual(conflict("TEMPLATE_NOT_APPROVED"));
    expect(h.whatsapp.count("sendTemplate")).toBe(0);

    // Ruling: the operator's explicit statement is evidence of consent, not of delivery, so the contact and the
    // TRANSACTIONAL grant (operator evidence) are retained although the send was refused: once Meta approves the
    // template, an ordinary send WITHOUT a new attestation goes through, and nothing was ever dispatched before.
    h.whatsapp.templates = [{ ...approvedTemplate, name: "promo_one" }];
    const synced = await h.app.inject({
      method: "POST",
      url: "/api/v1/outreach/whatsapp/templates/sync",
      headers: { ...h.as("admin"), "idempotency-key": key() },
    });
    expect(synced.statusCode).toBe(200);
    const later = await h.app.inject({
      method: "POST",
      url: "/api/v1/outreach/whatsapp/test-send",
      headers: { ...h.as("operator"), "idempotency-key": key() },
      payload: {
        to: "+201012345678",
        templateName: "promo_one",
        language: "en",
        values: { body: ["Sara"] },
      },
    });
    expect(later.statusCode).toBe(200);
    expect(later.json<{ status: string }>().status).toBe("accepted");
    expect(h.whatsapp.count("sendTemplate")).toBe(1);
  });

  it("a stale disconnect is a 409 CONCURRENCY version conflict and changes nothing", async () => {
    expect.hasAssertions();
    const h = await fresh("single");
    expect((await connect(h)).statusCode).toBe(200);
    const res = await h.app.inject({
      method: "POST",
      url: "/api/v1/outreach/whatsapp/disconnect",
      headers: { ...h.as("admin"), "idempotency-key": key() },
      payload: { expectedVersion: 99 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ code: string; fields: unknown[] }>()).toMatchObject({
      code: "CONCURRENCY",
      fields: [],
    });
    const status = await h.app.inject({
      method: "GET",
      url: "/api/v1/outreach/whatsapp",
      headers: h.as("admin"),
    });
    expect(status.json<{ status: string }>().status).toBe("connected");
  });

  it("abandon on a connected shop is the 409 ONBOARDING_NOT_ACTIVE envelope (round 3 route)", async () => {
    expect.hasAssertions();
    const h = await fresh("single");
    expect((await connect(h)).statusCode).toBe(200);
    const res = await h.app.inject({
      method: "POST",
      url: "/api/v1/outreach/whatsapp/onboarding/abandon",
      headers: { ...h.as("admin"), "idempotency-key": key() },
      payload: { expectedVersion: 0 },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual(conflict("ONBOARDING_NOT_ACTIVE"));
  });

  it("the templates list carries `supported` and `sendShape` (round 2 DTO)", async () => {
    expect.hasAssertions();
    const h = await fresh("single");
    h.whatsapp.templates = [approvedTemplate];
    expect((await connect(h)).statusCode).toBe(200);
    await h.app.inject({
      method: "POST",
      url: "/api/v1/outreach/whatsapp/templates/sync",
      headers: { ...h.as("admin"), "idempotency-key": key() },
    });
    const res = await h.app.inject({
      method: "GET",
      url: "/api/v1/outreach/whatsapp/templates",
      headers: h.as("viewer"),
    });
    const [template] = res.json<Array<Record<string, unknown>>>();
    expect(template).toMatchObject({
      name: "order_shipped",
      supported: true,
      sendShape: { bodyVariableCount: 1, headerHasVariable: false, buttons: [] },
    });
  });

  it("template issues are 422 VALIDATION with fields:[{field, message:<issue code>}]", async () => {
    expect.hasAssertions();
    const h = await fresh("single");
    expect((await connect(h)).statusCode).toBe(200);
    const res = await h.app.inject({
      method: "POST",
      url: "/api/v1/outreach/whatsapp/templates",
      headers: { ...h.as("admin"), "idempotency-key": key() },
      payload: {
        name: "Bad Name",
        language: "en",
        category: "UTILITY",
        body: { text: "Hi", examples: [] },
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ code: string; fields: unknown[] }>()).toMatchObject({
      code: "VALIDATION",
      fields: [{ field: "name", message: "name_format" }],
    });
    expect(h.whatsapp.count("createTemplate")).toBe(0);
  });
});

describe("test sends", () => {
  it("both test-send routes need an Idempotency-Key: 422 before any use case, zero provider calls", async () => {
    expect.hasAssertions();
    const h = await fresh("single");
    expect((await connect(h)).statusCode).toBe(200);
    const wa = await h.app.inject({
      method: "POST",
      url: "/api/v1/outreach/whatsapp/test-send",
      headers: h.as("operator"),
      payload: {
        to: "+201012345678",
        templateName: "order_shipped",
        language: "en",
        values: { body: ["Sara"] },
      },
    });
    expect(wa.statusCode).toBe(422);
    expect(wa.json<{ code: string; fields: unknown[] }>()).toMatchObject({
      code: "VALIDATION",
      fields: [{ field: "idempotency-key", message: "required" }],
    });
    const mail = await h.app.inject({
      method: "POST",
      url: "/api/v1/outreach/email/test-send",
      headers: h.as("operator"),
      payload: { to: "owner@example.com" },
    });
    expect(mail.statusCode).toBe(422);
    expect(h.whatsapp.count("sendTemplate")).toBe(0);
    expect(h.email.calls).toHaveLength(0);
  });

  it.each([
    [
      "whatsapp",
      "/api/v1/outreach/whatsapp/test-send",
      { to: BUYER, templateName: "order_shipped", language: "en", values: { body: ["Sara"] } },
    ],
    ["email", "/api/v1/outreach/email/test-send", { to: "owner@example.com" }],
  ])(
    "%s test send: a 200-character Idempotency-Key reaches the controller, 201 is invalid (not missing) before it",
    async (_name, url, payload) => {
      expect.hasAssertions();
      const h = await fresh("single");
      expect((await connect(h)).statusCode).toBe(200);
      const tooLong = await h.app.inject({
        method: "POST",
        url,
        headers: { ...h.as("operator"), "idempotency-key": "k".repeat(201) },
        payload,
      });
      expect(tooLong.statusCode).toBe(422);
      expect(tooLong.json<{ code: string; fields: unknown[] }>()).toMatchObject({
        code: "VALIDATION",
        fields: [{ field: "idempotency-key", message: "invalid" }],
      });
      // nothing ran: no provider call, no consent attestation side effect
      expect(h.whatsapp.count("sendTemplate")).toBe(0);
      expect(h.email.calls).toHaveLength(0);

      const accepted = await h.app.inject({
        method: "POST",
        url,
        headers: { ...h.as("operator"), "idempotency-key": "k".repeat(200) },
        payload,
      });
      // past the header check: the use case answers (a conflict/suppression for the unapproved WhatsApp template, 200 for email)
      expect(accepted.statusCode).not.toBe(422);
    },
  );

  it("attestConsent upserts the contact, records an admin grant and sends once with the body values", async () => {
    expect.hasAssertions();
    const h = await fresh("single");
    h.whatsapp.templates = [approvedTemplate];
    expect((await connect(h)).statusCode).toBe(200);
    const sync = await h.app.inject({
      method: "POST",
      url: "/api/v1/outreach/whatsapp/templates/sync",
      headers: { ...h.as("admin"), "idempotency-key": key() },
    });
    expect(sync.statusCode).toBe(200);
    const res = await h.app.inject({
      method: "POST",
      url: "/api/v1/outreach/whatsapp/test-send",
      headers: { ...h.as("operator"), "idempotency-key": "test-1" },
      payload: {
        to: "+20 101 234 5679",
        templateName: "order_shipped",
        language: "en",
        values: { body: ["Sara"] },
        attestConsent: true,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ status: string }>().status).toBe("accepted");
    expect(h.whatsapp.count("sendTemplate")).toBe(1);
    // The same Idempotency-Key replays the stored response: no second provider call.
    const again = await h.app.inject({
      method: "POST",
      url: "/api/v1/outreach/whatsapp/test-send",
      headers: { ...h.as("operator"), "idempotency-key": "test-1" },
      payload: {
        to: "+20 101 234 5679",
        templateName: "order_shipped",
        language: "en",
        values: { body: ["Sara"] },
        attestConsent: true,
      },
    });
    expect(again.statusCode).toBe(200);
    expect(h.whatsapp.count("sendTemplate")).toBe(1);
  });

  it("without attestConsent a fresh contact is suppressed and nothing is sent", async () => {
    expect.hasAssertions();
    const h = await fresh("single");
    h.whatsapp.templates = [approvedTemplate];
    expect((await connect(h)).statusCode).toBe(200);
    await h.app.inject({
      method: "POST",
      url: "/api/v1/outreach/whatsapp/templates/sync",
      headers: { ...h.as("admin"), "idempotency-key": key() },
    });
    const res = await h.app.inject({
      method: "POST",
      url: "/api/v1/outreach/whatsapp/test-send",
      headers: { ...h.as("operator"), "idempotency-key": key() },
      payload: {
        to: "+201012345679",
        templateName: "order_shipped",
        language: "en",
        values: { body: ["Sara"] },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ status: string }>().status).toBe("suppressed");
    expect(h.whatsapp.count("sendTemplate")).toBe(0);
  });

  it("the email test send goes through the email port once with the idempotency key", async () => {
    expect.hasAssertions();
    const h = await fresh("single");
    const res = await h.app.inject({
      method: "POST",
      url: "/api/v1/outreach/email/test-send",
      headers: { ...h.as("operator"), "idempotency-key": "mail-1" },
      payload: { to: "owner@example.com" },
    });
    expect(res.statusCode).toBe(200);
    expect(h.email.calls).toHaveLength(1);
    expect(h.email.calls[0]?.to).toBe("owner@example.com");
    expect(h.email.calls[0]?.subject).toContain("رسالة تجريبية");
  });
});

describe("webhook route handler (unit): signature before the use case", () => {
  const rawFor = (text: string): Uint8Array => new TextEncoder().encode(text);
  function webhookRoutes(process: ReturnType<typeof vi.fn>, appSecret: string | undefined) {
    const admin = {
      outreach: {},
      outreachWebhook: { appSecret, verifyToken: VERIFY_TOKEN, process },
    } as unknown as WiredAdmin;
    const route = outreachRoutes(admin).find(
      (r) => r.method === "POST" && r.path === "/public/outreach/whatsapp/webhook",
    );
    if (route === undefined) throw new Error("webhook route missing");
    return route;
  }
  const context = (text: string, headers: Record<string, string>): RequestContext => ({
    tenantId: "SPOOFED-TENANT",
    principal: { id: "public", kind: "customer", roles: [], tenantId: "SPOOFED-TENANT" },
    requestId: "r",
    correlationId: "c",
    rawBody: rawFor(text),
    headers,
  });

  it("an invalid signature is 401 and the use case is NOT called", async () => {
    expect.hasAssertions();
    const process = vi.fn();
    const route = webhookRoutes(process, APP_SECRET);
    const text = '{"entry":[]}';
    const res = await route.handle({
      body: JSON.parse(text) as unknown,
      params: undefined,
      query: undefined,
      context: context(text, { "x-hub-signature-256": sign(text, "wrong-secret-0123456") }),
    });
    expect(res.status).toBe(401);
    expect(process).not.toHaveBeenCalled();
  });

  it("a valid signature calls the use case exactly once, with the payload only (never the request tenant)", async () => {
    expect.hasAssertions();
    const process = vi.fn().mockResolvedValue({ ok: true, value: { processed: 1, skipped: 0 } });
    const route = webhookRoutes(process, APP_SECRET);
    const text = '{"entry":[{"id":"w"}]}';
    const body = JSON.parse(text) as unknown;
    const res = await route.handle({
      body,
      params: undefined,
      query: undefined,
      context: context(text, { "x-hub-signature-256": sign(text) }),
    });
    expect(res).toEqual({ status: 200, body: { received: true } });
    expect(process).toHaveBeenCalledTimes(1);
    expect(process).toHaveBeenCalledWith(body);
    expect(JSON.stringify(process.mock.calls)).not.toContain("SPOOFED-TENANT");
  });

  it("malformed JSON without a valid signature is 401 and never reaches the decoder or the use case", async () => {
    expect.hasAssertions();
    const process = vi.fn();
    const route = webhookRoutes(process, APP_SECRET);
    const text = "{ not json";
    const bad: Record<string, string>[] = [
      {},
      { "x-hub-signature-256": sign(text, "wrong-secret-0123456") },
    ];
    for (const headers of bad) {
      const res = await route.handle({
        body: undefined,
        params: undefined,
        query: undefined,
        context: context(text, headers),
      });
      expect(res.status).toBe(401);
    }
    expect(process).not.toHaveBeenCalled();
  });

  it("the payload is decoded ONCE from the authenticated bytes (the transport body is ignored)", async () => {
    expect.hasAssertions();
    const process = vi.fn().mockResolvedValue({ ok: true, value: { processed: 0, skipped: 0 } });
    const route = webhookRoutes(process, APP_SECRET);
    const text = '{ "entry" : [ { "id" : "w" } ] }';
    const res = await route.handle({
      body: { forged: true },
      params: undefined,
      query: undefined,
      context: context(text, { "x-hub-signature-256": sign(text) }),
    });
    expect(res.status).toBe(200);
    expect(process).toHaveBeenCalledTimes(1);
    expect(process).toHaveBeenCalledWith({ entry: [{ id: "w" }] });
  });

  it("a signed body that is not JSON is a validation error and the use case is not called", async () => {
    expect.hasAssertions();
    const process = vi.fn();
    const route = webhookRoutes(process, APP_SECRET);
    const text = "{ not json";
    await expect(
      route.handle({
        body: undefined,
        params: undefined,
        query: undefined,
        context: context(text, { "x-hub-signature-256": sign(text) }),
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(process).not.toHaveBeenCalled();
  });

  it("an absent app secret fails closed (401) and never calls the use case", async () => {
    expect.hasAssertions();
    const process = vi.fn();
    const route = webhookRoutes(process, undefined);
    const text = "{}";
    const res = await route.handle({
      body: {},
      params: undefined,
      query: undefined,
      context: context(text, { "x-hub-signature-256": sign(text, "") }),
    });
    expect(res.status).toBe(401);
    expect(process).not.toHaveBeenCalled();
  });

  it("an infrastructure failure is thrown so Meta retries; a validation error is acknowledged", async () => {
    expect.hasAssertions();
    const text = "{}";
    const failing = vi.fn().mockResolvedValue({
      ok: false,
      error: Object.assign(new Error("db down"), { code: "UNEXPECTED" }),
    });
    await expect(
      webhookRoutes(failing, APP_SECRET).handle({
        body: {},
        params: undefined,
        query: undefined,
        context: context(text, { "x-hub-signature-256": sign(text) }),
      }),
    ).rejects.toThrow("db down");
    const invalid = vi.fn().mockResolvedValue({
      ok: false,
      error: Object.assign(new Error("bad"), { code: "VALIDATION" }),
    });
    const res = await webhookRoutes(invalid, APP_SECRET).handle({
      body: {},
      params: undefined,
      query: undefined,
      context: context(text, { "x-hub-signature-256": sign(text) }),
    });
    expect(res.status).toBe(200);
  });

  it("defineRoute is imported (guards the module graph) and the routes are platform-scoped public", () => {
    expect.hasAssertions();
    const routes = outreachRoutes({
      outreach: {},
      outreachWebhook: { appSecret: "s", verifyToken: "t", process: vi.fn() },
    } as unknown as WiredAdmin);
    const hooks = routes.filter((r) => r.path.startsWith("/public/outreach/"));
    expect(hooks).toHaveLength(2);
    for (const route of hooks) {
      expect(route.public).toBe(true);
      expect(route.tenantScope).toBe("platform");
      expect(route.idempotent).toBe(false);
    }
    // only the delivery route skips the shared JSON parser
    expect(hooks.map((route) => [route.method, route.rawJsonBody === true])).toEqual([
      ["GET", false],
      ["POST", true],
    ]);
    expect(typeof defineRoute).toBe("function");
  });
});
