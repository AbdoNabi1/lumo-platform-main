import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { GetCurrentWorkspace } from "./get-current-workspace.use-case";
import { GetTenant } from "./get-tenant.use-case";
import { GetWorkspace } from "./get-workspace.use-case";
import { ListTenants } from "./list-tenants.use-case";
import { ListWorkspaces } from "./list-workspaces.use-case";
import { CreateTenant, CreateWorkspace } from "./tenancy.use-cases";
import {
  InMemoryTenantRepository,
  InMemoryWorkspaceRepository,
} from "../infrastructure/in-memory-repositories";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { TenancyEventTranslator } from "../infrastructure/tenancy-event-translator";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-08-30T00:00:00.000Z") };

function harness() {
  const outboxStore = new InMemoryOutboxStore();
  const outbox = new OutboxWriter({
    store: outboxStore,
    translator: new TenancyEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "tenancy",
  });
  const context = rootEventContext(sequentialIds());
  const tenants = new InMemoryTenantRepository({ outbox, context });
  const workspaces = new InMemoryWorkspaceRepository({ outbox, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const idGenerator = sequentialIds();
  return { tenants, workspaces, unitOfWork, idGenerator, clock };
}

describe("Tenancy read use-cases (Phase 4 T4.15)", () => {
  it("ListTenants paginates and GetTenant returns the tenant, or NotFoundError", async () => {
    const h = harness();
    const create = new CreateTenant(h);
    const created = await create.execute({ slug: "acme", name: "Acme Inc", isolationTier: "pooled" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const listed = await new ListTenants(h).execute({ first: 10 });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.items).toHaveLength(1);

    const found = await new GetTenant(h).execute({ tenantId: created.value.id });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value.name).toBe("Acme Inc");

    const missing = await new GetTenant(h).execute({ tenantId: "nope" });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.code).toBe("NOT_FOUND");
  });

  it("ListWorkspaces paginates and GetWorkspace returns the workspace, or NotFoundError", async () => {
    const h = harness();
    const tenant = await new CreateTenant(h).execute({
      slug: "acme",
      name: "Acme Inc",
      isolationTier: "pooled",
    });
    expect(tenant.ok).toBe(true);
    if (!tenant.ok) return;

    const created = await new CreateWorkspace(h).execute({
      tenantId: tenant.value.id,
      env: "production",
      name: "Main",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const listed = await new ListWorkspaces(h).execute({ first: 10 });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.items).toHaveLength(1);

    const found = await new GetWorkspace(h).execute({ workspaceId: created.value.id });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value.name).toBe("Main");

    const missing = await new GetWorkspace(h).execute({ workspaceId: "nope" });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.code).toBe("NOT_FOUND");
  });

  it("GetCurrentWorkspace prefers the active production workspace, and 404s when none exists", async () => {
    const h = harness();
    const missing = await new GetCurrentWorkspace(h).execute({});
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.code).toBe("NOT_FOUND");

    const tenant = await new CreateTenant(h).execute({
      slug: "acme",
      name: "Acme Inc",
      isolationTier: "pooled",
    });
    expect(tenant.ok).toBe(true);
    if (!tenant.ok) return;

    await new CreateWorkspace(h).execute({
      tenantId: tenant.value.id,
      env: "staging",
      name: "Staging",
    });
    await new CreateWorkspace(h).execute({
      tenantId: tenant.value.id,
      env: "production",
      name: "Main",
    });

    const current = await new GetCurrentWorkspace(h).execute({});
    expect(current.ok).toBe(true);
    if (!current.ok) return;
    expect(current.value.env).toBe("production");
  });
});
