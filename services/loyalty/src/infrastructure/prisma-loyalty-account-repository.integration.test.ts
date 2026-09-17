import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaOutboxStore, PrismaUnitOfWork } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { OutboxWriter, rootEventContext } from "@platform/messaging";
import { LoyaltyAccount } from "../domain/loyalty-account";
import { DEFAULT_TIERS } from "../composition";
import { LoyaltyEventTranslator } from "./loyalty-event-translator";
import { PrismaLoyaltyAccountRepository } from "./prisma-loyalty-account-repository";

/**
 * Phase 4 T4.4 — real PostgreSQL coverage for the new `list` read, following the same reference
 * pattern as `services/reviews/src/infrastructure/prisma-review-repository.integration.test.ts`.
 *
 *   DATABASE_URL_TEST=postgresql://lumo:lumo@localhost:5432/lumo_test pnpm --filter @platform/loyalty test
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

describe.runIf(Boolean(databaseUrl))("PrismaLoyaltyAccountRepository (integration)", () => {
  const clock: Clock = { now: () => new Date("2026-08-30T00:00:00.000Z") };
  const ids: IdGenerator = { generate: () => crypto.randomUUID() };

  function wire(tenantId: string) {
    const prisma = createTestPrismaClient(databaseUrl);
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(prisma),
      translator: new LoyaltyEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock,
      producer: "loyalty",
    });
    const context = rootEventContext(ids, tenantId);
    const repository = new PrismaLoyaltyAccountRepository({
      prisma,
      outbox,
      context,
      tiers: DEFAULT_TIERS,
    });
    const unitOfWork = new PrismaUnitOfWork(prisma);
    return {
      prisma,
      repository,
      save: (account: LoyaltyAccount) =>
        unitOfWork.run((tx) => repository.save(account, tenantId, tx)),
    };
  }

  it("list filters by tenantId and paginates", async () => {
    const tenantId = `tenant-itest-loyalty-${crypto.randomUUID()}`;
    const other = `tenant-itest-loyalty-other-${crypto.randomUUID()}`;
    const { prisma, repository, save } = wire(tenantId);
    const { repository: otherRepository, save: saveOther } = wire(other);

    for (let i = 0; i < 3; i += 1) {
      await save(
        LoyaltyAccount.create(UniqueEntityId.from(ids.generate()), `customer-${i}`, DEFAULT_TIERS),
      );
    }
    await saveOther(
      LoyaltyAccount.create(UniqueEntityId.from(ids.generate()), "customer-x", DEFAULT_TIERS),
    );

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
