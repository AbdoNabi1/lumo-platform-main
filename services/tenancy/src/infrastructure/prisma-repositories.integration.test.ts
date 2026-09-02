import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaOutboxStore, PrismaUnitOfWork } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { OutboxWriter, rootEventContext } from "@platform/messaging";
import { Tenant } from "../domain/tenant";
import { TenantSlug } from "../domain/value-objects/tenant-slug";
import { Workspace } from "../domain/workspace";
import { TenancyEventTranslator } from "./tenancy-event-translator";
import { PrismaTenantRepository, PrismaWorkspaceRepository } from "./prisma-repositories";

/**
 * Phase 4 T4.15 — real PostgreSQL coverage for the new `list` reads and `findCurrent`'s
 * production-first tie-break, following the same reference pattern as
 * `services/reviews/src/infrastructure/prisma-review-repository.integration.test.ts`.
 *
 *   DATABASE_URL_TEST=postgresql://lumo:lumo@localhost:5432/lumo_test pnpm --filter @platform/tenancy test
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

describe.runIf(Boolean(databaseUrl))("Prisma Tenancy repositories (integration)", () => {
  const clock: Clock = { now: () => new Date("2026-08-30T00:00:00.000Z") };
  const ids: IdGenerator = { generate: () => crypto.randomUUID() };

  function wire(tenantId: string) {
    const prisma = createTestPrismaClient(databaseUrl);
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(prisma),
      translator: new TenancyEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock,
      producer: "tenancy",
    });
    const context = rootEventContext(ids, tenantId);
    const tenants = new PrismaTenantRepository({ prisma, tenantId, outbox, context });
    const workspaces = new PrismaWorkspaceRepository({ prisma, tenantId, outbox, context });
    const unitOfWork = new PrismaUnitOfWork(prisma);
    return {
      prisma,
      tenants,
      workspaces,
      saveTenant: (t: Tenant) => unitOfWork.run((tx) => tenants.save(t, tx)),
      saveWorkspace: (w: Workspace) => unitOfWork.run((tx) => workspaces.save(w, tx)),
    };
  }

  it("PrismaTenantRepository.list filters by tenantId and paginates", async () => {
    const tenantId = `tenant-itest-tenants-${crypto.randomUUID()}`;
    const { prisma, tenants, saveTenant } = wire(tenantId);
    for (let i = 0; i < 2; i += 1) {
      const slug = TenantSlug.create(`acme-${i}-${crypto.randomUUID().slice(0, 8)}`);
      if (!slug.ok) throw new Error("test setup: invalid slug");
      await saveTenant(
        Tenant.create(
          UniqueEntityId.from(ids.generate()),
          slug.value,
          "Acme Inc",
          "pooled",
          ids.generate(),
          clock.now(),
        ),
      );
    }
    const page = await tenants.list({ first: 10 });
    expect(page.items).toHaveLength(2);
    await prisma.$disconnect();
  });

  it("PrismaWorkspaceRepository.findCurrent prefers an active production workspace", async () => {
    const tenantId = `tenant-itest-workspaces-${crypto.randomUUID()}`;
    const { prisma, workspaces, saveWorkspace } = wire(tenantId);

    await saveWorkspace(
      Workspace.create(
        UniqueEntityId.from(ids.generate()),
        "some-tenant-ref",
        "staging",
        "Staging",
        ids.generate(),
        clock.now(),
      ),
    );
    await saveWorkspace(
      Workspace.create(
        UniqueEntityId.from(ids.generate()),
        "some-tenant-ref",
        "production",
        "Main",
        ids.generate(),
        clock.now(),
      ),
    );

    const current = await workspaces.findCurrent();
    expect(current?.env).toBe("production");

    const page = await workspaces.list({ first: 10 });
    expect(page.items).toHaveLength(2);
    await prisma.$disconnect();
  });
});
