import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type {
  AccessControl,
  Authenticator,
  AuthenticatedIdentity,
  Cache,
  Clock,
  IdGenerator,
  IdempotencyClaim,
  IdempotencyKeyStore,
  RateLimiter,
} from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryAuditTrail } from "../infrastructure/in-memory-audit-trail";
import { createAdminHttpApi } from "./server";

/**
 * Plan 3C — `/shipping/zones`: Shopify's shipping zones and rates, over the real HTTP stack (zod,
 * permissions, tenant scoping, presenter). Staff permissions are `settings:read` / `settings:update`.
 */

const staff: AuthenticatedIdentity = { id: "staff-1", kind: "staff", roles: ["admin"] };
const clock: Clock = { now: () => new Date("2026-10-11T00:00:00.000Z") };
const authed = {
  authorization: "Bearer good",
  "x-tenant-id": "t-1",
  "content-type": "application/json",
};
const otherTenant = { ...authed, "x-tenant-id": "t-2" };

function buildApp(accessControl?: AccessControl): Promise<FastifyInstance> {
  const claims = new Set<string>();
  const store = new Map<string, unknown>();
  const cache: Cache = {
    get: async <T>(k: string) => (store.get(k) as T | undefined) ?? null,
    set: async (k, v) => void store.set(k, JSON.parse(JSON.stringify(v))),
    delete: async (k) => void store.delete(k),
    has: async (k) => store.has(k),
  };
  const idempotencyKeys: IdempotencyKeyStore = {
    claim: async (key): Promise<IdempotencyClaim | null> => {
      if (claims.has(key)) return null;
      claims.add(key);
      return { key, token: "t", release: async () => claims.delete(key) };
    },
  };
  const rateLimiter: RateLimiter = {
    consume: async () => ({ allowed: true, remaining: 99, retryAfterMs: 0 }),
  };
  const authenticator: Authenticator = {
    verify: async (token) => (token === "good" ? staff : null),
  };
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => crypto.randomUUID() + `-${(n += 1)}` };
  return createAdminHttpApi({
    serializer: new InMemoryEventSerializer(),
    idGenerator,
    clock,
    auditTrail: new InMemoryAuditTrail(),
    authenticator,
    rateLimiter,
    idempotencyKeys,
    responseCache: cache,
    ...(accessControl === undefined ? {} : { accessControl }),
  });
}

interface ZoneBody {
  id: string;
  name: string;
  countries: { code: string; provinces: string[] | null }[];
  rates: {
    id: string;
    name: string;
    priceMinor: number;
    condition: unknown;
    description: string | null;
  }[];
}

let keys = 0;
function send(
  app: FastifyInstance,
  method: "POST" | "PUT" | "DELETE",
  url: string,
  payload?: Record<string, unknown>,
  headers: Record<string, string> = authed,
) {
  keys += 1;
  return app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { ...headers, "idempotency-key": `zones-${keys}` },
    ...(payload === undefined ? {} : { payload }),
  });
}

const cairo = { name: "Cairo and Giza", countries: [{ code: "EG", provinces: ["EG-C", "EG-GZ"] }] };

describe("shipping zones API (Plan 3C)", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });

  async function zones(headers = authed): Promise<ZoneBody[]> {
    const res = await app.inject({ method: "GET", url: "/api/v1/shipping/zones", headers });
    expect(res.statusCode).toBe(200);
    return (res.json() as { items: ZoneBody[] }).items;
  }

  it("creates a zone, adds rates with conditions, and lists them", async () => {
    const created = await send(app, "POST", "/shipping/zones", cairo);
    expect(created.statusCode).toBe(201);
    const zoneId = (created.json() as { id: string }).id;

    const standard = await send(app, "POST", `/shipping/zones/${zoneId}/rates`, {
      name: "Standard",
      priceMinor: 5000,
      description: "2-4 business days",
    });
    const free = await send(app, "POST", `/shipping/zones/${zoneId}/rates`, {
      name: "Free over 1000",
      priceMinor: 0,
      condition: { type: "orderPrice", minMinor: 100_000 },
    });
    expect(standard.statusCode).toBe(201);
    expect(free.statusCode).toBe(201);

    const listed = (await zones()).find((zone) => zone.id === zoneId);
    expect(listed).toMatchObject({ name: "Cairo and Giza", countries: cairo.countries });
    expect(listed?.rates.map((rate) => [rate.name, rate.priceMinor, rate.condition])).toEqual([
      ["Standard", 5000, { type: "none" }],
      ["Free over 1000", 0, { type: "orderPrice", minMinor: 100_000 }],
    ]);
  });

  it("refuses a country that is already in another zone, naming that zone (422)", async () => {
    const res = await send(app, "POST", "/shipping/zones", {
      name: "Egypt",
      countries: [{ code: "EG", provinces: null }],
    });

    expect(res.statusCode).toBe(422);
    expect(JSON.stringify(res.json())).toContain("Cairo and Giza");
  });

  it("refuses an unknown country or a bad rate (422) and stores nothing", async () => {
    const badCountry = await send(app, "POST", "/shipping/zones", {
      name: "Nowhere",
      countries: [{ code: "ZZ", provinces: null }],
    });
    expect(badCountry.statusCode).toBe(422);

    const zoneId = (await zones())[0]?.id ?? "";
    const badRate = await send(app, "POST", `/shipping/zones/${zoneId}/rates`, {
      name: "Backwards",
      priceMinor: 100,
      condition: { type: "weight", minGrams: 5000, maxGrams: 1000 },
    });
    expect(badRate.statusCode).toBe(422);
    expect((await zones()).find((z) => z.id === zoneId)?.rates.map((r) => r.name)).not.toContain(
      "Backwards",
    );
  });

  it("updates and deletes a rate, then updates and deletes the zone", async () => {
    const created = await send(app, "POST", "/shipping/zones", {
      name: "Saudi",
      countries: [{ code: "SA", provinces: null }],
    });
    const zoneId = (created.json() as { id: string }).id;
    const rate = await send(app, "POST", `/shipping/zones/${zoneId}/rates`, {
      name: "Std",
      priceMinor: 20_000,
    });
    const rateId = (rate.json() as { id: string }).id;

    const edited = await send(app, "PUT", `/shipping/zones/${zoneId}/rates/${rateId}`, {
      name: "Standard",
      priceMinor: 25_000,
      condition: { type: "weight", minGrams: 0, maxGrams: 5000 },
    });
    expect(edited.statusCode).toBe(200);
    expect((await zones()).find((z) => z.id === zoneId)?.rates[0]).toMatchObject({
      name: "Standard",
      priceMinor: 25_000,
      condition: { type: "weight", minGrams: 0, maxGrams: 5000 },
    });

    expect(
      (await send(app, "DELETE", `/shipping/zones/${zoneId}/rates/${rateId}`)).statusCode,
    ).toBe(200);
    expect((await zones()).find((z) => z.id === zoneId)?.rates).toEqual([]);

    const renamed = await send(app, "PUT", `/shipping/zones/${zoneId}`, {
      name: "Saudi Arabia",
      countries: [{ code: "SA", provinces: ["SA-01", "SA-02"] }],
    });
    expect(renamed.statusCode).toBe(200);
    expect((await zones()).find((z) => z.id === zoneId)).toMatchObject({ name: "Saudi Arabia" });

    expect((await send(app, "DELETE", `/shipping/zones/${zoneId}`)).statusCode).toBe(200);
    expect((await zones()).some((z) => z.id === zoneId)).toBe(false);
  });

  it("answers 404 for a zone or rate that does not exist", async () => {
    expect((await send(app, "DELETE", "/shipping/zones/nope")).statusCode).toBe(404);
    expect(
      (await send(app, "POST", "/shipping/zones/nope/rates", { name: "X", priceMinor: 1 }))
        .statusCode,
    ).toBe(404);
    const zoneId = (await zones())[0]?.id ?? "";
    expect((await send(app, "DELETE", `/shipping/zones/${zoneId}/rates/nope`)).statusCode).toBe(
      404,
    );
  });

  it("keeps one tenant's zones from another: invisible, untouchable, and the same country is free there", async () => {
    const zoneId = (await zones())[0]?.id ?? "";

    expect(await zones(otherTenant)).toEqual([]);
    expect(
      (await send(app, "DELETE", `/shipping/zones/${zoneId}`, undefined, otherTenant)).statusCode,
    ).toBe(404);
    expect(
      (await send(app, "PUT", `/shipping/zones/${zoneId}`, cairo, otherTenant)).statusCode,
    ).toBe(404);
    const mine = await send(app, "POST", "/shipping/zones", cairo, otherTenant);
    expect(mine.statusCode).toBe(201);
    expect((await zones()).some((z) => z.id === (mine.json() as { id: string }).id)).toBe(false);
  });
});

describe("shipping zones API — permissions (Plan 3C)", () => {
  const denying = (...denied: string[]): AccessControl => ({
    authorize: async (_principal, permission) => !denied.includes(permission),
  });

  it("refuses a read without settings:read and every write without settings:update", async () => {
    const app = await buildApp(denying("settings:read", "settings:update"));
    try {
      expect(
        (await app.inject({ method: "GET", url: "/api/v1/shipping/zones", headers: authed }))
          .statusCode,
      ).toBe(403);
      expect((await send(app, "POST", "/shipping/zones", cairo)).statusCode).toBe(403);
      expect((await send(app, "PUT", "/shipping/zones/z", cairo)).statusCode).toBe(403);
      expect((await send(app, "DELETE", "/shipping/zones/z")).statusCode).toBe(403);
      expect(
        (await send(app, "POST", "/shipping/zones/z/rates", { name: "X", priceMinor: 1 }))
          .statusCode,
      ).toBe(403);
      expect(
        (await send(app, "PUT", "/shipping/zones/z/rates/r", { name: "X", priceMinor: 1 }))
          .statusCode,
      ).toBe(403);
      expect((await send(app, "DELETE", "/shipping/zones/z/rates/r")).statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it("lets a reader read but not write", async () => {
    const app = await buildApp(denying("settings:update"));
    try {
      expect(
        (await app.inject({ method: "GET", url: "/api/v1/shipping/zones", headers: authed }))
          .statusCode,
      ).toBe(200);
      expect((await send(app, "POST", "/shipping/zones", cairo)).statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });
});
