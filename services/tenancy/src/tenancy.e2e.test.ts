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
