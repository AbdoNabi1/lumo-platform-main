import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { CheckoutItem } from "@platform/checkout";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireCoupons, type Coupon } from "@platform/coupons";
import { wirePromotions, type Promotion } from "@platform/promotions";
import { DiscountUsageAdapter } from "./discount-usage.adapter";
import { PromotionValidationAdapter } from "./promotion-validation.adapter";

const TENANT = "tenant-1";
const clock: Clock = { now: () => new Date("2026-10-16T12:00:00.000Z") };

function contexts() {
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => `0000${(n += 1)}`.slice(-5) };
  const deps = { serializer: new InMemoryEventSerializer(), idGenerator, clock };
  return { promotions: wirePromotions(deps).promotions, coupons: wireCoupons(deps).coupons };
}

const products = {
  async get() {
    return { status: 200, body: { categories: [{ categoryId: "summer" }] } };
  },
};

async function percentOff(
  c: ReturnType<typeof contexts>,
  method: "code" | "automatic",
  value: number,
): Promise<string> {
  const created = await c.promotions.create({
    tenantId: TENANT,
    name: method === "code" ? "SALE10" : "Autumn",
    ruleType: "automatic",
    scope: "cart",
    targetRefs: [],
    rewardType: "percentage",
    rewardValue: value,
    stackable: false,
    priority: 0,
    startsAt: new Date("2026-01-01T00:00:00.000Z"),
    method,
  });
  const { promotionId } = created.body as { promotionId: string };
  await c.promotions.advance({ tenantId: TENANT, promotionId, toStatus: "active" });
  return promotionId;
}

function item(quantity: number, unitPriceMinor: number): CheckoutItem {
  const result = CheckoutItem.create("prod-1", quantity, unitPriceMinor, "EGP");
  if (!result.ok) throw result.error;
  return result.value;
}

describe("PromotionValidationAdapter.evaluate (Phase 2)", () => {
  it("applies an entered code and an automatic discount through the real contexts", async () => {
    const c = contexts();
    const codeId = await percentOff(c, "code", 10);
    await c.coupons.create({
      tenantId: TENANT,
      code: "SALE10",
      promotionRef: codeId,
      multiUse: true,
    });
    const adapter = new PromotionValidationAdapter(
      products as never,
      c.promotions,
      c.coupons,
      clock,
    );

    const snapshot = await adapter.evaluate({
      tenantId: TENANT,
      items: [item(2, 5_000)],
      shipping: null,
      codes: [" sale10 "],
    });

    expect(snapshot.codeStatuses).toEqual([{ code: "SALE10", applicable: true }]);
    expect(snapshot.orderDiscountMinor).toBe(1_000);
    expect(snapshot.applied[0]).toMatchObject({ code: "SALE10", couponId: expect.any(String) });
  });

  it("answers not_found for a code nobody created", async () => {
    const c = contexts();
    const adapter = new PromotionValidationAdapter(
      products as never,
      c.promotions,
      c.coupons,
      clock,
    );
    const snapshot = await adapter.evaluate({
      tenantId: TENANT,
      items: [item(1, 1_000)],
      shipping: null,
      codes: ["NOPE"],
    });
    expect(snapshot.codeStatuses).toEqual([
      { code: "NOPE", applicable: false, reason: "not_found" },
    ]);
  });

  it("applies an automatic discount with no code", async () => {
    const c = contexts();
    await percentOff(c, "automatic", 5);
    const adapter = new PromotionValidationAdapter(
      products as never,
      c.promotions,
      c.coupons,
      clock,
    );
    const snapshot = await adapter.evaluate({
      tenantId: TENANT,
      items: [item(1, 10_000)],
      shipping: null,
      codes: [],
    });
    expect(snapshot.orderDiscountMinor).toBe(500);
  });
});

describe("DiscountUsageAdapter (Phase 2)", () => {
  it("redeems a code once per order and counts an automatic discount on its promotion", async () => {
    const c = contexts();
    const codeId = await percentOff(c, "code", 10);
    const autoId = await percentOff(c, "automatic", 5);
    await c.coupons.create({
      tenantId: TENANT,
      code: "SALE10",
      promotionRef: codeId,
      multiUse: true,
    });
    const coupon = (await c.coupons.getByCode({ tenantId: TENANT, code: "SALE10" })).body as Coupon;
    const adapter = new DiscountUsageAdapter(c.promotions, c.coupons);
    const usage = {
      tenantId: TENANT,
      orderRef: "order-1",
      email: "ali@example.com",
      applied: [
        {
          promotionId: codeId,
          couponId: coupon.id.toString(),
          code: "SALE10",
          title: "SALE10",
          discountClass: "order" as const,
          amountMinor: 1_000,
        },
        { promotionId: autoId, title: "Autumn", discountClass: "order" as const, amountMinor: 500 },
      ],
    };

    await adapter.record(usage);
    await adapter.record(usage);

    const after = (await c.coupons.getByCode({ tenantId: TENANT, code: "SALE10" })).body as Coupon;
    expect(after.usageCount).toBe(1);
    expect(after.redemptions[0]?.email).toBe("ali@example.com");
    const automatic = (await c.promotions.get({ tenantId: TENANT, promotionId: autoId }))
      .body as Promotion;
    expect(automatic.usageCount).toBe(2); // automatic uses are not deduplicated; CompleteCheckout calls this once per order
  });
});
