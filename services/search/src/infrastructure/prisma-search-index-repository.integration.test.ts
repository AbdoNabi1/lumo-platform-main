import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaOutboxStore, PrismaUnitOfWork } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { OutboxWriter, rootEventContext } from "@platform/messaging";
import { SearchIndex } from "../domain/search-index";
import { SearchEventTranslator } from "./search-event-translator";
import { PrismaSearchIndexRepository } from "./prisma-search-index-repository";

/**
 * Phase 4 T4.3 — real PostgreSQL coverage for the new `list` read, following the same reference
 * pattern as `services/reviews/src/infrastructure/prisma-review-repository.integration.test.ts`.
 *
 *   DATABASE_URL_TEST=postgresql://lumo:lumo@localhost:5432/lumo_test pnpm --filter @platform/search test
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

describe.runIf(Boolean(databaseUrl))("PrismaSearchIndexRepository (integration)", () => {
  const clock: Clock = { now: () => new Date("2026-08-30T00:00:00.000Z") };
  const ids: IdGenerator = { generate: () => crypto.randomUUID() };

  function wire(tenantId: string) {
    const prisma = createTestPrismaClient(databaseUrl);
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(prisma),
      translator: new SearchEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock,
      producer: "search",
    });
    const context = rootEventContext(ids, tenantId);
    const repository = new PrismaSearchIndexRepository({ prisma, outbox, context });
    const unitOfWork = new PrismaUnitOfWork(prisma);
    return {
      prisma,
      repository,
      save: (index: SearchIndex) => unitOfWork.run((tx) => repository.save(index, tenantId, tx)),
    };
  }

  it("list filters by tenantId and paginates", async () => {
    const tenantId = `tenant-itest-search-${crypto.randomUUID()}`;
    const other = `tenant-itest-search-other-${crypto.randomUUID()}`;
    const { prisma, repository, save } = wire(tenantId);
    const { repository: otherRepository, save: saveOther } = wire(other);

    for (let i = 0; i < 3; i += 1) {
      await save(SearchIndex.create(UniqueEntityId.from(ids.generate()), `index-${i}`));
    }
    await saveOther(SearchIndex.create(UniqueEntityId.from(ids.generate()), "index-x"));

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
