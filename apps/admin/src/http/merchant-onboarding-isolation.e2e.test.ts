import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { RoleTableAccessControl } from "@platform/auth";
import type { AccessControl } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { WiredLicensing } from "@platform/licensing";
import {
  API,
  PASSWORD,
  PLATFORM,
  bootMultiTenant,
  seedBasicPlan,
  signUpStoreOf,
  type Store,
} from "./testing/multi-tenant-signup";

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

/** The shared multi-mode pipeline with this suite's serializer; `accessControl` stays permissive unless given. */
const boot = (accessControl?: AccessControl) =>
  bootMultiTenant({
    serializer: new InMemoryEventSerializer(),
    ...(accessControl === undefined ? {} : { accessControl }),
  });

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
  const signUp = (storeName: string, email: string, siteType: "store" | "lead_site" = "store") =>
    publicPost("/public/merchant-signup", {
      storeName,
      email,
      password: PASSWORD,
      country: "EG",
      siteType,
    });

  const signUpStore = (storeName: string, email: string): Promise<Store> =>
    signUpStoreOf(app, storeName, email);

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
        siteType: "store",
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

/**
 * The site type is chosen once, at sign-up, and nothing the owner can reach afterwards moves it: the
 * settings form's body is stripped to its five fields, so a `siteType` smuggled into the save is ignored.
 */
describe("a lead website's type survives the owner's own settings save", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    let licensing: WiredLicensing;
    ({ app, licensing } = await boot());
    await seedBasicPlan(licensing);
  });
  afterAll(async () => {
    await app.close();
  });

  it("keeps lead_site when PUT /store/settings carries siteType store", async () => {
    const res = await app.inject({
      method: "POST",
      url: `${API}/public/merchant-signup`,
      headers: { "content-type": "application/json", "x-tenant-id": PLATFORM },
      payload: {
        storeName: "Gamma Clinic",
        email: "owner@gamma.test",
        password: PASSWORD,
        country: "EG",
        siteType: "lead_site",
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { accessToken: string; siteType: string };
    expect(body.siteType).toBe("lead_site");
    const auth = {
      authorization: `Bearer ${body.accessToken}`,
      "content-type": "application/json",
    };

    const saved = await app.inject({
      method: "PUT",
      url: `${API}/store/settings`,
      headers: auth,
      payload: {
        storeName: "Gamma Clinic Cairo",
        contactEmail: "hello@gamma.test",
        currency: "EGP",
        timezone: "Africa/Cairo",
        weightUnit: "kg",
        siteType: "store",
      },
    });
    expect(saved.statusCode).toBe(200);

    const read = await app.inject({ method: "GET", url: `${API}/store/settings`, headers: auth });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ storeName: "Gamma Clinic Cairo", siteType: "lead_site" });
  });
});
