import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireCoupons } from "./composition";
import { InMemoryPromotionsPort } from "./infrastructure/in-memory-port-adapters";

function sequentialIds(): IdGenerator {
  let counter = 0;
  return { generate: () => `id-${(counter += 1)}` };
}

const clock: Clock = { now: () => new Date("2026-07-13T00:00:00.000Z") };

function wire(promotions = new InMemoryPromotionsPort()) {
  return wireCoupons({
    serializer: new InMemoryEventSerializer(),
    idGenerator: sequentialIds(),
    clock,
    promotions,
  });
}

function createInput(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    code: "save10",
    promotionRef: "promo-1",
    multiUse: true,
    usageLimit: 1,
    ...overrides,
  };
}

describe("coupons (end to end)", () => {
  it("runs the full lifecycle: create -> redeem -> depleted, publishing canonical events", async () => {
    const app = wire();
    const created = await app.coupons.create(createInput());
    expect(created.status).toBe(201);

    const redeemed = await app.coupons.redeem({
      code: "SAVE10",
      customerRef: "customer-1",
      idempotencyKey: "idem-1",
    });
    expect(redeemed.status).toBe(200);
    expect((redeemed.body as { duplicate: boolean }).duplicate).toBe(false);
    expect((redeemed.body as { status: string }).status).toBe("depleted");

    expect(await app.drainOutbox()).toBeGreaterThan(0);
    expect(app.deliveredEventTypes).toContain("coupons.coupon.depleted");
  });

  it("redemption is idempotent by idempotencyKey — a replay is deduped", async () => {
    const app = wire();
    await app.coupons.create(createInput({ usageLimit: undefined }));
    const first = await app.coupons.redeem({
      code: "SAVE10",
      customerRef: "customer-1",
      idempotencyKey: "idem-shared",
    });
    expect((first.body as { duplicate: boolean }).duplicate).toBe(false);

    const replay = await app.coupons.redeem({
      code: "SAVE10",
      customerRef: "customer-1",
      idempotencyKey: "idem-shared",
    });
    expect((replay.body as { duplicate: boolean }).duplicate).toBe(true);
  });

  it("rejects redemption when the authorized promotion is not active (409)", async () => {
    const promotions = new InMemoryPromotionsPort();
    promotions.markInactive("promo-1");
    const app = wire(promotions);
    await app.coupons.create(createInput({ usageLimit: undefined }));

    const response = await app.coupons.redeem({
      code: "SAVE10",
      customerRef: "customer-1",
      idempotencyKey: "idem-1",
    });
    expect(response.status).toBe(409);
  });

  it("rejects creating a duplicate coupon code (409)", async () => {
    const app = wire();
    await app.coupons.create(createInput({ usageLimit: undefined }));
    const response = await app.coupons.create(createInput({ usageLimit: undefined }));
    expect(response.status).toBe(409);
  });

  it("rejects an invalid coupon code (422)", async () => {
    const app = wire();
    const response = await app.coupons.create(createInput({ code: "a" }));
    expect(response.status).toBe(422);
  });
});
