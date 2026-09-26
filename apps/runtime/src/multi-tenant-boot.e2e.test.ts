import { afterEach, describe, expect, it } from "vitest";
import type {
  AuditTrail,
  Cache,
  ClaimsAuthenticator,
  Clock,
  IdempotencyKeyStore,
  RateLimiter,
} from "@platform/contracts";
import { createAdminHttpApi, type AdminHttpDeps } from "@platform/admin";
import { CachedAccessControl, KetoAccessControl, KratosSessionAuthenticator } from "@platform/auth";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { Logger } from "@platform/utils";

type FastifyInstance = Awaited<ReturnType<typeof createAdminHttpApi>>;

/**
 * WP-10 definition of done: **`TENANT_MODE=multi` boots, and two tenants serve correct, isolated data
 * through the same process.** ONE `createAdminHttpApi` (one Fastify instance, one composed graph, one
 * set of repositories), composed in-test with `tenantMode: "multi"` — no env file, manifest or CI job
 * sets the mode.
 *
 * What is real: the admin pipeline and route table, the resolver chain, `assertMultiTenantReady`, the
 * lifecycle gate over real `Tenant` rows (merchants are created through the operator route), the real
 * `KratosSessionAuthenticator` (session cache included), the real `KetoAccessControl` wrapped in the
 * real `CachedAccessControl`. What is a double: Kratos' and Keto's HTTP endpoints, and Redis — modelled
 * as ONE shared keyspace, because that is the property that makes a cache leak possible.
 *
 * What this does NOT reach: Postgres. The composition is the in-memory one (`prisma` unset), so the
 * Prisma repositories' `where: { tenantId }` clauses are not exercised here — see
 * `packages/db/src/prisma-tenant-where.guard.test.ts`. Worker/consumer routing by envelope tenant is
 * covered by the consumer suites, not booted here.
 */

const PLATFORM = "tenant-local";
const clock: Clock = { now: () => new Date("2026-09-26T00:00:00.000Z") };
const logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child: () => logger,
} as unknown as Logger;
const auditTrail = { record: async () => undefined } as unknown as AuditTrail;

/** ONE keyspace for the response cache, idempotency claims, rate-limit buckets, authz and session caches. */
function sharedRedis() {
  const kv = new Map<string, unknown>();
  const cache: Cache = {
    get: async <T>(k: string) => (kv.get(`cache:${k}`) as T | undefined) ?? null,
    set: async (k, v) => void kv.set(`cache:${k}`, JSON.parse(JSON.stringify(v))),
    delete: async (k) => void kv.delete(`cache:${k}`),
    has: async (k) => kv.has(`cache:${k}`),
  };
  const idempotencyKeys: IdempotencyKeyStore = {
    claim: async (key) => {
      if (kv.has(`idem:${key}`)) return null;
      kv.set(`idem:${key}`, true);
      return { key, token: "t", release: async () => kv.delete(`idem:${key}`) };
    },
  };
  const rateLimiter: RateLimiter = {
    consume: async () => ({ allowed: true, remaining: 99, retryAfterMs: 0 }),
  };
  return { kv, cache, idempotencyKeys, rateLimiter };
}

interface World {
  readonly app: FastifyInstance;
  readonly kv: Map<string, unknown>;
  readonly ketoChecks: Array<{ tenant: string; principal: string; permission: string }>;
  readonly grants: Map<string, (permission: string) => boolean>;
  readonly whoami: { calls: number };
}

const apps: FastifyInstance[] = [];
afterEach(async () => {
  while (apps.length > 0) await apps.pop()?.close();
});

/** Sessions: `op` is the operator (platform tenant); `t:<tenant>` is the SAME identity id in <tenant>. */
async function bootWorld(extra: Partial<AdminHttpDeps> = {}): Promise<World> {
  const redis = sharedRedis();
  const grants = new Map<string, (permission: string) => boolean>();
  const ketoChecks: World["ketoChecks"] = [];
  const whoami = { calls: 0 };

  const kratos = new KratosSessionAuthenticator({
    publicUrl: "http://kratos.invalid",
    adminUrl: "http://kratos-admin.invalid",
    cache: redis.cache,
    auditTrail,
    clock,
    logger,
    fetch: async (_url, init) => {
      whoami.calls += 1;
      const token = init?.headers?.["X-Session-Token"] ?? "";
      // Sessions that arrive WITHOUT a usable tenant, in every shape a mis-mapped IdP can produce.
      const broken: Record<
        string,
        { meta: Record<string, unknown>; traits?: Record<string, unknown> }
      > = {
        "no-tenant": { meta: { kind: "staff" } },
        "empty-tenant": { meta: { kind: "staff", tenant_id: "" } },
        "blank-tenant": { meta: { kind: "staff", tenant_id: "   " } },
        "numeric-tenant": { meta: { kind: "staff", tenant_id: 42 } },
        // A user-editable trait naming a tenant must never stand in for the operator-written one.
        "trait-tenant": { meta: { kind: "staff" }, traits: { tenant_id: PLATFORM } },
      };
      const shape = broken[token];
      if (shape !== undefined) {
        return {
          status: 200,
          json: async () => ({
            id: `session-${token}`,
            active: true,
            identity: { id: "staff-1", metadata_public: shape.meta, traits: shape.traits },
          }),
        };
      }
      const tenant = token === "op" ? PLATFORM : token.startsWith("t:") ? token.slice(2) : null;
      if (tenant === null) return { status: 401, json: async () => ({}) };
      return {
        status: 200,
        json: async () => ({
          id: `session-${token}`,
          active: true,
          // The SAME identity id in every tenant: what a principal-only key would wrongly merge.
          identity: { id: "staff-1", metadata_public: { kind: "staff", tenant_id: tenant } },
        }),
      };
    },
  });

  // Keto: a tuple `(permissions, tenant/<t>/<perm>, granted, <principal>)` exists iff `grants` says so.
  const keto = new KetoAccessControl({
    readUrl: "http://keto.invalid",
    logger,
    fetch: async (url) => {
      const query = new URL(url).searchParams;
      const object = query.get("object") ?? "";
      const match = /^tenant\/([^/]+)\/(.+)$/.exec(object);
      const tenant = match?.[1] ?? "";
      const permission = match?.[2] ?? object;
      ketoChecks.push({ tenant, principal: query.get("subject_id") ?? "", permission });
      const allowed = match !== null && (grants.get(tenant)?.(permission) ?? false);
      return { status: 200, json: async () => ({ allowed }) };
    },
  });

  let n = 0;
  const app = await createAdminHttpApi({
    serializer: new InMemoryEventSerializer(),
    idGenerator: { generate: () => `id-${(n += 1)}` },
    clock,
    authenticator: kratos as ClaimsAuthenticator,
    rateLimiter: redis.rateLimiter,
    idempotencyKeys: redis.idempotencyKeys,
    responseCache: redis.cache,
    accessControl: new CachedAccessControl(keto, redis.cache, 30),
    tenantMode: "multi",
    tenantId: PLATFORM,
    knownSubjects: ["owner-a", "owner-b"],
    ...extra,
  });
  apps.push(app);
  grants.set(PLATFORM, () => true);
  return { app, kv: redis.kv, ketoChecks, grants, whoami };
}

const call = (
  w: World,
  token: string,
  method: "GET" | "POST",
  url: string,
  payload?: Record<string, unknown>,
  headers: Record<string, string> = {},
) =>
  w.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: {
      authorization: `Bearer ${token}`,
      "idempotency-key": crypto.randomUUID(),
      ...headers,
    },
    ...(payload === undefined ? {} : { payload }),
  });

async function createMerchant(w: World, slug: string, owner: string): Promise<string> {
  const res = await call(w, "op", "POST", "/tenants", {
    slug,
    name: slug,
    isolationTier: "pooled",
    ownerExternalId: owner,
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { id: string }).id;
}

const folderNames = async (w: World, token: string) => {
  const res = await call(w, token, "GET", "/media/folders");
  expect(res.statusCode).toBe(200);
  return (res.json() as { items: { name: string }[] }).items.map((f) => f.name).sort();
};

describe("TENANT_MODE=multi: two tenants, one process (WP-10 definition of done)", () => {
  it("boots: the real resolver chain and the composed graph pass the boot assertion", async () => {
    const w = await bootWorld();
    expect((await w.app.inject({ method: "GET", url: "/health/live" })).statusCode).toBeLessThan(
      500,
    );
  });

  it("WRITES land in the writer's tenant only, and READS return only the reader's tenant", async () => {
    const w = await bootWorld();
    const a = await createMerchant(w, "acme", "owner-a");
    const b = await createMerchant(w, "bravo", "owner-b");
    w.grants.set(a, () => true);
    w.grants.set(b, () => true);

    // The SAME name in both tenants (a tenant-blind unique key or lookup would collide or merge).
    expect(
      (await call(w, `t:${a}`, "POST", "/media/folders", { name: "shared-name" })).statusCode,
    ).toBe(201);
    expect((await call(w, `t:${a}`, "POST", "/media/folders", { name: "only-a" })).statusCode).toBe(
      201,
    );
    expect(
      (await call(w, `t:${b}`, "POST", "/media/folders", { name: "shared-name" })).statusCode,
    ).toBe(201);
    expect((await call(w, `t:${b}`, "POST", "/media/folders", { name: "only-b" })).statusCode).toBe(
      201,
    );

    expect(await folderNames(w, `t:${a}`)).toEqual(["only-a", "shared-name"]);
    expect(await folderNames(w, `t:${b}`)).toEqual(["only-b", "shared-name"]);
    // The operator's own tenant sees neither.
    expect(await folderNames(w, "op")).toEqual([]);
  });

  it("AUTHORIZATION is decided per tenant for the same principal id, through a shared decision cache", async () => {
    const w = await bootWorld();
    const a = await createMerchant(w, "acme", "owner-a");
    const b = await createMerchant(w, "bravo", "owner-b");
    w.grants.set(a, () => true); // staff-1 may do everything in A...
    w.grants.set(b, (p) => p.endsWith(":read")); // ...and may only read in B.

    expect((await call(w, `t:${a}`, "POST", "/media/folders", { name: "f" })).statusCode).toBe(201);
    // Same principal id, same permission, same cache keyspace: B must be refused, not served A's "allow".
    const denied = await call(w, `t:${b}`, "POST", "/media/folders", { name: "f" });
    expect(denied.statusCode).toBe(403);
    expect((await call(w, `t:${b}`, "GET", "/media/folders")).statusCode).toBe(200);

    // Order-independence: B's denial must not poison A once cached, either.
    expect((await call(w, `t:${b}`, "POST", "/media/folders", { name: "g" })).statusCode).toBe(403);
    expect((await call(w, `t:${a}`, "POST", "/media/folders", { name: "g" })).statusCode).toBe(201);

    // Keto was asked about the tenant-qualified object each time, never a bare permission.
    const asked = new Set(w.ketoChecks.map((c) => `${c.tenant}|${c.permission}`));
    expect(asked.has(`${a}|media_library:create_folder`)).toBe(true);
    expect(asked.has(`${b}|media_library:create_folder`)).toBe(true);
  });

  it("SHARED CACHES: idempotency, replay and session caches are per tenant, in one keyspace", async () => {
    const w = await bootWorld();
    const a = await createMerchant(w, "acme", "owner-a");
    const b = await createMerchant(w, "bravo", "owner-b");
    w.grants.set(a, () => true);
    w.grants.set(b, () => true);

    const key = "idem-shared-key";
    const one = await call(
      w,
      `t:${a}`,
      "POST",
      "/media/folders",
      { name: "x" },
      { "idempotency-key": key },
    );
    const two = await call(
      w,
      `t:${b}`,
      "POST",
      "/media/folders",
      { name: "x" },
      { "idempotency-key": key },
    );
    expect(one.statusCode).toBe(201);
    expect(two.statusCode).toBe(201); // not a 409 from A's claim, not A's replayed body
    expect(two.json()).not.toEqual(one.json());
    expect(await folderNames(w, `t:${a}`)).toEqual(["x"]);
    expect(await folderNames(w, `t:${b}`)).toEqual(["x"]);

    // No cache/idempotency entry carrying the client's key is un-namespaced.
    const keyed = [...w.kv.keys()].filter((k) => k.includes(key));
    expect(keyed.length).toBeGreaterThanOrEqual(2);
    expect(keyed.every((k) => /tenant:[^:]+:idem:/.test(k))).toBe(true);
    // Every authz decision entry names a tenant.
    const authz = [...w.kv.keys()].filter((k) => k.startsWith("cache:authz:"));
    expect(authz.length).toBeGreaterThan(0);
    expect(authz.every((k) => /^cache:authz:[^:]+:[^:]+:/.test(k))).toBe(true);
    // The session cache serves a token from cache without asking Kratos again, still in its own tenant.
    const before = w.whoami.calls;
    expect(await folderNames(w, `t:${a}`)).toEqual(["x"]);
    expect(await folderNames(w, `t:${b}`)).toEqual(["x"]);
    expect(w.whoami.calls).toBe(before);
  });

  it("LIFECYCLE is per tenant: suspending A does not touch B, in the same process", async () => {
    const w = await bootWorld();
    const a = await createMerchant(w, "acme", "owner-a");
    const b = await createMerchant(w, "bravo", "owner-b");
    w.grants.set(a, () => true);
    w.grants.set(b, () => true);
    expect((await call(w, "op", "POST", `/tenants/${a}/suspend`)).statusCode).toBe(200);
    expect((await call(w, `t:${a}`, "POST", "/media/folders", { name: "z" })).json().code).toBe(
      "TENANT_SUSPENDED",
    );
    expect((await call(w, `t:${b}`, "POST", "/media/folders", { name: "z" })).statusCode).toBe(201);
  });

  it("the operator routes refuse every tenant but the platform's, even for a fully-granted principal", async () => {
    const w = await bootWorld();
    const a = await createMerchant(w, "acme", "owner-a");
    w.grants.set(a, () => true);
    const res = await call(w, `t:${a}`, "POST", "/tenants", {
      slug: "evil",
      name: "evil",
      isolationTier: "pooled",
    });
    expect(res.statusCode).toBe(403);
  });

  it("without a deployment tenant to pin to, tenancy is refused to EVERY tenant (fail closed), not open to all", async () => {
    // Embedders may omit `tenantId`; multi mode must not treat "nothing to pin to" as "no pin".
    const w = await bootWorld({
      tenantId: undefined,
      tenantGate: { availability: async () => "active" },
    });
    w.grants.set("some-tenant", () => true);
    const res = await call(w, "t:some-tenant", "POST", "/tenants", {
      slug: "x",
      name: "x",
      isolationTier: "pooled",
    });
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatch(/platform-operator/);
  });
});

/**
 * "A request with no resolvable tenant is rejected, never defaulted" — at the boundary, through the real
 * pipeline, for every way a tenant arrives (session claim, header) and every way it fails (absent,
 * empty, blank, non-string, malformed, unknown, suspended, mismatched). The event-envelope column of
 * the matrix is in packages/domain-events (readEnvelopeTenant) and the consumer suites. G-69 was a
 * header fallback found by exactly this kind of test; the first rows are its shape.
 */
describe("no resolvable tenant ⇒ rejected, never defaulted (WP-10 definition of done)", () => {
  it.each([
    ["no tenant in the session", "no-tenant"],
    ["an empty tenant", "empty-tenant"],
    ["a blank tenant", "blank-tenant"],
    ["a non-string tenant", "numeric-tenant"],
    ["a tenant only in a user-editable trait", "trait-tenant"],
  ])("authenticated: %s → 403, and the handler never runs", async (_label, token) => {
    const w = await bootWorld();
    w.grants.set(PLATFORM, () => true);
    const res = await call(w, token, "GET", "/media/folders");
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatch(/No tenant resolved/);
  });

  it("authenticated with no tenant claim: a client-supplied header is NOT a substitute (G-69)", async () => {
    const w = await bootWorld();
    const merchant = await createMerchant(w, "acme", "owner-a");
    w.grants.set(merchant, () => true);
    const res = await call(w, "no-tenant", "GET", "/media/folders", undefined, {
      "x-tenant-id": merchant,
    });
    expect(res.statusCode).toBe(403);
  });

  it("a verified claim wins over a MISMATCHED header; the header names nothing", async () => {
    const w = await bootWorld();
    const a = await createMerchant(w, "acme", "owner-a");
    const b = await createMerchant(w, "bravo", "owner-b");
    w.grants.set(a, () => true);
    w.grants.set(b, () => true);
    expect(
      (await call(w, `t:${a}`, "POST", "/media/folders", { name: "in-a" }, { "x-tenant-id": b }))
        .statusCode,
    ).toBe(201);
    expect(await folderNames(w, `t:${a}`)).toEqual(["in-a"]);
    expect(await folderNames(w, `t:${b}`)).toEqual([]);
  });

  const publicGet = (w: World, headers: Record<string, string>) =>
    w.app.inject({ method: "GET", url: "/api/v1/public/products", headers });

  it.each([
    ["absent", {}],
    ["empty", { "x-tenant-id": "" }],
    ["blank", { "x-tenant-id": "   " }],
  ])("public route, header %s → 403 (never a default storefront)", async (_label, headers) => {
    const w = await bootWorld();
    expect((await publicGet(w, headers)).statusCode).toBe(403);
  });

  it.each([
    ["unknown", "ghost"],
    ["malformed (two ids in one header)", "tenant-a, tenant-b"],
    ["malformed (path-shaped)", "../tenant-local"],
  ])(
    "public route, header %s tenant → 403 TENANT_UNKNOWN (no row, no service)",
    async (_label, id) => {
      const w = await bootWorld();
      const res = await publicGet(w, { "x-tenant-id": id });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe("TENANT_UNKNOWN");
    },
  );

  it("public route: a real tenant is served; the same route for a SUSPENDED one is refused", async () => {
    const w = await bootWorld();
    const a = await createMerchant(w, "acme", "owner-a");
    expect((await publicGet(w, { "x-tenant-id": a })).statusCode).toBe(200);
    await call(w, "op", "POST", `/tenants/${a}/suspend`);
    const res = await publicGet(w, { "x-tenant-id": a });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("TENANT_SUSPENDED");
  });

  it("an unauthenticated request to an authenticated route is a 401, not a tenant guess", async () => {
    const w = await bootWorld();
    const res = await w.app.inject({
      method: "GET",
      url: "/api/v1/media/folders",
      headers: { "x-tenant-id": PLATFORM },
    });
    expect(res.statusCode).toBe(401);
  });
});
