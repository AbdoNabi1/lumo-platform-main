import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaOutboxStore, PrismaUnitOfWork } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { OutboxWriter, rootEventContext } from "@platform/messaging";
import { Experiment } from "../domain/experiment";
import { ExperimentAudience, Variant } from "../domain/value-objects/variant";
import { ExperimentationEventTranslator } from "./experimentation-event-translator";
import { PrismaExperimentRepository } from "./prisma-experiment-repository";

/**
 * Phase 4 T4.17 — real PostgreSQL coverage for the new `list` read, following the same reference
 * pattern as `services/reviews/src/infrastructure/prisma-review-repository.integration.test.ts`.
 *
 *   DATABASE_URL_TEST=postgresql://lumo:lumo@localhost:5432/lumo_test pnpm --filter @platform/experimentation test
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

describe.runIf(Boolean(databaseUrl))("PrismaExperimentRepository (integration)", () => {
  const clock: Clock = { now: () => new Date("2026-08-30T00:00:00.000Z") };
  const ids: IdGenerator = { generate: () => crypto.randomUUID() };

  function wire(tenantId: string) {
    const prisma = createTestPrismaClient(databaseUrl);
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(prisma),
      translator: new ExperimentationEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock,
      producer: "experiment",
    });
    const context = rootEventContext(ids, tenantId);
    const repository = new PrismaExperimentRepository({ prisma, tenantId, outbox, context });
    const unitOfWork = new PrismaUnitOfWork(prisma);
    return {
      prisma,
      repository,
      save: (experiment: Experiment) => unitOfWork.run((tx) => repository.save(experiment, tx)),
    };
  }

  function newExperiment(name: string): Experiment {
    const control = Variant.create("control", 50, true);
    const treatment = Variant.create("treatment", 50, false);
    if (!control.ok || !treatment.ok) throw new Error("test setup: invalid variant");
    return Experiment.create(
      UniqueEntityId.from(ids.generate()),
      name,
      [control.value, treatment.value],
      ExperimentAudience.everyone(),
      "conversion_rate",
    );
  }

  it("list filters by tenantId and paginates", async () => {
    const tenantId = `tenant-itest-experiments-${crypto.randomUUID()}`;
    const other = `tenant-itest-experiments-other-${crypto.randomUUID()}`;
    const { prisma, repository, save } = wire(tenantId);
    const { repository: otherRepository, save: saveOther } = wire(other);

    for (let i = 0; i < 3; i += 1) {
      await save(newExperiment(`experiment-${i}`));
    }
    await saveOther(newExperiment("experiment-x"));

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
