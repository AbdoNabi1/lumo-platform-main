import { describe, expect, it } from "vitest";
import type { Clock, IdGenerator } from "@platform/contracts";
import { InMemoryEventSerializer } from "@platform/domain-events/testing";
import { wireCoupons } from "../composition";
import type { Coupon } from "../domain/coupon";

const TENANT = "tenant-1";
const clock: Clock = { now: () => new Date("2026-10-16T12:00:00.000Z") };

function build() {
  let n = 0;
  const idGenerator: IdGenerator = { generate: () => `id-${(n += 1)}` };
  return wireCoupons({ serializer: new InMemoryEventSerializer(), idGenerator, clock }).coupons;
}

async function create(
  c: ReturnType<typeof build>,
  code: string,
  promotionRef: string,
  multiUse = true,
) {
  const response = await c.create({ tenantId: TENANT, code, promotionRef, multiUse });
  if (response.status !== 201) throw new Error(JSON.stringify(response.body));
  return (response.body as { couponId: string }).couponId;
}

describe("coupons — discount code use cases (Phase 2)", () => {
  it("finds a coupon by its normalised code", async () => {
    const c = build();
    await create(c, "SALE10", "p-1");
    const response = await c.getByCode({ tenantId: TENANT, code: " sale10 " });
    expect(response.status).toBe(200);
    expect((response.body as Coupon).promotionRef).toBe("p-1");
    expect((await c.getByCode({ tenantId: TENANT, code: "NOPE" })).status).toBe(404);
  });

  it("lists the coupons of several promotions and finds promotions by part of a code", async () => {
    const c = build();
    await create(c, "SALE10", "p-1");
    await create(c, "WINTER", "p-2");
    const listed = await c.listByPromotionRefs({ tenantId: TENANT, promotionRefs: ["p-2"] });
    expect((listed.body as { items: Coupon[] }).items.map((x) => x.code.value)).toEqual(["WINTER"]);
    const found = await c.findPromotionRefsByCode({ tenantId: TENANT, fragment: "sal" });
    expect((found.body as { promotionRefs: string[] }).promotionRefs).toEqual(["p-1"]);
  });

  it("changes the code and limits, refusing a code already in use", async () => {
    const c = build();
    const id = await create(c, "SALE10", "p-1");
    await create(c, "TAKEN", "p-2");
    const ok = await c.reconfigure({
      tenantId: TENANT,
      couponId: id,
      code: "SALE15",
      multiUse: false,
      usageLimit: 5,
    });
    expect(ok.status).toBe(200);
    const coupon = (await c.getByCode({ tenantId: TENANT, code: "SALE15" })).body as Coupon;
    expect(coupon.multiUse).toBe(false);
    expect(coupon.usageLimit).toBe(5);
    const taken = await c.reconfigure({
      tenantId: TENANT,
      couponId: id,
      code: "TAKEN",
      multiUse: false,
    });
    expect(taken.status).toBe(409);
  });

  it("treats the same guest email in any case as the same customer (Review Focus 4)", async () => {
    const c = build();
    await create(c, "ONCE", "p-1", false);
    const first = await c.redeem({
      tenantId: TENANT,
      code: "ONCE",
      customerRef: "guest-a",
      email: "Ali@Example.com",
      idempotencyKey: "order-1",
    });
    expect(first.status).toBe(200);
    const second = await c.redeem({
      tenantId: TENANT,
      code: "ONCE",
      customerRef: "guest-b",
      email: "ali@example.COM",
      idempotencyKey: "order-2",
    });
    expect(second.status).toBe(409);
  });
});
