import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireTenancy } from "./composition";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-07-13T00:00:00.000Z") };

function wire() {
  return wireTenancy({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
  });
}

describe("tenancy (end to end)", () => {
  it("creates a tenant, a workspace, rebrands and configures, publishing canonical events", async () => {
    const app = wire();
    const tenant = await app.tenancy.createTenant({
      slug: "acme",
      name: "Acme Inc",
      isolationTier: "pooled",
    });
    expect(tenant.status).toBe(201);
    const tenantId = (tenant.body as { id: string }).id;

    const workspace = await app.tenancy.createWorkspace({
      tenantId,
      env: "production",
      name: "Main",
    });
    expect(workspace.status).toBe(201);
    const workspaceId = (workspace.body as { id: string }).id;

    const rebrand = await app.tenancy.rebrandTenant({ tenantId, branding: { logo: "logo-1" } });
    expect(rebrand.status).toBe(200);

    const configure = await app.tenancy.configureWorkspace({
      workspaceId,
      config: { themeRef: "theme-1", locale: "en-US" },
    });
    expect(configure.status).toBe(200);

    expect(await app.drainOutbox()).toBeGreaterThan(0);
    expect(app.deliveredEventTypes).toContain("tenancy.tenant.created");
    expect(app.deliveredEventTypes).toContain("tenancy.workspace.configured");
  });

  it("rejects creating a duplicate tenant slug (409)", async () => {
    const app = wire();
    await app.tenancy.createTenant({ slug: "acme", name: "Acme Inc", isolationTier: "pooled" });
    const response = await app.tenancy.createTenant({
      slug: "acme",
      name: "Acme Duplicate",
      isolationTier: "pooled",
    });
    expect(response.status).toBe(409);
  });

  it("rejects suspending an unknown tenant (404)", async () => {
    const app = wire();
    const response = await app.tenancy.suspendTenant({ tenantId: "missing" });
    expect(response.status).toBe(404);
  });
});

describe("tenancy lifecycle protections (T10.6)", () => {
  const PLATFORM = "platform";
  function wireWithPlatform() {
    // `CreateTenant` draws the tenant id first, so `nextId` makes the first tenant the platform one.
    const seq = sequentialIds();
    const forcing = { nextId: null as string | null };
    const wired = wireTenancy({
      serializer: new InMemoryEventSerializer(),
      idGenerator: {
        generate: () => {
          const forced = forcing.nextId;
          forcing.nextId = null;
          return forced ?? seq.generate();
        },
      },
      clock,
      protectedTenantIds: [PLATFORM],
    });
    forcing.nextId = PLATFORM;
    return wired;
  }

  it("the platform tenant cannot be suspended through the ordinary lifecycle", async () => {
    const app = wireWithPlatform();
    const created = await app.tenancy.createTenant({
      slug: "morbeh",
      name: "Morbeh",
      isolationTier: "pooled",
    });
    const id = (created.body as { id: string }).id;
    expect(id).toBe(PLATFORM);
    const res = await app.tenancy.suspendTenant({ tenantId: id });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(res.body)).toMatch(/platform tenant/i);
    expect(await app.tenantAvailability(id)).toBe("active");
  });

  it("the platform tenant cannot be cancelled through the ordinary lifecycle", async () => {
    const app = wireWithPlatform();
    const created = await app.tenancy.createTenant({
      slug: "morbeh",
      name: "Morbeh",
      isolationTier: "pooled",
    });
    const id = (created.body as { id: string }).id;
    const res = await app.tenancy.cancelTenant({ tenantId: id });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await app.tenantAvailability(id)).toBe("active");
  });

  it("a protected id is refused even before a row exists (no create-then-suspend window)", async () => {
    const app = wireWithPlatform();
    const res = await app.tenancy.suspendTenant({ tenantId: PLATFORM });
    expect(res.status).not.toBe(404);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("an ordinary tenant can still be suspended, reactivated and cancelled", async () => {
    const app = wireWithPlatform();
    await app.tenancy.createTenant({ slug: "morbeh", name: "Morbeh", isolationTier: "pooled" });
    const merchant = await app.tenancy.createTenant({
      slug: "acme",
      name: "Acme",
      isolationTier: "pooled",
    });
    const id = (merchant.body as { id: string }).id;
    expect(await app.tenantAvailability(id)).toBe("active");
    expect((await app.tenancy.suspendTenant({ tenantId: id })).status).toBe(200);
    expect(await app.tenantAvailability(id)).toBe("suspended");
    expect((await app.tenancy.activateTenant({ tenantId: id })).status).toBe(200);
    expect((await app.tenancy.cancelTenant({ tenantId: id })).status).toBe(200);
    expect(await app.tenantAvailability(id)).toBe("cancelled");
  });

  it("reports an unknown tenant as unknown, not active", async () => {
    expect(await wire().tenantAvailability("nope")).toBe("unknown");
  });
});
