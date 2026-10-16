import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaOutboxStore, PrismaUnitOfWork } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { OutboxWriter, rootEventContext } from "@platform/messaging";
import { RecommendationModel } from "../domain/recommendation-model";
import { RecommendationStrategy } from "../domain/value-objects/recommendation-strategy";
import { RecommendationsEventTranslator } from "./recommendations-event-translator";
import { PrismaRecommendationModelRepository } from "./prisma-recommendation-model-repository";

/**
 * Phase 4 T4.18 — real PostgreSQL coverage for the new `list` read, following the same reference
 * pattern as `services/reviews/src/infrastructure/prisma-review-repository.integration.test.ts`.
 *
 *   DATABASE_URL_TEST=postgresql://lumo:lumo@localhost:5432/lumo_test pnpm --filter @platform/recommendations test
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

describe.runIf(Boolean(databaseUrl))("PrismaRecommendationModelRepository (integration)", () => {
  const clock: Clock = { now: () => new Date("2026-08-30T00:00:00.000Z") };
  const ids: IdGenerator = { generate: () => crypto.randomUUID() };

  function wire(tenantId: string) {
    const prisma = createTestPrismaClient(databaseUrl);
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(prisma),
      translator: new RecommendationsEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock,
      producer: "recommendations",
    });
    const context = rootEventContext(ids, tenantId);
    const repository = new PrismaRecommendationModelRepository({
      prisma,
      outbox,
      context,
    });
    const unitOfWork = new PrismaUnitOfWork(prisma);
    return {
      prisma,
      repository,
      save: (model: RecommendationModel) =>
        unitOfWork.run((tx) => repository.save(model, tenantId, tx)),
    };
  }

  function newModel(name: string): RecommendationModel {
    const strategy = RecommendationStrategy.create("related");
    if (!strategy.ok) throw new Error("test setup: invalid strategy");
    return RecommendationModel.create(UniqueEntityId.from(ids.generate()), name, strategy.value);
  }

  it("list filters by tenantId and paginates", async () => {
    const tenantId = `tenant-itest-models-${crypto.randomUUID()}`;
    const other = `tenant-itest-models-other-${crypto.randomUUID()}`;
    const { prisma, repository, save } = wire(tenantId);
    const { repository: otherRepository, save: saveOther } = wire(other);

    for (let i = 0; i < 3; i += 1) {
      await save(newModel(`model-${i}`));
    }
    await saveOther(newModel("model-x"));

    const page = await repository.list({ first: 2 }, tenantId);
    expect(page.items).toHaveLength(2);
    expect(page.pageInfo.hasNextPage).toBe(true);

    const rest = await repository.list(
      { first: 10, after: page.pageInfo.endCursor ?? undefined },
      tenantId,
    );
    expect(rest.items).toHaveLength(1);
    expect(rest.pageInfo.hasNextPage).toBe(false);

    const otherPage = await otherRepository.list({ first: 10 }, other);
    expect(otherPage.items).toHaveLength(1);

    // T10.5: a SINGLE repository instance, asked for a different tenant, must not blend the two —
    // `repository` was wired against `tenantId` but is otherwise a stateless singleton (ADR-0014).
    const crossTenantPage = await repository.list({ first: 10 }, other);
    expect(crossTenantPage.items).toHaveLength(1);

    await prisma.$disconnect();
  });
});
