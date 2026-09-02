import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaOutboxStore, PrismaUnitOfWork } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { OutboxWriter, rootEventContext } from "@platform/messaging";
import { Wishlist } from "../domain/wishlist";
import { WishlistEventTranslator } from "./wishlist-event-translator";
import { PrismaWishlistRepository } from "./prisma-wishlist-repository";

/**
 * Phase 4 T4.2 — real PostgreSQL coverage for the new `list` read, following the same reference
 * pattern as `services/reviews/src/infrastructure/prisma-review-repository.integration.test.ts`.
 *
 *   DATABASE_URL_TEST=postgresql://lumo:lumo@localhost:5432/lumo_test pnpm --filter @platform/wishlist test
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

describe.runIf(Boolean(databaseUrl))("PrismaWishlistRepository (integration)", () => {
  const clock: Clock = { now: () => new Date("2026-08-30T00:00:00.000Z") };
  const ids: IdGenerator = { generate: () => crypto.randomUUID() };

  function wire(tenantId: string) {
    const prisma = createTestPrismaClient(databaseUrl);
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(prisma),
      translator: new WishlistEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock,
      producer: "wishlist",
    });
    const context = rootEventContext(ids, tenantId);
    const repository = new PrismaWishlistRepository({ prisma, outbox, context, tenantId });
    const unitOfWork = new PrismaUnitOfWork(prisma);
    return {
      prisma,
      repository,
      save: (wishlist: Wishlist) => unitOfWork.run((tx) => repository.save(wishlist, tx)),
    };
  }

  it("list filters by tenantId and paginates", async () => {
    const tenantId = `tenant-itest-wishlist-${crypto.randomUUID()}`;
    const other = `tenant-itest-wishlist-other-${crypto.randomUUID()}`;
    const { prisma, repository, save } = wire(tenantId);
    const { repository: otherRepository, save: saveOther } = wire(other);

    for (let i = 0; i < 3; i += 1) {
      await save(Wishlist.create(UniqueEntityId.from(ids.generate()), `customer-${i}`));
    }
    await saveOther(Wishlist.create(UniqueEntityId.from(ids.generate()), "customer-x"));

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
