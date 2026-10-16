import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator, Principal } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import type { RouteDefinition } from "@platform/http";
import { wireAdmin } from "../composition";
import { tenancyRoutes } from "./tenancy-routes";

const clock: Clock = { now: () => new Date("2026-10-05T00:00:00.000Z") };
const staff: Principal = {
  id: "staff-1",
  kind: "staff",
  roles: ["admin"],
  tenantId: "tenant-local",
};

function routes(): readonly RouteDefinition[] {
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => `id-${(n += 1)}` };
  const admin = wireAdmin({
    serializer: new InMemoryEventSerializer(),
    idGenerator,
    clock,
    platformStoreDomain: "morbeh.store",
    dnsVerifier: { pointsToPlatform: async (host: string) => host === "acme.com" },
  });
  return tenancyRoutes(admin);
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
function call(r: RouteDefinition, params: object, query: object, body?: unknown): Promise<Res> {
  return r.handle({
    body,
    params,
    query,
    context: { tenantId: "tenant-local", principal: staff, requestId: "req-1" },
  } as never) as Promise<Res>;
}

describe("shop domain routes (Plan 1A)", () => {
  it("a new shop resolves on its platform subdomain through the public route", async () => {
    const all = routes();
    const created = await call(
      route(all, "POST", "/tenants"),
      {},
      {},
      {
        slug: "acme",
        name: "Acme",
        isolationTier: "pooled",
      },
    );
    expect(created.status).toBe(201);
    const resolve = route(all, "GET", "/public/domains/resolve");
    expect(resolve.public).toBe(true);
    const hit = await call(resolve, {}, { host: "ACME.morbeh.store" });
    expect(hit.status).toBe(200);
    expect(hit.body).toEqual({
      shopId: field(created, "id"),
      hostname: "acme.morbeh.store",
      primaryHostname: "acme.morbeh.store",
      shopStatus: "active",
    });
    const miss = await call(resolve, {}, { host: "nobody.morbeh.store" });
    expect(miss.status).toBe(404);
  });

  it("add → verify → primary moves the shop's primary hostname to the custom domain", async () => {
    const all = routes();
    const created = await call(
      route(all, "POST", "/tenants"),
      {},
      {},
      {
        slug: "acme",
        name: "Acme",
        isolationTier: "pooled",
      },
    );
    const shopId = field(created, "id") as string;
    const added = await call(
      route(all, "POST", "/tenants/:tenantId/domains"),
      { tenantId: shopId },
      {},
      {
        hostname: "acme.com",
      },
    );
    expect(added.status).toBe(201);
    const domainId = field(added, "id") as string;
    expect(
      (await call(route(all, "POST", "/domains/:domainId/verify"), { domainId }, {})).status,
    ).toBe(200);
    expect(
      (await call(route(all, "POST", "/domains/:domainId/primary"), { domainId }, {})).status,
    ).toBe(200);
    const listed = await call(
      route(all, "GET", "/tenants/:tenantId/domains"),
      { tenantId: shopId },
      {},
    );
    expect(items(listed).map((d) => [d["hostname"], d["isPrimary"]])).toEqual([
      ["acme.com", true],
      ["acme.morbeh.store", false],
    ]);
    const hit = await call(
      route(all, "GET", "/public/domains/resolve"),
      {},
      { host: "acme.morbeh.store" },
    );
    expect(field(hit, "primaryHostname")).toBe("acme.com");
  });

  it("never puts aggregate internals on the wire", async () => {
    const all = routes();
    const created = await call(
      route(all, "POST", "/tenants"),
      {},
      {},
      {
        slug: "acme",
        name: "Acme",
        isolationTier: "pooled",
      },
    );
    const listed = await call(
      route(all, "GET", "/tenants/:tenantId/domains"),
      { tenantId: field(created, "id") as string },
      {},
    );
    for (const item of items(listed)) {
      expect(item).not.toHaveProperty("props");
      expect(item).not.toHaveProperty("_id");
    }
  });
});
