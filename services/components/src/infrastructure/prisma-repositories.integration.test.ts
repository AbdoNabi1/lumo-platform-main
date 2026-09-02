import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaOutboxStore, PrismaUnitOfWork } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { OutboxWriter, rootEventContext } from "@platform/messaging";
import { ComponentDefinition } from "../domain/component-definition";
import { ComponentContract } from "../domain/value-objects/component-contract";
import { ComponentSchema } from "../domain/value-objects/component-schema";
import { ComponentsEventTranslator } from "./components-event-translator";
import { PrismaComponentDefinitionRepository } from "./prisma-repositories";

/**
 * Phase 4 T4.9 — real PostgreSQL coverage for the new `list` read, following the same reference
 * pattern as `services/reviews/src/infrastructure/prisma-review-repository.integration.test.ts`.
 *
 *   DATABASE_URL_TEST=postgresql://lumo:lumo@localhost:5432/lumo_test pnpm --filter @platform/components test
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

describe.runIf(Boolean(databaseUrl))("PrismaComponentDefinitionRepository (integration)", () => {
  const clock: Clock = { now: () => new Date("2026-08-30T00:00:00.000Z") };
  const ids: IdGenerator = { generate: () => crypto.randomUUID() };

  function wire(tenantId: string) {
    const prisma = createTestPrismaClient(databaseUrl);
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(prisma),
      translator: new ComponentsEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock,
      producer: "components",
    });
    const context = rootEventContext(ids, tenantId);
    const repository = new PrismaComponentDefinitionRepository({ prisma, tenantId, outbox, context });
    const unitOfWork = new PrismaUnitOfWork(prisma);
    return {
      prisma,
      repository,
      save: (definition: ComponentDefinition) =>
        unitOfWork.run((tx) => repository.save(definition, tx)),
    };
  }

  function newDefinition(key: string): ComponentDefinition {
    return ComponentDefinition.create(
      UniqueEntityId.from(ids.generate()),
      key,
      "Hero",
      ComponentSchema.create([]),
      ComponentContract.create({ slots: [], events: [], responsive: true }),
    );
  }

  it("list filters by tenantId and paginates", async () => {
    const tenantId = `tenant-itest-components-${crypto.randomUUID()}`;
    const other = `tenant-itest-components-other-${crypto.randomUUID()}`;
    const { prisma, repository, save } = wire(tenantId);
    const { repository: otherRepository, save: saveOther } = wire(other);

    for (let i = 0; i < 3; i += 1) {
      await save(newDefinition(`component-${i}`));
    }
    await saveOther(newDefinition("component-x"));

    const page = await repository.list({ first: 2 });
    expect(page.items).toHaveLength(2);
    expect(page.pageInfo.hasNextPage).toBe(true);

    const rest = await repository.list({ first: 10, after: page.pageInfo.endCursor ?? undefined });
    expect(rest.items).toHaveLength(1);
    expect(rest.pageInfo.hasNextPage).toBe(false);

    const otherPage = await otherRepository.list({ first: 10 });
    expect(otherPage.items).toHaveLength(1);
    await prisma.$disconnect();
  });
});
