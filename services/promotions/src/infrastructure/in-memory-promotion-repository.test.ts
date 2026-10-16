import { describe, expect, it } from "vitest";
import type { IdGenerator } from "@platform/contracts";
import { UniqueEntityId } from "@platform/domain";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { assertWriteTimeTenant } from "@platform/messaging/testing";
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
import { InMemoryPromotionRepository } from "./in-memory-promotion-repository";
import { PromotionsEventTranslator } from "./promotions-event-translator";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

function newPromotion(id: string, name: string): Promotion {
  const reward = PromotionReward.create({ type: "percentage", value: 10 });
  if (!reward.ok) throw new Error("test setup: invalid reward");
  const condition = PromotionCondition.create({ scope: "cart", targetRefs: [] });
  const rule = PromotionRule.create("automatic", condition, reward.value, false, 0);
  if (!rule.ok) throw new Error("test setup: invalid rule");
  return Promotion.create(
    UniqueEntityId.from(id),
    name,
    rule.value,
    PromotionSchedule.create(new Date("2026-01-01T00:00:00.000Z")),
    CustomerEligibility.everyone(),
    PromotionCampaign.none(),
  );
}

function repository() {
  const outbox = new OutboxWriter({
    store: new InMemoryOutboxStore(),
    translator: new PromotionsEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock: { now: () => new Date(0) },
    producer: "promotions",
  });
  return new InMemoryPromotionRepository({
    outbox,
    context: rootEventContext(sequentialIds()),
  });
}

describe("InMemoryPromotionRepository tenant isolation (ADR-0014, WP-10 T10.3)", () => {
  it("keeps the same promotion id separate per tenant: reads, the active set and lists never cross", async () => {
    const promotions = repository();
    const inA = newPromotion("promo-shared-id", "Tenant A promo");
    inA.activate("evt-a", new Date(0));
    await promotions.save(inA, "tenant-a");
    await promotions.save(newPromotion("promo-shared-id", "Tenant B promo"), "tenant-b");

    expect((await promotions.findById("promo-shared-id", "tenant-a"))?.name).toBe("Tenant A promo");
    expect((await promotions.findById("promo-shared-id", "tenant-b"))?.name).toBe("Tenant B promo");
    expect(await promotions.findById("promo-shared-id", "tenant-c")).toBeNull();
    expect(await promotions.findActive("tenant-a")).toHaveLength(1);
    expect(await promotions.findActive("tenant-b")).toHaveLength(0);
    expect((await promotions.list({ first: 10 }, "tenant-b")).items).toHaveLength(1);
    expect((await promotions.list({ first: 10 }, "tenant-c")).items).toHaveLength(0);
  });
});

describe("InMemoryPromotionRepository write-time tenant (ADR-0014 amendment 2026-09-18)", () => {
  it("carries each call's tenantId into the outbox envelope, not the singleton context's", async () => {
    await assertWriteTimeTenant("promotions", async (outbox, tenantId) => {
      const promotions = new InMemoryPromotionRepository({
        outbox,
        context: rootEventContext(sequentialIds()),
      });
      const promotion = newPromotion("promo-1", "10% off");
      promotion.activate("evt-1", new Date(0));
      await promotions.save(promotion, tenantId);
    });
  });
});
