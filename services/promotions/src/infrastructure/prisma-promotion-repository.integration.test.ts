import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { PrismaOutboxStore, PrismaUnitOfWork } from "@platform/db";
import { createTestPrismaClient } from "@platform/db/testing";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { OutboxWriter, rootEventContext } from "@platform/messaging";
import { Promotion } from "../domain/promotion";
import {
  PromotionCondition,
  PromotionReward,
  PromotionRule,
} from "../domain/value-objects/promotion-rule";
import {
  CustomerEligibility,
  PromotionCampaign,
  PromotionSchedule,
} from "../domain/value-objects/promotion-schedule";
import { PromotionsEventTranslator } from "./promotions-event-translator";
import { PrismaPromotionRepository } from "./prisma-promotion-repository";

/**
 * Phase 4 T4.5 — real PostgreSQL coverage for the new `list` read, following the same reference
 * pattern as `services/reviews/src/infrastructure/prisma-review-repository.integration.test.ts`.
 *
 *   DATABASE_URL_TEST=postgresql://lumo:lumo@localhost:5432/lumo_test pnpm --filter @platform/promotions test
 */
const databaseUrl = process.env["DATABASE_URL_TEST"];

describe.runIf(Boolean(databaseUrl))("PrismaPromotionRepository (integration)", () => {
  const clock: Clock = { now: () => new Date("2026-08-30T00:00:00.000Z") };
  const ids: IdGenerator = { generate: () => crypto.randomUUID() };

  function wire(tenantId: string) {
    const prisma = createTestPrismaClient(databaseUrl);
    const outbox = new OutboxWriter({
      store: new PrismaOutboxStore(prisma),
      translator: new PromotionsEventTranslator(),
      serializer: new InMemoryEventSerializer(),
      clock,
      producer: "promotions",
    });
    const context = rootEventContext(ids, tenantId);
    const repository = new PrismaPromotionRepository({ prisma, tenantId, outbox, context });
    const unitOfWork = new PrismaUnitOfWork(prisma);
    return {
      prisma,
      repository,
      save: (promotion: Promotion) => unitOfWork.run((tx) => repository.save(promotion, tx)),
    };
  }

  function newPromotion(name: string): Promotion {
    const reward = PromotionReward.create({ type: "percentage", value: 10 });
    if (!reward.ok) throw new Error("test setup: invalid reward");
    const condition = PromotionCondition.create({ scope: "cart", targetRefs: [] });
    const rule = PromotionRule.create("automatic", condition, reward.value, false, 0);
    if (!rule.ok) throw new Error("test setup: invalid rule");
    return Promotion.create(
      UniqueEntityId.from(ids.generate()),
      name,
      rule.value,
      PromotionSchedule.create(new Date("2026-01-01T00:00:00.000Z")),
      CustomerEligibility.everyone(),
      PromotionCampaign.none(),
    );
  }

  it("list filters by tenantId and paginates", async () => {
    const tenantId = `tenant-itest-promotions-${crypto.randomUUID()}`;
    const other = `tenant-itest-promotions-other-${crypto.randomUUID()}`;
    const { prisma, repository, save } = wire(tenantId);
    const { repository: otherRepository, save: saveOther } = wire(other);

    for (let i = 0; i < 3; i += 1) {
      await save(newPromotion(`promo-${i}`));
    }
    await saveOther(newPromotion("promo-x"));

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
