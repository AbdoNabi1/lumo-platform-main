import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaOutboxStore, PrismaUnitOfWork } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { OutboxWriter, rootEventContext } from "@platform/messaging";
import { Review } from "../domain/review";
import { Rating } from "../domain/value-objects/rating";
import { ReviewMedia } from "../domain/value-objects/review-media";
import { ReviewsEventTranslator } from "./reviews-event-translator";
import { PrismaReviewRepository } from "./prisma-review-repository";

/**
 * Phase 4 T4.1 — real PostgreSQL coverage for the new `list`/`findByProductRef` reads, following
 * the same reference pattern as
 * `services/inventory/src/infrastructure/prisma-inventory-item-repository.integration.test.ts`.
 *
 *   DATABASE_URL_TEST=postgresql://lumo:lumo@localhost:5432/lumo_test pnpm --filter @platform/reviews test
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

describe.runIf(Boolean(databaseUrl))("PrismaReviewRepository (integration)", () => {
  const clock: Clock = { now: () => new Date("2026-08-30T00:00:00.000Z") };
  const ids: IdGenerator = { generate: () => crypto.randomUUID() };

  function wire(tenantId: string) {
    const prisma = createTestPrismaClient(databaseUrl);
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(prisma),
      translator: new ReviewsEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock,
      producer: "reviews",
    });
    const context = rootEventContext(ids, tenantId);
    const repository = new PrismaReviewRepository({ prisma, outbox, context, tenantId });
    const unitOfWork = new PrismaUnitOfWork(prisma);
    return {
      prisma,
      repository,
      save: (review: Review) => unitOfWork.run((tx) => repository.save(review, tx)),
    };
  }

  function newReview(productRef: string, customerRef: string): Review {
    const rating = Rating.create(5);
    if (!rating.ok) throw new Error("test setup: invalid rating");
    return Review.create(
      UniqueEntityId.from(ids.generate()),
      productRef,
      customerRef,
      rating.value,
      "Great!",
      ReviewMedia.create([]),
      false,
    );
  }

  it("list filters by tenantId and paginates", async () => {
    const tenantId = `tenant-itest-reviews-${crypto.randomUUID()}`;
    const other = `tenant-itest-reviews-other-${crypto.randomUUID()}`;
    const { prisma, repository, save } = wire(tenantId);
    const { repository: otherRepository, save: saveOther } = wire(other);

    for (let i = 0; i < 3; i += 1) {
      await save(newReview(`product-${i}`, `customer-${i}`));
    }
    await saveOther(newReview("product-x", "customer-x"));

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
    await prisma.$disconnect();
  });

  it("findByProductRef scopes to one product within the tenant", async () => {
    const tenantId = `tenant-itest-reviews-${crypto.randomUUID()}`;
    const { prisma, repository, save } = wire(tenantId);

    await save(newReview("product-a", "customer-1"));
    await save(newReview("product-b", "customer-1"));

    const page = await repository.findByProductRef("product-a", { first: 10 }, tenantId);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.productRef).toBe("product-a");
    await prisma.$disconnect();
  });
});
