import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { InMemoryOutboxStore, OutboxWriter, rootEventContext } from "@platform/messaging";
import { GetPromotion } from "./get-promotion.use-case";
import { ListPromotions } from "./list-promotions.use-case";
import { CreatePromotion } from "./promotion.use-cases";
import { InMemoryPromotionRepository } from "../infrastructure/in-memory-promotion-repository";
import { InMemoryUnitOfWork } from "../infrastructure/in-memory-unit-of-work";
import { PromotionsEventTranslator } from "../infrastructure/promotions-event-translator";

const TENANT = "tenant-a";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-08-30T00:00:00.000Z") };

function harness() {
  const outboxStore = new InMemoryOutboxStore();
  const outbox = new OutboxWriter({
    store: outboxStore,
    translator: new PromotionsEventTranslator(),
    serializer: new InMemoryEventSerializer(),
    clock,
    producer: "promotions",
  });
  const context = rootEventContext(sequentialIds());
  const promotions = new InMemoryPromotionRepository({ outbox, context });
  const unitOfWork = new InMemoryUnitOfWork();
  const idGenerator = sequentialIds();
  return { promotions, unitOfWork, idGenerator, clock };
}

function createInput(name: string) {
  return {
    tenantId: TENANT,
    name,
    ruleType: "automatic" as const,
    scope: "cart" as const,
    targetRefs: [],
    rewardType: "percentage" as const,
    rewardValue: 10,
    stackable: false,
    priority: 0,
    startsAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

describe("Promotions read use-cases (Phase 4 T4.5)", () => {
  it("ListPromotions paginates", async () => {
    const h = harness();
    const create = new CreatePromotion(h);
    for (let i = 0; i < 3; i += 1) {
      await create.execute(createInput(`promo-${i}`));
    }

    const page = await new ListPromotions(h).execute({ tenantId: TENANT, first: 2 });
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    expect(page.value.items).toHaveLength(2);
    expect(page.value.pageInfo.hasNextPage).toBe(true);

    const rest = await new ListPromotions(h).execute({
      tenantId: TENANT,
      first: 10,
      after: page.value.pageInfo.endCursor ?? undefined,
    });
    expect(rest.ok).toBe(true);
    if (!rest.ok) return;
    expect(rest.value.items).toHaveLength(1);
    expect(rest.value.pageInfo.hasNextPage).toBe(false);
  });

  it("GetPromotion returns the promotion, or NotFoundError when absent", async () => {
    const h = harness();
    const created = await new CreatePromotion(h).execute(createInput("10% off"));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const found = await new GetPromotion(h).execute({
      tenantId: TENANT,
      promotionId: created.value.promotionId,
    });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value.id.toString()).toBe(created.value.promotionId);
    expect(found.value.name).toBe("10% off");

    const missing = await new GetPromotion(h).execute({ tenantId: TENANT, promotionId: "nope" });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.code).toBe("NOT_FOUND");
  });
});
