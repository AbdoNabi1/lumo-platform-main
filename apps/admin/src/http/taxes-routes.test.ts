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
 * Plan 3C — `/taxes`: Shopify's Taxes and duties over the real HTTP stack (zod, permissions, tenant
 * scoping, presenter). Staff permissions are `settings:read` / `settings:update`.
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

interface TaxBody {
  pricesIncludeTax: boolean;
  chargeTaxOnShipping: boolean;
  regions: {
    countryCode: string;
    rateBasisPoints: number;
    provinces: { code: string; rateBasisPoints: number }[];
  }[];
}

let keys = 0;
function send(
  app: FastifyInstance,
  method: "PUT" | "DELETE",
  url: string,
  payload?: Record<string, unknown>,
  headers: Record<string, string> = authed,
) {
  keys += 1;
  return app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { ...headers, "idempotency-key": `taxes-${keys}` },
    ...(payload === undefined ? {} : { payload }),
  });
}

async function read(app: FastifyInstance, headers = authed): Promise<TaxBody> {
  const res = await app.inject({ method: "GET", url: "/api/v1/taxes", headers });
  expect(res.statusCode).toBe(200);
  return res.json() as TaxBody;
}

describe("taxes API (Plan 3C)", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it("answers the defaults before anything is saved: prices include tax, no shipping tax, no regions", async () => {
    expect(await read(app)).toEqual({
      pricesIncludeTax: true,
      chargeTaxOnShipping: false,
      regions: [],
    });
  });

  it("saves the two switches", async () => {
    const res = await send(app, "PUT", "/taxes/settings", {
      pricesIncludeTax: false,
      chargeTaxOnShipping: true,
    });

    expect(res.statusCode).toBe(200);
    expect(await read(app)).toMatchObject({ pricesIncludeTax: false, chargeTaxOnShipping: true });
  });

  it("adds Egypt at 14% with a Cairo override, then changes it", async () => {
    const added = await send(app, "PUT", "/taxes/regions/EG", {
      rateBasisPoints: 1400,
      provinces: [{ code: "EG-C", rateBasisPoints: 1000 }],
    });
    expect(added.statusCode).toBe(200);
    expect((await read(app)).regions).toEqual([
      {
        countryCode: "EG",
        rateBasisPoints: 1400,
        provinces: [{ code: "EG-C", rateBasisPoints: 1000 }],
      },
    ]);

    await send(app, "PUT", "/taxes/regions/EG", { rateBasisPoints: 1500, provinces: [] });
    expect((await read(app)).regions).toEqual([
      { countryCode: "EG", rateBasisPoints: 1500, provinces: [] },
    ]);
  });

  it("refuses a rate above 100%, an unknown country, and a province of another country (422)", async () => {
    expect(
      (await send(app, "PUT", "/taxes/regions/EG", { rateBasisPoints: 10_001, provinces: [] }))
        .statusCode,
    ).toBe(422);
    expect(
      (await send(app, "PUT", "/taxes/regions/ZZ", { rateBasisPoints: 100, provinces: [] }))
        .statusCode,
    ).toBe(422);
    expect(
      (
        await send(app, "PUT", "/taxes/regions/EG", {
          rateBasisPoints: 1400,
          provinces: [{ code: "SA-01", rateBasisPoints: 100 }],
        })
      ).statusCode,
    ).toBe(422);
    expect((await read(app)).regions[0]?.rateBasisPoints).toBe(1500);
  });

  it("removes a region, and answers 404 for one that is not there", async () => {
    expect((await send(app, "DELETE", "/taxes/regions/EG")).statusCode).toBe(200);
    expect((await read(app)).regions).toEqual([]);
    expect((await send(app, "DELETE", "/taxes/regions/EG")).statusCode).toBe(404);
  });

  it("keeps one tenant's tax to itself", async () => {
    await send(app, "PUT", "/taxes/regions/SA", { rateBasisPoints: 1500, provinces: [] });

    expect((await read(app, otherTenant)).regions).toEqual([]);
    expect(
      (await send(app, "DELETE", "/taxes/regions/SA", undefined, otherTenant)).statusCode,
    ).toBe(404);
    expect((await read(app)).regions).toHaveLength(1);
  });
});

describe("taxes API — permissions (Plan 3C)", () => {
  const denying = (...denied: string[]): AccessControl => ({
    authorize: async (_principal, permission) => !denied.includes(permission),
  });

  it("refuses a read without settings:read and every write without settings:update", async () => {
    const app = await buildApp(denying("settings:read", "settings:update"));
    try {
      expect(
        (await app.inject({ method: "GET", url: "/api/v1/taxes", headers: authed })).statusCode,
      ).toBe(403);
      expect(
        (
          await send(app, "PUT", "/taxes/settings", {
            pricesIncludeTax: true,
            chargeTaxOnShipping: false,
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (await send(app, "PUT", "/taxes/regions/EG", { rateBasisPoints: 1, provinces: [] }))
          .statusCode,
      ).toBe(403);
      expect((await send(app, "DELETE", "/taxes/regions/EG")).statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });

  it("lets a reader read but not write", async () => {
    const app = await buildApp(denying("settings:update"));
    try {
      expect(
        (await app.inject({ method: "GET", url: "/api/v1/taxes", headers: authed })).statusCode,
      ).toBe(200);
      expect(
        (await send(app, "PUT", "/taxes/regions/EG", { rateBasisPoints: 1, provinces: [] }))
          .statusCode,
      ).toBe(403);
    } finally {
      await app.close();
    }
  });
});
