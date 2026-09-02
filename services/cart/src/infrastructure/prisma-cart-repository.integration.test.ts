import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaOutboxStore, PrismaUnitOfWork } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { OutboxWriter, rootEventContext } from "@platform/messaging";
import { Cart } from "../domain/cart";
import { CartEventTranslator } from "./cart-event-translator";
import { PrismaCartRepository } from "./prisma-cart-repository";

/**
 * Phase 4 T4.13 — real PostgreSQL coverage for the new `list` read (including the status filter),
 * following the same reference pattern as
 * `services/reviews/src/infrastructure/prisma-review-repository.integration.test.ts`.
 *
 *   DATABASE_URL_TEST=postgresql://lumo:lumo@localhost:5432/lumo_test pnpm --filter @platform/cart test
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

describe.runIf(Boolean(databaseUrl))("PrismaCartRepository (integration)", () => {
  const clock: Clock = { now: () => new Date("2026-08-30T00:00:00.000Z") };
  const ids: IdGenerator = { generate: () => crypto.randomUUID() };

  function wire(tenantId: string) {
    const prisma = createTestPrismaClient(databaseUrl);
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(prisma),
      translator: new CartEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock,
      producer: "cart",
    });
    const context = rootEventContext(ids, tenantId);
    const repository = new PrismaCartRepository({ prisma, tenantId, outbox, context });
    const unitOfWork = new PrismaUnitOfWork(prisma);
    return {
      prisma,
      repository,
      save: (cart: Cart) => unitOfWork.run((tx) => repository.save(cart, tx)),
    };
  }

  function newCart(sessionRef: string): Cart {
    return Cart.create(UniqueEntityId.from(ids.generate()), "customer-1", sessionRef, "USD");
  }

  it("list filters by tenantId and paginates", async () => {
    const tenantId = `tenant-itest-cart-${crypto.randomUUID()}`;
    const other = `tenant-itest-cart-other-${crypto.randomUUID()}`;
    const { prisma, repository, save } = wire(tenantId);
    const { repository: otherRepository, save: saveOther } = wire(other);

    for (let i = 0; i < 3; i += 1) {
      await save(newCart(`session-${i}`));
    }
    await saveOther(newCart("session-x"));

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

  it("list's status filter is the abandoned-cart recovery view", async () => {
    const tenantId = `tenant-itest-cart-status-${crypto.randomUUID()}`;
    const { prisma, repository, save } = wire(tenantId);

    const active = newCart("session-active");
    const abandoned = newCart("session-abandoned");
    abandoned.abandon(ids.generate(), clock.now());
    await save(active);
    await save(abandoned);

    const page = await repository.list({ first: 10 }, { status: "abandoned" });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.sessionRef).toBe("session-abandoned");
    await prisma.$disconnect();
  });
});
