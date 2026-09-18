import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wirePromotions } from "./composition";

const TENANT = "tenant-a";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-07-13T00:00:00.000Z") };

function wire() {
  return wirePromotions({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
  });
}

function createInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    tenantId: TENANT,
    name: "10% off everything",
    ruleType: "automatic" as const,
    scope: "cart" as const,
    targetRefs: [],
    rewardType: "percentage" as const,
    rewardValue: 10,
    stackable: false,
    priority: 0,
    startsAt: new Date("2026-01-01T00:00:00.000Z"),
    usageLimit: 1,
    ...overrides,
  };
}

describe("promotions (end to end)", () => {
  it("runs the full lifecycle: create -> activate -> evaluate -> record usage -> depleted, publishing canonical events", async () => {
    const app = wire();
    const created = await app.promotions.create(createInput());
    expect(created.status).toBe(201);
    const id = (created.body as { promotionId: string }).promotionId;

    const activated = await app.promotions.advance({
      tenantId: TENANT,
      promotionId: id,
      toStatus: "active",
    });
    expect(activated.status).toBe(200);

    const evaluated = await app.promotions.evaluate({
      tenantId: TENANT,
      cart: { lines: [], subtotalAmountMinor: 1_000 },
      customerRef: "customer-1",
    });
    expect(evaluated.status).toBe(200);
    expect((evaluated.body as { determinations: unknown[] }).determinations).toHaveLength(1);

    const usage = await app.promotions.recordUsage({ tenantId: TENANT, promotionId: id });
    expect(usage.status).toBe(200);
    expect((usage.body as { status: string }).status).toBe("depleted");

    expect(await app.drainOutbox()).toBeGreaterThan(0);
    expect(app.deliveredEventTypes).toContain("promotions.promotion.active");
    expect(app.deliveredEventTypes).toContain("promotions.promotion.depleted");
  });

  it("rejects an illegal transition (409)", async () => {
    const app = wire();
    const created = await app.promotions.create(createInput());
    const id = (created.body as { promotionId: string }).promotionId;
    const response = await app.promotions.advance({
      tenantId: TENANT,
      promotionId: id,
      toStatus: "paused",
    });
    expect(response.status).toBe(409);
  });

  it("returns 404 for an unknown promotion", async () => {
    const app = wire();
    const response = await app.promotions.advance({
      tenantId: TENANT,
      promotionId: "missing",
      toStatus: "active",
    });
    expect(response.status).toBe(404);
  });

  it("rejects an invalid percentage reward (422)", async () => {
    const app = wire();
    const response = await app.promotions.create(createInput({ rewardValue: 150 }));
    expect(response.status).toBe(422);
  });
});
