import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  JwtVerifier,
  NativeTokenIssuer,
  RoleTableAccessControl,
  localKeyResolver,
} from "@platform/auth";
import type {
  AccessControl,
  Cache,
  Clock,
  IdempotencyClaim,
  IdempotencyKeyStore,
  RateLimiter,
} from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireLicensing, type WiredLicensing } from "@platform/licensing";
import {
  HashedPasswordAuthProvider,
  InMemoryPasswordCredentialStore,
  ScryptPasswordHasher,
} from "@platform/security";
import { createAdminHttpApi } from "./server";

/**
 * Project 1 — two stores that signed themselves up stay apart. Driven through the REAL admin pipeline
 * (`createAdminHttpApi` with `tenantMode: "multi"`): the real tenant rows and lifecycle gate (no
 * `tenantGate` override), the real resolver chain, a real `NativeTokenIssuer` whose tokens are checked by
 * a real `JwtVerifier`, real scrypt password hashing and the real sign-up / merchant routes. Only the
 * Redis-shaped ports (rate limiter, idempotency, cache) are in-memory doubles.
 *
 * Access control is left permissive on purpose: both owners may do everything their role allows, so
 * every refusal below comes from tenancy (token claim, store scoping, platform pinning), not from a
 * role check that would also deny them.
 *
 * Layer under test: application (transport + composition). No RLS, no Postgres.
 */

const PLATFORM = "platform";
const API = "/api/v1";
const clock: Clock = { now: () => new Date("2026-10-16T00:00:00.000Z") };

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
  // A real fixed-window counter: the route's own limits (5/IP/hour, 3/email/hour) apply as configured.
  const rateLimiter: RateLimiter = {
    consume: async (key, limit) => {
      const used = ((kv.get(`rl:${key}`) as number | undefined) ?? 0) + 1;
      kv.set(`rl:${key}`, used);
      return { allowed: used <= limit, remaining: Math.max(0, limit - used), retryAfterMs: 1_000 };
    },
  };
  return { cache, idempotencyKeys, rateLimiter };
}

/** The "basic" plan, published, in the SAME licensing instance the app composes with. */
async function seedBasicPlan(licensing: WiredLicensing): Promise<void> {
  const plan = await licensing.licensing.createPlan({
    key: "basic",
    name: "Basic",
    tier: "starter",
    tenantId: PLATFORM,
  });
  const planId = (plan.body as { id: string }).id;
  const draft = await licensing.licensing.createPlanDraft({
    planId,
    spec: {
      limits: { maxProducts: 100 },
      featureEntitlements: ["basic_reports"],
      pricing: {
        basePriceMinor: 49_900,
        currency: "EGP",
        billingCycle: "monthly",
        trialDays: 14,
        creditAllowances: {},
      },
    },
    tenantId: PLATFORM,
  });
  const planVersionId = (draft.body as { planVersionId: string }).planVersionId;
  const published = await licensing.licensing.publishPlanVersion({
    planId,
    planVersionId,
    tenantId: PLATFORM,
  });
  expect(published.status).toBe(200);
}

interface Store {
  readonly tenantId: string;
  readonly storeUrl: string;
  readonly token: string;
  readonly email: string;
}

const PASSWORD = "correct horse battery staple";
const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as never;

/**
 * The real multi-mode admin pipeline over its own licensing instance. `accessControl` stays the server
 * default (permissive) unless a case needs the real role table.
 */
async function boot(
  accessControl?: AccessControl,
): Promise<{ app: FastifyInstance; licensing: WiredLicensing }> {
  let n = 0;
  const idGenerator = {
    generate: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, "0")}`,
  };
  const serializer = new InMemoryEventSerializer();
  // The app is built over THIS licensing instance, so the plan seeded afterwards is the plan sign-up
  // finds. (`createAdminHttpApi` forwards `licensing` to `wireAdmin`; no HTTP seeding needed.)
  const licensing = wireLicensing({ serializer, idGenerator, clock, platformTenantId: PLATFORM });

  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const tokenIssuer = new NativeTokenIssuer({
    privateKey,
    issuer: "https://api.test/",
    audience: "morbeh-admin",
    ttlSeconds: 7200,
  });
  const resolver = localKeyResolver(tokenIssuer);
  // `JwtVerifier` is the Authenticator and the ClaimsAuthenticator in one: it already returns
  // `{ principal, claims }` with the token's `tenant_id` claim.
  const authenticator = new JwtVerifier({
    issuer: "https://api.test/",
    audience: "morbeh-admin",
    getKey: (header, token) => resolver.then((getKey) => getKey(header, token)),
    logger: silent,
  });

  const fx = infra();
  const app = await createAdminHttpApi({
    tenantMode: "multi",
    tenantId: PLATFORM,
    serializer,
    idGenerator,
    clock,
    licensing,
    authenticator,
    ...(accessControl === undefined ? {} : { accessControl }),
    rateLimiter: fx.rateLimiter,
    idempotencyKeys: fx.idempotencyKeys,
    responseCache: fx.cache,
    passwordAuthProvider: new HashedPasswordAuthProvider({
      store: new InMemoryPasswordCredentialStore(),
      hasher: new ScryptPasswordHasher({ log2N: 10 }),
      clock,
    }),
    staffTokenIssuer: tokenIssuer,
    adminPublicUrl: "https://admin.test",
    platformStoreDomain: "morbeh.test",
    // Without a verifier `verify` answers 409 "not configured" before it looks at ownership, which
    // would hide the 404 this suite is after. No domain here points at the platform.
    dnsVerifier: { pointsToPlatform: async () => false },
    defaultPlanKey: "basic",
  });
  return { app, licensing };
}

describe("two self-serve stores stay apart (merchant onboarding)", () => {
  let app: FastifyInstance;
  let licensing: WiredLicensing;
  let a: Store;
  let b: Store;
  let invoiceOfA: string;
  let invoiceOfB: string;

  const headers = (token: string, extra: Record<string, string> = {}) => ({
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    ...extra,
  });
  const get = (token: string, url: string, extra: Record<string, string> = {}) =>
    app.inject({ method: "GET", url: `${API}${url}`, headers: headers(token, extra) });
  const post = (token: string, url: string, payload: unknown = {}, extra = {}) =>
    app.inject({
      method: "POST",
      url: `${API}${url}`,
      headers: headers(token, extra),
      payload: payload as object,
    });
  const publicPost = (url: string, payload: unknown) =>
    app.inject({
      method: "POST",
      url: `${API}${url}`,
      headers: { "content-type": "application/json", "x-tenant-id": PLATFORM },
      payload: payload as object,
    });
  const signUp = (storeName: string, email: string) =>
    publicPost("/public/merchant-signup", { storeName, email, password: PASSWORD, country: "EG" });

  async function signUpStore(storeName: string, email: string): Promise<Store> {
    const res = await signUp(storeName, email);
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      tenantId: string;
      storeUrl: string;
      accessToken?: string;
      signInRequired?: boolean;
    };
    expect(body.signInRequired).toBeUndefined();
    return { tenantId: body.tenantId, storeUrl: body.storeUrl, token: body.accessToken!, email };
  }

  /** An issued, unpaid invoice on the shop's subscription, created through the licensing seam. */
  async function invoiceFor(shop: string, label: string): Promise<string> {
    const billing = await licensing.licensing.getMerchantBilling({
      tenantRef: shop,
      tenantId: PLATFORM,
    });
    expect(billing.status).toBe(200);
    const created = await licensing.licensing.createInvoice({
      tenantRef: shop,
      subscriptionRef: `subscription-of-${shop}`,
      currency: "EGP",
      lineItems: [{ description: label, amountMinor: 49_900 }],
      tenantId: PLATFORM,
    });
    const invoiceId = (created.body as { id: string }).id;
    await licensing.licensing.issueInvoice({ invoiceId, tenantId: PLATFORM });
    return invoiceId;
  }

  beforeAll(async () => {
    ({ app, licensing } = await boot());

    // Seeded only AFTER the boot check: `assertMultiTenantReady` walks the composed graph, and an
    // in-memory outbox that already holds the plan's events (each stamped with the platform tenant)
    // would read as a construction-time tenant. Production's outbox is a table, never in the graph.
    await seedBasicPlan(licensing);

    a = await signUpStore("Alpha Store", "owner@alpha.test");
    b = await signUpStore("Beta Store", "owner@beta.test");
    invoiceOfA = await invoiceFor(a.tenantId, "Alpha period");
    invoiceOfB = await invoiceFor(b.tenantId, "Beta period");
  });
  afterAll(async () => {
    await app.close();
  });

  it("control: the two sign-ups made two different stores, each on its own subdomain", () => {
    expect(a.tenantId).not.toBe(b.tenantId);
    expect(a.storeUrl).toBe("https://alpha-store.morbeh.test");
    expect(b.storeUrl).toBe("https://beta-store.morbeh.test");
  });

  // ── Case 1 ──────────────────────────────────────────────────────────────────────────────────
  describe("case 1 — settings follow the token, not a header", () => {
    it("B's token shows B's store", async () => {
      const res = await get(b.token, "/store/settings");
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ storeName: "Beta Store", contactEmail: b.email });
    });

    it("control: A's token shows A's store", async () => {
      const res = await get(a.token, "/store/settings");
      expect(res.json()).toMatchObject({ storeName: "Alpha Store" });
    });

    it("a forged x-tenant-id naming A does not move B's token onto A", async () => {
      const res = await get(b.token, "/store/settings", { "x-tenant-id": a.tenantId });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ storeName: "Beta Store" });
    });

    it("a forged header cannot make a write land on A either", async () => {
      const res = await app.inject({
        method: "POST",
        url: `${API}/store/setup-guide/dismiss`,
        headers: headers(b.token, { "x-tenant-id": a.tenantId }),
        payload: {},
      });
      expect(res.statusCode).toBeLessThan(300);
      const dismissedAt = async (token: string) =>
        ((await get(token, "/store/settings")).json() as { setupGuideDismissedAt: string | null })
          .setupGuideDismissedAt;
      expect(await dismissedAt(b.token)).not.toBeNull();
      expect(await dismissedAt(a.token)).toBeNull();
    });
  });

  // ── Case 2 ──────────────────────────────────────────────────────────────────────────────────
  describe("case 2 — domains", () => {
    const domainsOf = async (s: Store) => {
      const res = await get(s.token, "/store/domains");
      expect(res.statusCode).toBe(200);
      return (res.json() as { items: { id: string; hostname: string }[] }).items;
    };

    it("B lists only its own domain", async () => {
      const mine = await domainsOf(b);
      expect(mine.map((d) => d.hostname)).toEqual(["beta-store.morbeh.test"]);
      const theirs = await domainsOf(a);
      expect(theirs.map((d) => d.hostname)).toEqual(["alpha-store.morbeh.test"]);
    });

    it("B cannot make A's domain primary, verify it, and A's list is untouched", async () => {
      const [aDomain] = await domainsOf(a);
      const before = JSON.stringify(await domainsOf(a));
      expect(aDomain).toBeDefined();

      const primary = await post(b.token, `/store/domains/${aDomain!.id}/primary`);
      expect(primary.statusCode).toBe(404);
      const verify = await post(b.token, `/store/domains/${aDomain!.id}/verify`);
      expect(verify.statusCode).toBe(404);

      expect(JSON.stringify(await domainsOf(a))).toBe(before);
    });

    it("control: the owner reaches its own domain through the same routes", async () => {
      const [aDomain] = await domainsOf(a);
      expect((await post(a.token, `/store/domains/${aDomain!.id}/verify`)).statusCode).toBe(200);
      expect((await post(a.token, `/store/domains/${aDomain!.id}/primary`)).statusCode).toBe(200);
    });
  });

  // ── Case 3 ──────────────────────────────────────────────────────────────────────────────────
  describe("case 3 — billing", () => {
    it("B sees its own invoice and never A's", async () => {
      const res = await get(b.token, "/store/billing");
      expect(res.statusCode).toBe(200);
      const ids = (res.json() as { invoices: { id: string }[] }).invoices.map((i) => i.id);
      expect(ids).toContain(invoiceOfB);
      expect(ids).not.toContain(invoiceOfA);
    });

    it("B paying A's invoice id is a 404 and starts nothing", async () => {
      const res = await post(b.token, `/store/billing/invoices/${invoiceOfA}/pay`);
      expect(res.statusCode).toBe(404);
      expect(JSON.stringify(res.json())).not.toContain("checkoutUrl");
    });

    it("B changing plan moves only B (a forged header does not redirect it)", async () => {
      const before = (await get(a.token, "/store/billing")).json();
      const res = await post(
        b.token,
        "/store/billing/plan",
        { planKey: "basic" },
        {
          "x-tenant-id": a.tenantId,
        },
      );
      expect(res.statusCode).toBeLessThan(500);
      expect((await get(a.token, "/store/billing")).json()).toEqual(before);
    });
  });

  // ── Case 4 ──────────────────────────────────────────────────────────────────────────────────
  describe("case 4 — merchant login", () => {
    it("A's email returns a token for A, never B", async () => {
      const res = await publicPost("/public/auth/merchant/login", {
        email: a.email,
        password: PASSWORD,
      });
      expect(res.statusCode).toBe(200);
      const { accessToken } = res.json() as { accessToken: string };
      const settings = await get(accessToken, "/store/settings");
      expect(settings.json()).toMatchObject({ storeName: "Alpha Store" });
      // And the signed claim itself, not just the behaviour.
      const claim = JSON.parse(Buffer.from(accessToken.split(".")[1]!, "base64url").toString());
      expect(claim.tenant_id).toBe(a.tenantId);
      expect(claim.tenant_id).not.toBe(b.tenantId);
    });

    it("A's email with B's password is refused", async () => {
      const res = await publicPost("/public/auth/merchant/login", {
        email: a.email,
        password: "not the password",
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // ── Case 5 ──────────────────────────────────────────────────────────────────────────────────
  describe("case 5 — a sign-up retry", () => {
    it("A's email again is a 409 EMAIL_TAKEN and changes nothing of B's", async () => {
      const before = (await get(b.token, "/store/settings")).json();
      const res = await signUp("Hijack Store", a.email);
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ code: "EMAIL_TAKEN" });
      expect((await get(b.token, "/store/settings")).json()).toEqual(before);
      expect((await get(a.token, "/store/settings")).json()).toMatchObject({
        storeName: "Alpha Store",
      });
    });
  });

  // ── Case 6 ──────────────────────────────────────────────────────────────────────────────────
  describe("case 6 — operator routes", () => {
    it("B's token on GET /tenants is a 403", async () => {
      const res = await get(b.token, "/tenants");
      expect(res.statusCode).toBe(403);
    });

    it("naming the platform in a header does not lift B onto the operator routes", async () => {
      const res = await get(b.token, "/tenants", { "x-tenant-id": PLATFORM });
      expect(res.statusCode).toBe(403);
    });

    it("B's token cannot read A's tenant row either", async () => {
      const res = await get(b.token, `/tenants/${a.tenantId}`);
      expect(res.statusCode).toBe(403);
    });
  });
});

/**
 * Review fix A: under `AUTH_MODE=native` a merchant owner's token carries the `admin` role, which the
 * role table maps to `*:*`, so a permission check alone lets it through to platform-global reads. This
 * suite runs the REAL `RoleTableAccessControl` (as `apps/runtime` composes it for native auth), so the
 * refusals below can only come from those routes being pinned to the platform tenant.
 */
describe("a self-signed-up merchant under the real role table (native auth)", () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    let licensing: WiredLicensing;
    ({ app, licensing } = await boot(new RoleTableAccessControl()));
    await seedBasicPlan(licensing);
    const res = await app.inject({
      method: "POST",
      url: `${API}/public/merchant-signup`,
      headers: { "content-type": "application/json", "x-tenant-id": PLATFORM },
      payload: {
        storeName: "Gamma Store",
        email: "owner@gamma.test",
        password: PASSWORD,
        country: "EG",
      },
    });
    expect(res.statusCode).toBe(201);
    token = (res.json() as { accessToken: string }).accessToken;
  });
  afterAll(async () => {
    await app.close();
  });

  const as = (method: "GET" | "POST", url: string, extra: Record<string, string> = {}) =>
    app.inject({
      method,
      url: `${API}${url}`,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...extra },
      ...(method === "POST" ? { payload: {} } : {}),
    });

  it("control: the owner's role still reads its own store settings", async () => {
    const res = await as("GET", "/store/settings");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ storeName: "Gamma Store" });
  });

  it("is refused the platform-wide KPIs (403), with or without a header naming the platform", async () => {
    expect((await as("POST", "/platform/kpis")).statusCode).toBe(403);
    expect((await as("POST", "/platform/kpis", { "x-tenant-id": PLATFORM })).statusCode).toBe(403);
  });

  it("is refused the process-wide security telemetry reads (403)", async () => {
    expect((await as("GET", "/security/console/analytics")).statusCode).toBe(403);
    expect((await as("GET", "/security/console/risk-explorer")).statusCode).toBe(403);
  });
});
