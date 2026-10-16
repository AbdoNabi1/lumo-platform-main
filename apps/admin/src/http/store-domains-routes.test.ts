import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator, Principal } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { RouteDefinition } from "@platform/http";
import { wireAdmin } from "../composition";
import { storeDomainsRoutes } from "./store-domains-routes";
import { tenancyRoutes } from "./tenancy-routes";

/**
 * Merchant domain routes: every `/store/domains*` route acts on `context.tenantId` as the shop, so
 * one store can never see or change another store's domains.
 */

const clock: Clock = { now: () => new Date("2026-10-16T00:00:00.000Z") };
const staff: Principal = { id: "staff-1", kind: "staff", roles: ["admin"], tenantId: "x" };

function wire() {
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => `id-${(n += 1)}` };
  const admin = wireAdmin({
    serializer: new InMemoryEventSerializer(),
    idGenerator,
    clock,
    platformStoreDomain: "morbeh.store",
    dnsVerifier: { pointsToPlatform: async () => true },
  });
  return { operator: tenancyRoutes(admin), store: storeDomainsRoutes(admin) };
}

function route(all: readonly RouteDefinition[], method: string, path: string): RouteDefinition {
  const found = all.find((r) => r.method === method && r.path === path);
  if (found === undefined) throw new Error(`no route ${method} ${path}`);
  return found;
}

type Res = { status: number; body: unknown };
const field = (res: Res, key: string): unknown => (res.body as Record<string, unknown>)[key];
const items = (res: Res): ReadonlyArray<Record<string, unknown>> =>
  (res.body as { items: ReadonlyArray<Record<string, unknown>> }).items;
function call(
  r: RouteDefinition,
  shopId: string,
  params: object = {},
  body?: unknown,
): Promise<Res> {
  return r.handle({
    body,
    params,
    query: {},
    context: { tenantId: shopId, principal: staff, requestId: "req-1" },
  } as never) as Promise<Res>;
}

async function createShop(all: readonly RouteDefinition[], slug: string): Promise<string> {
  const created = await call(
    route(all, "POST", "/tenants"),
    "platform",
    {},
    { slug, name: slug, isolationTier: "pooled" },
  );
  expect(created.status).toBe(201);
  return field(created, "id") as string;
}

describe("merchant domain routes (/store/domains)", () => {
  it("registers the four routes at version 1 with the settings permissions", () => {
    const { store } = wire();
    expect(
      store.map((r) => [r.method, r.path, r.version, r.permission, r.idempotent ?? false]),
    ).toEqual([
      ["GET", "/store/domains", 1, "settings:read", false],
      ["POST", "/store/domains", 1, "settings:update", true],
      ["POST", "/store/domains/:domainId/verify", 1, "settings:update", true],
      ["POST", "/store/domains/:domainId/primary", 1, "settings:update", true],
    ]);
  });

  it("a store adds, verifies and promotes its own domain; another store sees none of it", async () => {
    const { operator, store } = wire();
    const shopA = await createShop(operator, "shop-a");
    const shopB = await createShop(operator, "shop-b");

    const added = await call(
      route(store, "POST", "/store/domains"),
      shopA,
      {},
      {
        hostname: "shop-a.example.com",
      },
    );
    expect(added.status).toBe(201);
    const domainId = field(added, "id") as string;

    const listA = await call(route(store, "GET", "/store/domains"), shopA);
    expect(items(listA).map((d) => d["hostname"])).toContain("shop-a.example.com");
    const listB = await call(route(store, "GET", "/store/domains"), shopB);
    expect(items(listB).map((d) => d["hostname"])).not.toContain("shop-a.example.com");

    const verified = await call(route(store, "POST", "/store/domains/:domainId/verify"), shopA, {
      domainId,
    });
    expect(verified.status).toBe(200);
    const primary = await call(route(store, "POST", "/store/domains/:domainId/primary"), shopA, {
      domainId,
    });
    expect(primary.status).toBe(200);
    expect(field(primary, "isPrimary")).toBe(true);
  });

  it("another store's domain id is 404 for verify and primary, and nothing changes", async () => {
    const { operator, store } = wire();
    const shopA = await createShop(operator, "shop-a");
    const shopB = await createShop(operator, "shop-b");
    const added = await call(
      route(store, "POST", "/store/domains"),
      shopA,
      {},
      {
        hostname: "shop-a.example.com",
      },
    );
    const domainId = field(added, "id") as string;

    const verify = await call(route(store, "POST", "/store/domains/:domainId/verify"), shopB, {
      domainId,
    });
    expect(verify.status).toBe(404);
    const primary = await call(route(store, "POST", "/store/domains/:domainId/primary"), shopB, {
      domainId,
    });
    expect(primary.status).toBe(404);

    const listA = await call(route(store, "GET", "/store/domains"), shopA);
    const mine = items(listA).find((d) => d["id"] === domainId);
    expect(mine).toMatchObject({ status: "pending", isPrimary: false });
  });

  it("rejects a body that tries to name the shop or is not a valid hostname length", () => {
    const { store } = wire();
    const add = route(store, "POST", "/store/domains");
    const body = add.schema?.body as { safeParse: (v: unknown) => { success: boolean } };
    expect(body.safeParse({ hostname: "a.example.com" }).success).toBe(true);
    expect(body.safeParse({ hostname: "ab" }).success).toBe(false);
    expect(body.safeParse({ hostname: "a".repeat(254) }).success).toBe(false);
    expect(body.safeParse({ hostname: "a.example.com", shopId: "other" }).success).toBe(false);
  });
});
